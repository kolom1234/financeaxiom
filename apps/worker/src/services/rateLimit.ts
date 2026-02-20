import { cacheGetJson, cachePutJson } from "./cache";
import type { Env } from "../types";
import type { DurableObjectNamespace } from "@cloudflare/workers-types";

type KVLike = NonNullable<Env["OFP_KV"]>;

export type RateLimitResult =
  | {
      allowed: true;
      limit: number;
      remaining: number;
      windowMs: number;
      windowStart: number;
      retryAfterMs: number;
    }
  | {
      allowed: false;
      limit: number;
      remaining: number;
      windowMs: number;
      windowStart: number;
      retryAfterMs: number;
    };

export interface RateLimitConfig {
  limit: number;
  windowMs: number;
}

interface PersistedState {
  windowStart: number;
  count: number;
}

function computeWindowStart(now: number, windowMs: number): number {
  return now - (now % windowMs);
}

function deniedRateLimit(config: RateLimitConfig, nowMs: number): RateLimitResult {
  const windowMs = Math.max(1, config.windowMs);
  const windowStart = computeWindowStart(nowMs, windowMs);
  return {
    allowed: false,
    limit: config.limit,
    remaining: 0,
    windowMs,
    windowStart,
    retryAfterMs: windowMs
  };
}

function isRateLimitResult(value: unknown): value is RateLimitResult {
  if (!value || typeof value !== "object") {
    return false;
  }
  const body = value as Record<string, unknown>;
  return (
    typeof body.allowed === "boolean" &&
    typeof body.limit === "number" &&
    typeof body.remaining === "number" &&
    typeof body.windowMs === "number" &&
    typeof body.windowStart === "number" &&
    typeof body.retryAfterMs === "number"
  );
}

async function checkRateLimitWithDo(
  limiter: DurableObjectNamespace,
  key: string,
  config: RateLimitConfig,
  nowMs: number
): Promise<RateLimitResult | null> {
  const id = limiter.idFromName(key);
  const stub = limiter.get(id);
  const response = await stub.fetch("https://internal/check", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      limit: config.limit,
      windowMs: config.windowMs,
      nowMs
    })
  });
  if (!response.ok) {
    return null;
  }
  const payload = (await response.json().catch(() => null)) as unknown;
  if (!isRateLimitResult(payload)) {
    return null;
  }
  return payload;
}

export async function checkRateLimit(
  kv: KVLike | undefined,
  key: string,
  config: RateLimitConfig,
  nowMs = Date.now(),
  limiter?: DurableObjectNamespace
): Promise<RateLimitResult> {
  if (limiter) {
    try {
      const fromDo = await checkRateLimitWithDo(limiter, key, config, nowMs);
      if (fromDo) {
        return fromDo;
      }
      return deniedRateLimit(config, nowMs);
    } catch (error) {
      console.error("rate_limit_do_failed", { key, error: String((error as Error).message || error) });
      return deniedRateLimit(config, nowMs);
    }
  }

  if (!kv) {
    return {
      allowed: true,
      limit: config.limit,
      remaining: config.limit,
      windowMs: config.windowMs,
      windowStart: computeWindowStart(nowMs, config.windowMs),
      retryAfterMs: 0
    };
  }

  const windowMs = Math.max(1, config.windowMs);
  const windowStart = computeWindowStart(nowMs, windowMs);
  const ttlSeconds = Math.max(1, Math.ceil(windowMs / 1000));
  const current = await cacheGetJson<PersistedState>(kv, key);

  if (!current || current.windowStart !== windowStart) {
    const state: PersistedState = { windowStart, count: 1 };
    await cachePutJson(kv, key, state, ttlSeconds);
    return {
      allowed: true,
      limit: config.limit,
      remaining: config.limit - state.count,
      windowMs,
      windowStart,
      retryAfterMs: 0
    };
  }

  const nextCount = current.count + 1;
  const remaining = Math.max(0, config.limit - nextCount);
  const retryAfterMs = Math.max(0, windowStart + windowMs - nowMs);

  if (nextCount > config.limit) {
    current.count = nextCount;
    await cachePutJson(kv, key, current, ttlSeconds);
    return {
      allowed: false,
      limit: config.limit,
      remaining,
      windowMs,
      windowStart,
      retryAfterMs
    };
  }

  current.count = nextCount;
  await cachePutJson(kv, key, current, ttlSeconds);
  return {
    allowed: true,
    limit: config.limit,
    remaining,
    windowMs,
    windowStart,
    retryAfterMs: 0
  };
}

export function rateLimitKey(namespace: string, userId: string, action: string): string {
  return `rate_limit:${namespace}:${userId}:${action}`;
}
