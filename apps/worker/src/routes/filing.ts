import { fetchFilingFromDb } from "../services/postgres";
import { allowMemoryReadFallback } from "../services/fallbackPolicy";
import { MemoryStore } from "../services/store";
import { errorJson, okJson } from "./utils";
import type { Env } from "../types";

function sanitizeExternalUrl(value: unknown): string {
  if (typeof value !== "string") {
    return "https://www.sec.gov/";
  }
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return "https://www.sec.gov/";
    }
    return parsed.toString();
  } catch {
    return "https://www.sec.gov/";
  }
}

function withSafeFilingUrl(input: Record<string, unknown>): Record<string, unknown> {
  return {
    ...input,
    sec_url: sanitizeExternalUrl(input.sec_url)
  };
}

export async function handleFiling(request: Request, env: Env, accession: string): Promise<Response> {
  const fromDb = await fetchFilingFromDb(env, accession);
  if (fromDb) {
    return okJson(request, env, {
      ...withSafeFilingUrl(fromDb),
      note: "SEC metadata only. Filing text is available on SEC.gov."
    });
  }

  if (!allowMemoryReadFallback(env)) {
    return errorJson(request, env, 503, "Persistent filing store is unavailable.");
  }

  const filing = MemoryStore.get().getFiling(accession);
  if (!filing) {
    return errorJson(request, env, 404, "Filing not found.");
  }
  return okJson(request, env, {
    ...withSafeFilingUrl(filing as unknown as Record<string, unknown>),
    note: "SEC metadata only. Filing text is available on SEC.gov."
  });
}
