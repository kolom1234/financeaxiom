import { z } from "zod";
import { requireUserId } from "../services/auth";
import { hasDatabase } from "../services/db";
import { allowMemoryReadFallback } from "../services/fallbackPolicy";
import { describeError, logEvent } from "../services/log";
import { queryFeedSince } from "../services/postgres";
import { checkRateLimit, rateLimitKey, type RateLimitConfig } from "../services/rateLimit";
import { MemoryStore } from "../services/store";
import { HttpError, clientIp, corsHeaders, formatRetryAfterSeconds, parseQuery } from "./utils";
import type { Env } from "../types";

type Tab = "breaking" | "macro" | "filings";

const STREAM_POLL_INTERVAL_MS = 5000;
const STREAM_DURATION_MS = 25000;
const STREAM_HEARTBEAT_MS = 10000;
const STREAM_POLL_LIMIT = 20;
const STREAM_CONNECT_LIMIT: RateLimitConfig = { limit: 20, windowMs: 60 * 1000 };

const StreamQuerySchema = z.object({
  tab: z.enum(["breaking", "macro", "filings"]).default("breaking"),
  since: z
    .string()
    .max(40)
    .refine((value) => !Number.isNaN(Date.parse(value)), "must be an ISO timestamp")
    .optional()
});

type StreamEvent = { item_id: string; event_time: string; tab: Tab };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

const encoder = new TextEncoder();

function send(controller: ReadableStreamDefaultController, event: string, payload: unknown): boolean {
  try {
    controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`));
    return true;
  } catch {
    return false;
  }
}

function close(controller: ReadableStreamDefaultController): void {
  try {
    controller.close();
  } catch {
    // already closed by the consumer
  }
}

async function loadNewItems(env: Env, tab: Tab, sinceIso: string): Promise<StreamEvent[]> {
  if (hasDatabase(env)) {
    const rows = await queryFeedSince(env, { tab, sinceIso, limit: STREAM_POLL_LIMIT });
    return rows.map((row) => ({ ...row, tab }));
  }
  // Only reachable in local development (no database + explicit fallback flag).
  return MemoryStore.get()
    .listFeed(tab, "", "GLOBAL")
    .filter((item) => item.event_time > sinceIso)
    .sort((left, right) => left.event_time.localeCompare(right.event_time))
    .slice(0, STREAM_POLL_LIMIT)
    .map((item) => ({ item_id: item.item_id, event_time: item.event_time, tab }));
}

export async function handleStream(request: Request, env: Env): Promise<Response> {
  const userId = await requireUserId(request, env);
  if (!env.RATE_LIMITER_DO) {
    throw new HttpError(503, "Rate limiter is not configured.");
  }
  const limit = await checkRateLimit(
    env.OFP_KV,
    rateLimitKey("stream", `${userId}:${clientIp(request)}`, "connect"),
    STREAM_CONNECT_LIMIT,
    Date.now(),
    env.RATE_LIMITER_DO
  );
  if (!limit.allowed) {
    const seconds = formatRetryAfterSeconds(limit.retryAfterMs);
    throw new HttpError(429, `Stream connect rate limited. Retry after ${seconds} seconds.`, { "retry-after": seconds });
  }

  const { tab, since } = parseQuery(new URL(request.url), StreamQuerySchema);
  if (!hasDatabase(env) && !allowMemoryReadFallback(env)) {
    throw new HttpError(503, "Persistent feed store is unavailable.");
  }

  let cursorIso = since ? new Date(Date.parse(since)).toISOString() : new Date(0).toISOString();

  const stream = new ReadableStream({
    start(controller) {
      void (async () => {
        const startedAt = Date.now();
        const seen = new Set<string>();
        let lastSentAt = Date.now();

        while (Date.now() - startedAt < STREAM_DURATION_MS && !request.signal?.aborted) {
          const items = await loadNewItems(env, tab, cursorIso);
          for (const item of items) {
            if (seen.has(item.item_id)) {
              continue;
            }
            seen.add(item.item_id);
            if (!send(controller, "item", item)) {
              close(controller);
              return;
            }
            lastSentAt = Date.now();
            if (item.event_time > cursorIso) {
              cursorIso = item.event_time;
            }
          }

          if (Date.now() - lastSentAt >= STREAM_HEARTBEAT_MS) {
            if (!send(controller, "heartbeat", { status: "heartbeat", ts: new Date().toISOString() })) {
              close(controller);
              return;
            }
            lastSentAt = Date.now();
          }
          await sleep(STREAM_POLL_INTERVAL_MS);
        }
        close(controller);
      })().catch((error) => {
        logEvent("error", "stream_failed", describeError(error));
        if (!request.signal?.aborted) {
          send(controller, "error", { error: "stream_failed" });
        }
        close(controller);
      });
    }
  });

  const headers = corsHeaders(request, env);
  headers.set("content-type", "text/event-stream");
  headers.set("cache-control", "no-cache");
  headers.set("x-accel-buffering", "no");
  return new Response(stream, { headers });
}
