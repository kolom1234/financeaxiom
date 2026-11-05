import { cacheGetJson, cachePutJson } from "../services/cache";
import { hasDatabase } from "../services/db";
import { allowMemoryReadFallback } from "../services/fallbackPolicy";
import { describeError, logEvent } from "../services/log";
import { queryIndicators } from "../services/postgres";
import { MemoryStore } from "../services/store";
import { HttpError, okJson } from "./utils";
import type { Env, KeyIndicatorCard } from "../types";

const CACHE_KEY = "indicators:key:v2";
const CACHE_TTL_SECONDS = 120;

export async function handleIndicators(request: Request, env: Env): Promise<Response> {
  const cached = await cacheGetJson<KeyIndicatorCard[]>(env.OFP_KV, CACHE_KEY).catch(() => null);
  if (cached) {
    return okJson(request, env, { cards: cached }, { cache: { hit: true, ttl: CACHE_TTL_SECONDS } });
  }

  let cards: KeyIndicatorCard[];
  if (hasDatabase(env)) {
    cards = await queryIndicators(env);
  } else if (allowMemoryReadFallback(env)) {
    cards = MemoryStore.get()
      .keyIndicators.filter((card) => card.license.commercial_status === "allowed")
      .slice(0, 10);
  } else {
    throw new HttpError(503, "Persistent indicator store is unavailable.");
  }

  await cachePutJson(env.OFP_KV, CACHE_KEY, cards, CACHE_TTL_SECONDS).catch((error) =>
    logEvent("warn", "kv_cache_put_failed", { key: CACHE_KEY, ...describeError(error) })
  );
  return okJson(request, env, { cards }, { cache: { hit: false, ttl: CACHE_TTL_SECONDS } });
}
