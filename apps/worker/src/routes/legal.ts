import { cacheGetJson, cachePutJson } from "../services/cache";
import { hasDatabase } from "../services/db";
import { allowMemoryReadFallback } from "../services/fallbackPolicy";
import { describeError, logEvent } from "../services/log";
import { queryLegal } from "../services/postgres";
import { MemoryStore } from "../services/store";
import { HttpError, okJson } from "./utils";
import type { Env } from "../types";

const CACHE_KEY = "legal:sources:licenses";
const CACHE_TTL_SECONDS = 300;

const STATEMENTS = [
  {
    code: "GDELT_ATTRIBUTION",
    text: "GDELT citation and link are mandatory and displayed in feed/legal."
  },
  {
    code: "SEC_FAIR_ACCESS",
    text: "SEC requests are rate limited (<=10 rps) with declared User-Agent."
  },
  {
    code: "ECB_RAW_LOCK",
    text: "ECB raw statistics are republished unmodified (official revisions are applied as published); derived values are separate."
  }
];

export async function handleLegal(request: Request, env: Env): Promise<Response> {
  const cached = await cacheGetJson<Record<string, unknown>>(env.OFP_KV, CACHE_KEY).catch(() => null);
  if (cached) {
    return okJson(request, env, cached, { cache: { hit: true, ttl: CACHE_TTL_SECONDS } });
  }

  let payload: Record<string, unknown>;
  if (hasDatabase(env)) {
    payload = { ...(await queryLegal(env)), statements: STATEMENTS };
  } else if (allowMemoryReadFallback(env)) {
    const store = MemoryStore.get();
    payload = { sources: store.sources, licenses: store.licenses, statements: STATEMENTS };
  } else {
    throw new HttpError(503, "Persistent legal store is unavailable.");
  }

  await cachePutJson(env.OFP_KV, CACHE_KEY, payload, CACHE_TTL_SECONDS).catch((error) =>
    logEvent("warn", "kv_cache_put_failed", { key: CACHE_KEY, ...describeError(error) })
  );
  return okJson(request, env, payload, { cache: { hit: false, ttl: CACHE_TTL_SECONDS } });
}
