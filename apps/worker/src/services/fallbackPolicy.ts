import type { Env } from "../types";

export function allowMemoryReadFallback(env: Env): boolean {
  return env.ALLOW_MEMORY_READ_FALLBACK === "1" || env.TEST_AUTH_BYPASS === "1";
}

