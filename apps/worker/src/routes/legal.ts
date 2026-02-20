import { cacheGetJson, cachePutJson } from "../services/cache";
import { allowMemoryReadFallback } from "../services/fallbackPolicy";
import { fetchLegalFromDb } from "../services/postgres";
import { MemoryStore } from "../services/store";
import { errorJson, okJson } from "./utils";
import type { Env } from "../types";

export async function handleLegal(request: Request, env: Env): Promise<Response> {
  const cacheKey = "legal:sources:licenses";
  const cached = await cacheGetJson<Record<string, unknown>>(env.OFP_KV, cacheKey);
  if (cached) {
    return okJson(request, env, cached, { cache: { hit: true, ttl: 300 } });
  }

  const fromDb = await fetchLegalFromDb(env);
  if (fromDb) {
    const payload = {
      ...fromDb,
      statements: [
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
          text: "ECB raw statistics are unmodified; derived values are separate."
        }
      ]
    };
    await cachePutJson(env.OFP_KV, cacheKey, payload, 300);
    return okJson(request, env, payload, { cache: { hit: false, ttl: 300 } });
  }

  if (!allowMemoryReadFallback(env)) {
    return errorJson(request, env, 503, "Persistent legal store is unavailable.");
  }

  const store = MemoryStore.get();
  const payload = {
    sources: store.sources,
    licenses: store.licenses,
    statements: [
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
        text: "ECB raw statistics are unmodified; derived values are separate."
      }
    ]
  };
  await cachePutJson(env.OFP_KV, cacheKey, payload, 300);
  return okJson(request, env, payload, { cache: { hit: false, ttl: 300 } });
}
