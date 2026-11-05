import { handleAccountDelete } from "./routes/account";
import { handleAccountAuditGet, handleAccountAuditPost } from "./routes/accountAudit";
import { handleAlertsDelete, handleAlertsGet, handleAlertsPost } from "./routes/alerts";
import { handleAuthLogin, handleAuthLogout, handleAuthPasswordChange, handleAuthPasswordReset, handleAuthSignup } from "./routes/auth";
import { handleEntity } from "./routes/entity";
import { handleFeed } from "./routes/feed";
import { handleFiling } from "./routes/filing";
import { handleGeo } from "./routes/geo";
import { handleIndicators } from "./routes/indicators";
import { handleLegal } from "./routes/legal";
import { handlePushConfig, handlePushSubscribe, handlePushUnsubscribe } from "./routes/push";
import { handleSeries } from "./routes/series";
import { handleStream } from "./routes/stream";
import { HttpError, clientIp, corsHeaders, errorJson, formatRetryAfterSeconds } from "./routes/utils";
import { EventHubDO } from "./do/eventHub";
import { RateLimiterDO } from "./do/rateLimiter";
import { SecLimiterDO } from "./do/secLimiter";
import { buildScheduledMessages } from "./ingest/schedule";
import { handleIngestJob, isIngestMessage } from "./ingest/queue";
import { handlePushJob, isPushMessage } from "./push/queue";
import { AuthError } from "./services/auth";
import { DbUnavailableError } from "./services/db";
import { describeError, logEvent } from "./services/log";
import { checkRateLimit, rateLimitKey, type RateLimitConfig } from "./services/rateLimit";
import type { Env, IngestQueueMessage, PushQueueMessage } from "./types";

type PublicReadScope = "feed" | "entity" | "series" | "filing" | "indicators" | "legal" | "geo";

const PUBLIC_READ_RATE_LIMITS: Record<PublicReadScope, RateLimitConfig> = {
  feed: { limit: 180, windowMs: 60 * 1000 },
  entity: { limit: 120, windowMs: 60 * 1000 },
  series: { limit: 120, windowMs: 60 * 1000 },
  filing: { limit: 120, windowMs: 60 * 1000 },
  indicators: { limit: 180, windowMs: 60 * 1000 },
  legal: { limit: 180, windowMs: 60 * 1000 },
  geo: { limit: 300, windowMs: 60 * 1000 }
};

/**
 * Edge cache TTL (seconds) for successful public reads. Cache hits are served
 * from the colo's Cache API without touching the rate-limiter Durable Object,
 * KV or the database. `geo` is per-visitor and never cached.
 */
const PUBLIC_EDGE_CACHE_TTL: Partial<Record<PublicReadScope, number>> = {
  feed: 30,
  entity: 60,
  series: 300,
  filing: 300,
  indicators: 120,
  legal: 300
};

interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
}

function edgeCache(): Cache | null {
  const storage = (globalThis as { caches?: CacheStorage & { default?: Cache } }).caches;
  return storage?.default ?? null;
}

/** Cache key: path + sorted query, independent of headers such as Origin. */
function cacheKeyFor(url: URL): Request {
  const key = new URL(url.toString());
  key.search = "";
  const params = [...url.searchParams.entries()].sort(([left], [right]) => left.localeCompare(right));
  for (const [name, value] of params) {
    key.searchParams.append(name, value);
  }
  return new Request(key.toString(), { method: "GET" });
}

function rebuildWithCors(request: Request, env: Env, cached: Response, ttl: number, cacheStatus: "HIT" | "MISS"): Response {
  const headers = corsHeaders(request, env);
  headers.set("cache-control", `public, max-age=${Math.min(ttl, 60)}`);
  headers.set("x-edge-cache", cacheStatus);
  return new Response(cached.body, { status: cached.status, headers });
}

async function enforcePublicReadLimit(request: Request, env: Env, scope: PublicReadScope): Promise<void> {
  if (!env.RATE_LIMITER_DO) {
    throw new HttpError(503, "Rate limiter is not configured.");
  }
  const key = rateLimitKey("public_read", clientIp(request), scope);
  const limit = await checkRateLimit(env.OFP_KV, key, PUBLIC_READ_RATE_LIMITS[scope], Date.now(), env.RATE_LIMITER_DO);
  if (!limit.allowed) {
    const seconds = formatRetryAfterSeconds(limit.retryAfterMs);
    throw new HttpError(429, `Too many ${scope} requests from this network. Retry in ${seconds} seconds.`, { "retry-after": seconds });
  }
}

async function publicRead(
  request: Request,
  env: Env,
  ctx: ExecutionContextLike | undefined,
  scope: PublicReadScope,
  handler: () => Promise<Response>
): Promise<Response> {
  const ttl = PUBLIC_EDGE_CACHE_TTL[scope];
  const cache = ttl ? edgeCache() : null;
  const cacheKey = cache ? cacheKeyFor(new URL(request.url)) : null;

  if (cache && cacheKey && ttl) {
    const hit = await cache.match(cacheKey);
    if (hit) {
      return rebuildWithCors(request, env, hit, ttl, "HIT");
    }
  }

  await enforcePublicReadLimit(request, env, scope);
  const response = await handler();

  if (cache && cacheKey && ttl && response.status === 200) {
    const body = await response.arrayBuffer();
    const stored = new Response(body, {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": `public, max-age=${ttl}` }
    });
    const put = cache.put(cacheKey, stored).catch((error) => logEvent("warn", "edge_cache_put_failed", describeError(error)));
    if (ctx) {
      ctx.waitUntil(put);
    } else {
      await put;
    }
    return rebuildWithCors(request, env, new Response(body, { status: 200 }), ttl, "MISS");
  }
  return response;
}

function routeParam(pathname: string, base: string): string | null {
  if (!pathname.startsWith(base)) {
    return null;
  }
  const sliced = pathname.slice(base.length);
  if (sliced.length === 0 || sliced.includes("/")) {
    return null;
  }
  try {
    return decodeURIComponent(sliced);
  } catch {
    return null;
  }
}

async function routeApi(request: Request, env: Env, ctx: ExecutionContextLike | undefined): Promise<Response> {
  const { pathname } = new URL(request.url);
  const method = request.method;

  if (method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(request, env) });
  }

  if (method === "GET") {
    switch (pathname) {
      case "/api/feed":
        return publicRead(request, env, ctx, "feed", () => handleFeed(request, env));
      case "/api/indicators/key":
        return publicRead(request, env, ctx, "indicators", () => handleIndicators(request, env));
      case "/api/legal":
        return publicRead(request, env, ctx, "legal", () => handleLegal(request, env));
      case "/api/geo":
        return publicRead(request, env, ctx, "geo", () => handleGeo(request, env));
      case "/api/account/audit":
        return handleAccountAuditGet(request, env);
      case "/api/stream":
        return handleStream(request, env);
      case "/api/alerts/rules":
        return handleAlertsGet(request, env);
      case "/api/push/config":
        return handlePushConfig(request, env);
    }
    const entitySlug = routeParam(pathname, "/api/entity/");
    if (entitySlug !== null) {
      return publicRead(request, env, ctx, "entity", () => handleEntity(request, env, entitySlug));
    }
    const seriesId = routeParam(pathname, "/api/series/");
    if (seriesId !== null) {
      return publicRead(request, env, ctx, "series", () => handleSeries(request, env, seriesId));
    }
    const accession = routeParam(pathname, "/api/f/");
    if (accession !== null) {
      return publicRead(request, env, ctx, "filing", () => handleFiling(request, env, accession));
    }
  }

  if (method === "POST") {
    switch (pathname) {
      case "/api/auth/login":
        return handleAuthLogin(request, env);
      case "/api/auth/signup":
        return handleAuthSignup(request, env);
      case "/api/auth/password-reset":
        return handleAuthPasswordReset(request, env);
      case "/api/auth/password-change":
        return handleAuthPasswordChange(request, env);
      case "/api/auth/logout":
        return handleAuthLogout(request, env);
      case "/api/push/subscribe":
        return handlePushSubscribe(request, env);
      case "/api/push/unsubscribe":
        return handlePushUnsubscribe(request, env);
      case "/api/alerts/rules":
        return handleAlertsPost(request, env);
      case "/api/account/audit":
        return handleAccountAuditPost(request, env);
      case "/api/account/delete":
        return handleAccountDelete(request, env);
    }
  }

  if (method === "DELETE") {
    const ruleId = routeParam(pathname, "/api/alerts/rules/");
    if (ruleId !== null) {
      return handleAlertsDelete(request, env, ruleId);
    }
  }

  throw new HttpError(404, "Not found.");
}

/** Single place that turns exceptions into responses; nothing escapes without CORS headers. */
export async function handleApi(request: Request, env: Env, ctx?: ExecutionContextLike): Promise<Response> {
  const requestId = request.headers.get("cf-ray") ?? crypto.randomUUID();
  try {
    return await routeApi(request, env, ctx);
  } catch (error) {
    if (error instanceof HttpError) {
      return errorJson(request, env, error.status, error.message, error.headers);
    }
    if (error instanceof AuthError) {
      return errorJson(request, env, 401, error.message);
    }
    const path = new URL(request.url).pathname;
    if (error instanceof DbUnavailableError) {
      logEvent("error", "db_unavailable", { request_id: requestId, path, ...describeError(error) });
      return errorJson(request, env, 503, "Persistent store is temporarily unavailable.", { "retry-after": "30", "x-request-id": requestId });
    }
    logEvent("error", "unhandled_request_error", { request_id: requestId, path, ...describeError(error) });
    return errorJson(request, env, 500, "Internal server error.", { "x-request-id": requestId });
  }
}

const MAX_RETRY_DELAY_SECONDS = 15 * 60;

async function handleQueueBatch(batch: MessageBatch<IngestQueueMessage | PushQueueMessage>, env: Env): Promise<void> {
  for (const message of batch.messages) {
    const body = message.body as unknown;
    const job = (body as { job?: unknown } | null)?.job;
    try {
      if (isIngestMessage(body)) {
        await handleIngestJob(body, env);
      } else if (isPushMessage(body)) {
        await handlePushJob(body, env);
      } else {
        // Malformed messages can never succeed: drop them instead of retrying.
        logEvent("error", "queue_message_unsupported", { queue: batch.queue, job: String(job) });
        message.ack();
        continue;
      }
      message.ack();
    } catch (error) {
      const attempts = (message as { attempts?: number }).attempts ?? 1;
      const delaySeconds = Math.min(MAX_RETRY_DELAY_SECONDS, 30 * 2 ** Math.max(0, attempts - 1));
      logEvent("error", "queue_job_failed", {
        queue: batch.queue,
        job: String(job),
        run_id: (body as { run_id?: unknown } | null)?.run_id,
        attempts,
        retry_in_seconds: delaySeconds,
        ...describeError(error)
      });
      message.retry({ delaySeconds });
    }
  }
}

async function handleScheduled(controller: ScheduledController, env: Env): Promise<void> {
  const { ingest, push } = buildScheduledMessages(controller.cron, crypto.randomUUID());
  if (ingest.length > 0) {
    if (!env.INGEST_QUEUE) {
      logEvent("error", "scheduled_queue_missing", { queue: "INGEST_QUEUE", cron: controller.cron });
    } else {
      await env.INGEST_QUEUE.sendBatch(ingest.map((body) => ({ body })));
    }
  }
  if (push.length > 0) {
    if (!env.PUSH_QUEUE) {
      logEvent("error", "scheduled_queue_missing", { queue: "PUSH_QUEUE", cron: controller.cron });
    } else {
      await env.PUSH_QUEUE.sendBatch(push.map((body) => ({ body })));
    }
  }
  logEvent("info", "scheduled_dispatch", { cron: controller.cron, ingest_jobs: ingest.length, push_jobs: push.length });
}

export default {
  async fetch(request: Request, env: Env, ctx?: ExecutionContextLike): Promise<Response> {
    return handleApi(request, env, ctx);
  },
  async queue(batch: MessageBatch<IngestQueueMessage | PushQueueMessage>, env: Env): Promise<void> {
    await handleQueueBatch(batch, env);
  },
  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    await handleScheduled(controller, env);
  }
};

export { SecLimiterDO, EventHubDO, RateLimiterDO };
