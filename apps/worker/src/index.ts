import { handleAlertsGet, handleAlertsPost } from "./routes/alerts";
import { handleEntity } from "./routes/entity";
import { handleFeed } from "./routes/feed";
import { handleFiling } from "./routes/filing";
import { handleGeo } from "./routes/geo";
import { handleIndicators } from "./routes/indicators";
import { handleLegal } from "./routes/legal";
import { handleAccountAuditGet, handleAccountAuditPost } from "./routes/accountAudit";
import { handlePushSubscribe, handlePushUnsubscribe } from "./routes/push";
import { handleSeries } from "./routes/series";
import { handleStream } from "./routes/stream";
import { handleAuthLogin, handleAuthLogout, handleAuthPasswordChange, handleAuthPasswordReset, handleAuthSignup } from "./routes/auth";
import { clientIp, corsHeaders, errorJson } from "./routes/utils";
import { EventHubDO } from "./do/eventHub";
import { RateLimiterDO } from "./do/rateLimiter";
import { SecLimiterDO } from "./do/secLimiter";
import { handleIngestJob } from "./ingest/queue";
import { handlePushJob } from "./push/queue";
import { checkRateLimit, rateLimitKey, type RateLimitConfig } from "./services/rateLimit";
import type { Env, IngestQueueMessage, PushQueueMessage } from "./types";

const GDELT_NASDAQ_TOP10: ReadonlyArray<{ entity: string; ticker: string }> = [
  { entity: "Microsoft", ticker: "MSFT" },
  { entity: "Apple", ticker: "AAPL" },
  { entity: "NVIDIA", ticker: "NVDA" },
  { entity: "Amazon", ticker: "AMZN" },
  { entity: "Alphabet", ticker: "GOOGL" },
  { entity: "Meta", ticker: "META" },
  { entity: "Broadcom", ticker: "AVGO" },
  { entity: "Tesla", ticker: "TSLA" },
  { entity: "Costco", ticker: "COST" },
  { entity: "Netflix", ticker: "NFLX" }
];

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

function routePath(pathname: string, base: string): string | null {
  if (!pathname.startsWith(base)) {
    return null;
  }
  const sliced = pathname.slice(base.length);
  if (sliced.length === 0) {
    return null;
  }
  try {
    return decodeURIComponent(sliced);
  } catch {
    return null;
  }
}

function formatRateLimitSeconds(milliseconds: number): string {
  return String(Math.max(1, Math.ceil(milliseconds / 1000)));
}

async function enforcePublicReadLimit(
  request: Request,
  env: Env,
  scope: PublicReadScope
): Promise<Response | null> {
  if (!env.RATE_LIMITER_DO) {
    return errorJson(request, env, 503, "Rate limiter is not configured.");
  }

  const key = rateLimitKey("public_read", clientIp(request), scope);
  const limit = await checkRateLimit(env.OFP_KV, key, PUBLIC_READ_RATE_LIMITS[scope], Date.now(), env.RATE_LIMITER_DO);
  if (limit.allowed) {
    return null;
  }

  return errorJson(
    request,
    env,
    429,
    `Too many ${scope} requests from this network. Retry in ${formatRateLimitSeconds(limit.retryAfterMs)} seconds.`,
    { "retry-after": formatRateLimitSeconds(limit.retryAfterMs) }
  );
}

async function handleApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const pathname = url.pathname;

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(request, env) });
  }

  if (request.method === "GET" && pathname === "/api/feed") {
    const limited = await enforcePublicReadLimit(request, env, "feed");
    if (limited) {
      return limited;
    }
    return handleFeed(request, env);
  }
  if (request.method === "GET" && pathname === "/api/indicators/key") {
    const limited = await enforcePublicReadLimit(request, env, "indicators");
    if (limited) {
      return limited;
    }
    return handleIndicators(request, env);
  }
  if (request.method === "GET" && pathname === "/api/legal") {
    const limited = await enforcePublicReadLimit(request, env, "legal");
    if (limited) {
      return limited;
    }
    return handleLegal(request, env);
  }
  if (request.method === "GET" && pathname === "/api/account/audit") {
    return handleAccountAuditGet(request, env);
  }
  if (request.method === "POST" && pathname === "/api/account/audit") {
    return handleAccountAuditPost(request, env);
  }
  if (request.method === "GET" && pathname === "/api/geo") {
    const limited = await enforcePublicReadLimit(request, env, "geo");
    if (limited) {
      return limited;
    }
    return handleGeo(request, env);
  }
  if (request.method === "GET" && pathname === "/api/stream") {
    return handleStream(request, env);
  }
  if (request.method === "POST" && pathname === "/api/auth/login") {
    return handleAuthLogin(request, env);
  }
  if (request.method === "POST" && pathname === "/api/auth/signup") {
    return handleAuthSignup(request, env);
  }
  if (request.method === "POST" && pathname === "/api/auth/password-reset") {
    return handleAuthPasswordReset(request, env);
  }
  if (request.method === "POST" && pathname === "/api/auth/password-change") {
    return handleAuthPasswordChange(request, env);
  }
  if (request.method === "POST" && pathname === "/api/auth/logout") {
    return handleAuthLogout(request, env);
  }
  if (request.method === "POST" && pathname === "/api/push/subscribe") {
    return handlePushSubscribe(request, env);
  }
  if (request.method === "POST" && pathname === "/api/push/unsubscribe") {
    return handlePushUnsubscribe(request, env);
  }
  if (request.method === "GET" && pathname === "/api/alerts/rules") {
    return handleAlertsGet(request, env);
  }
  if (request.method === "POST" && pathname === "/api/alerts/rules") {
    return handleAlertsPost(request, env);
  }

  const entitySlug = routePath(pathname, "/api/entity/");
  if (request.method === "GET" && entitySlug) {
    const limited = await enforcePublicReadLimit(request, env, "entity");
    if (limited) {
      return limited;
    }
    return handleEntity(request, env, entitySlug);
  }

  const seriesId = routePath(pathname, "/api/series/");
  if (request.method === "GET" && seriesId) {
    const limited = await enforcePublicReadLimit(request, env, "series");
    if (limited) {
      return limited;
    }
    return handleSeries(request, env, seriesId);
  }

  const accession = routePath(pathname, "/api/f/");
  if (request.method === "GET" && accession) {
    const limited = await enforcePublicReadLimit(request, env, "filing");
    if (limited) {
      return limited;
    }
    return handleFiling(request, env, accession);
  }

  return errorJson(request, env, 404, "Not found.");
}

function isIngestMessage(input: unknown): input is IngestQueueMessage {
  if (!input || typeof input !== "object") {
    return false;
  }
  const job = (input as { job?: unknown }).job;
  return (
    job === "INGEST_GDELT" ||
    job === "INGEST_SEC" ||
    job === "INGEST_MACRO" ||
    job === "RECOMPUTE_DERIVED"
  );
}

function isPushMessage(input: unknown): input is PushQueueMessage {
  if (!input || typeof input !== "object") {
    return false;
  }
  return (input as { job?: unknown }).job === "PUSH_FANOUT_BREAKING";
}

async function handleQueueMessage(message: MessageBatch<IngestQueueMessage | PushQueueMessage>, env: Env): Promise<void> {
  for (const entry of message.messages) {
    try {
      if (isIngestMessage(entry.body)) {
        await handleIngestJob(entry.body, env);
      } else if (isPushMessage(entry.body)) {
        await handlePushJob(entry.body, env);
      } else {
        throw new Error("Unsupported queue message.");
      }
      entry.ack();
    } catch {
      entry.retry();
    }
  }
}

async function handleScheduled(controller: ScheduledController, env: Env): Promise<void> {
  const runId = crypto.randomUUID();
  const cron = controller.cron;

  const runGdelt = !cron || cron === "*/5 * * * *";
  const runSec = !cron || cron === "*/2 * * * *";
  const runMacro = !cron || cron === "0 */3 * * *";

  if (env.INGEST_QUEUE) {
    if (runGdelt) {
      for (const target of GDELT_NASDAQ_TOP10) {
        await env.INGEST_QUEUE.send({
          job: "INGEST_GDELT",
          run_id: runId,
          params: {
            entity: target.entity,
            ticker: target.ticker
          }
        });
      }
    }
    if (runSec) {
      await env.INGEST_QUEUE.send({
        job: "INGEST_SEC",
        run_id: runId,
        params: { cik: "1045810" }
      });
    }
    if (runMacro) {
      await env.INGEST_QUEUE.send({
        job: "INGEST_MACRO",
        run_id: runId,
        params: {}
      });
      await env.INGEST_QUEUE.send({
        job: "RECOMPUTE_DERIVED",
        run_id: runId,
        params: {}
      });
    }
  }

  if (env.PUSH_QUEUE && runGdelt) {
    await env.PUSH_QUEUE.send({
      job: "PUSH_FANOUT_BREAKING",
      run_id: runId,
      params: { limit: 25 }
    });
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handleApi(request, env);
  },
  async queue(batch: MessageBatch<IngestQueueMessage | PushQueueMessage>, env: Env): Promise<void> {
    await handleQueueMessage(batch, env);
  },
  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    await handleScheduled(controller, env);
  }
};

export { SecLimiterDO, EventHubDO, RateLimiterDO };
