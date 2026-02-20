import { corsHeaders, errorJson } from "./utils";
import { fetchFeedFromDb } from "../services/postgres";
import { AuthError, requireUserId } from "../services/auth";
import { checkRateLimit, rateLimitKey, type RateLimitConfig } from "../services/rateLimit";
import { MemoryStore } from "../services/store";
import type { Env } from "../types";
import type { FeedItemPayload } from "@ofp/shared";

type Tab = "breaking" | "macro" | "filings";

const ALLOWED_TABS = new Set<Tab>(["breaking", "macro", "filings"]);
const STREAM_POLL_INTERVAL_MS = 1500;
const STREAM_DURATION_MS = 25000;
const STREAM_HEARTBEAT_MS = 7000;
const STREAM_POLL_LIMIT = 20;
const STREAM_CONNECT_LIMIT: RateLimitConfig = { limit: 20, windowMs: 60 * 1000 };
const STREAM_RATE_SCOPE = "connect";

type StreamEvent = {
  item_id: string;
  event_time: string;
  tab: Tab;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function parseSince(value: string | null): number | null {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return parsed;
}

function safeTabText(value: string | null): Tab | null {
  if (value === "breaking" || value === "macro" || value === "filings") {
    return value;
  }
  return null;
}

function clientIp(request: Request): string {
  const candidate =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for") ??
    request.headers.get("x-real-ip");

  if (!candidate) {
    return "unknown";
  }

  const first = candidate.split(",")[0]?.trim();
  return first && first.length > 0 ? first : "unknown";
}

function formatRateLimitSeconds(milliseconds: number): number {
  return Math.max(1, Math.ceil(milliseconds / 1000));
}

function safeEnqueue(controller: ReadableStreamDefaultController, chunk: Uint8Array): boolean {
  try {
    controller.enqueue(chunk);
    return true;
  } catch {
    return false;
  }
}

function safeClose(controller: ReadableStreamDefaultController): void {
  try {
    controller.close();
  } catch {
    // Stream may already be closed by the consumer.
  }
}

function emitEvent(controller: ReadableStreamDefaultController, payload: StreamEvent): boolean {
  const encoder = new TextEncoder();
  const serialized = JSON.stringify(payload);
  return (
    safeEnqueue(controller, encoder.encode("event: item\n")) &&
    safeEnqueue(controller, encoder.encode(`data: ${serialized}\n\n`))
  );
}

function emitHeartbeat(controller: ReadableStreamDefaultController): boolean {
  const encoder = new TextEncoder();
  const payload = {
    status: "heartbeat",
    ts: new Date().toISOString()
  };
  return (
    safeEnqueue(controller, encoder.encode("event: heartbeat\n")) &&
    safeEnqueue(controller, encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))
  );
}

async function loadStreamItemsFromDb(tab: Tab, env: Env, sinceMs: number): Promise<StreamEvent[]> {
  try {
    const rows = await fetchFeedFromDb(env, {
      tab,
      query: "",
      region: "GLOBAL",
      limit: STREAM_POLL_LIMIT,
      offset: 0
    });
    if (!rows) {
      return [];
    }
    return rows
      .filter((item) => Date.parse(item.event_time) > sinceMs)
      .map((item: FeedItemPayload) => ({
        item_id: item.item_id,
        event_time: item.event_time,
        tab
      }))
      .sort((left, right) => left.event_time.localeCompare(right.event_time));
  } catch {
    return [];
  }
}

async function loadStreamItemsFromMemory(tab: Tab, sinceMs: number): Promise<StreamEvent[]> {
  return MemoryStore.get()
    .listFeed(tab, "", "GLOBAL")
    .filter((item) => Date.parse(item.event_time) > sinceMs)
    .map((item) => ({
      item_id: item.item_id,
      event_time: item.event_time,
      tab
    }))
    .sort((left, right) => left.event_time.localeCompare(right.event_time));
}

export async function handleStream(request: Request, env: Env): Promise<Response> {
  let userId: string;
  try {
    userId = await requireUserId(request, env);
  } catch (error) {
    if (error instanceof AuthError) {
      return errorJson(request, env, 401, error.message);
    }
    return errorJson(request, env, 500, "Unable to authorize stream.");
  }

  if (!env.RATE_LIMITER_DO) {
    return errorJson(request, env, 503, "Rate limiter is not configured.");
  }

  const streamRateKey = rateLimitKey("stream", `${userId}:${clientIp(request)}`, STREAM_RATE_SCOPE);
  const streamLimit = await checkRateLimit(env.OFP_KV, streamRateKey, STREAM_CONNECT_LIMIT, Date.now(), env.RATE_LIMITER_DO);
  if (!streamLimit.allowed) {
    return errorJson(
      request,
      env,
      429,
      `Stream connect rate limited. Retry after ${formatRateLimitSeconds(streamLimit.retryAfterMs)} seconds.`,
      { "retry-after": String(formatRateLimitSeconds(streamLimit.retryAfterMs)) }
    );
  }

  const url = new URL(request.url);
  const tab = safeTabText(url.searchParams.get("tab")) ?? "breaking";
  if (!ALLOWED_TABS.has(tab)) {
    return errorJson(request, env, 400, "Invalid stream tab.");
  }

  const sinceRaw = url.searchParams.get("since");
  if (sinceRaw !== null && parseSince(sinceRaw) === null) {
    return errorJson(request, env, 400, "Invalid since timestamp.");
  }

  const since = sinceRaw ? parseSince(sinceRaw) ?? 0 : 0;

  const stream = new ReadableStream({
    start(controller) {
      void (async () => {
        const startedAt = Date.now();
        let cursorMs = since;
        const seen = new Set<string>();
        let lastHeartbeatAt = Date.now();
        let emitted = false;

        while (Date.now() - startedAt < STREAM_DURATION_MS) {
          if (request.signal?.aborted) {
            break;
          }

          const dbRows = await loadStreamItemsFromDb(tab, env, cursorMs);
          const items = dbRows.length > 0 ? dbRows : await loadStreamItemsFromMemory(tab, cursorMs);

          for (const item of items) {
            if (seen.has(item.item_id)) {
              continue;
            }
            seen.add(item.item_id);
            if (!emitEvent(controller, item)) {
              safeClose(controller);
              return;
            }
            emitted = true;
            lastHeartbeatAt = Date.now();

            const eventTime = Date.parse(item.event_time);
            if (!Number.isNaN(eventTime) && eventTime > cursorMs) {
              cursorMs = eventTime;
            }
          }

          if (!emitted && Date.now() - lastHeartbeatAt >= STREAM_HEARTBEAT_MS && !emitHeartbeat(controller)) {
            safeClose(controller);
            return;
          }

          if (!emitted && Date.now() - lastHeartbeatAt >= STREAM_HEARTBEAT_MS) {
            lastHeartbeatAt = Date.now();
          }

          if (request.signal?.aborted) {
            break;
          }
          await sleep(STREAM_POLL_INTERVAL_MS);
        }

        safeClose(controller);
      })().catch((error) => {
        console.error("stream_failed", error);
        if (!request.signal?.aborted) {
          const encoder = new TextEncoder();
          safeEnqueue(controller, encoder.encode("event: error\n"));
          safeEnqueue(controller, encoder.encode("data: {\"error\":\"stream_failed\"}\n\n"));
        }
        safeClose(controller);
      });
    }
  });

  const headers = corsHeaders(request, env);
  headers.set("content-type", "text/event-stream");
  headers.set("cache-control", "no-cache");
  headers.set("connection", "keep-alive");
  headers.set("x-accel-buffering", "no");

  return new Response(stream, { headers });
}
