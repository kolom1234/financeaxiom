import { cacheGetJson, cachePutJson } from "../services/cache";
import { allowMemoryReadFallback } from "../services/fallbackPolicy";
import { fetchIndicatorsFromDb } from "../services/postgres";
import { MemoryStore } from "../services/store";
import { errorJson, okJson } from "./utils";
import type { Env, KeyIndicatorCard } from "../types";

export async function handleIndicators(request: Request, env: Env): Promise<Response> {
  const cacheKey = "indicators:key";
  const cached = await cacheGetJson<KeyIndicatorCard[]>(env.OFP_KV, cacheKey);
  if (cached) {
    return okJson(request, env, { cards: cached }, { cache: { hit: true, ttl: 120 } });
  }

  const fromDb = await fetchIndicatorsFromDb(env);
  if (!fromDb && !allowMemoryReadFallback(env)) {
    return errorJson(request, env, 503, "Persistent indicator store is unavailable.");
  }
  const cards =
    fromDb ??
    MemoryStore.get()
      .keyIndicators.filter((card) => card.license.commercial_status === "allowed")
      .slice(0, 10);
  await cachePutJson(env.OFP_KV, cacheKey, cards, 120);
  return okJson(request, env, { cards }, { cache: { hit: false, ttl: 120 } });
}
