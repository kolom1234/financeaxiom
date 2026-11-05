import type { Env } from "../../src/types";

/** In-memory KV with the subset of the API the worker uses (get/put/delete/list with prefix + metadata). */
export class MemoryKV {
  private store = new Map<string, { value: string; metadata?: unknown }>();
  putCount = 0;

  async get(key: string): Promise<string | null> {
    return this.store.get(key)?.value ?? null;
  }

  async put(key: string, value: string, options?: { expirationTtl?: number; metadata?: unknown }): Promise<void> {
    this.putCount += 1;
    this.store.set(key, { value, metadata: options?.metadata });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async list<M = unknown>(options: { prefix?: string; limit?: number; cursor?: string } = {}): Promise<{
    keys: Array<{ name: string; metadata?: M }>;
    list_complete: boolean;
    cursor?: string;
  }> {
    const names = [...this.store.keys()].filter((name) => name.startsWith(options.prefix ?? "")).sort();
    const start = options.cursor ? Number(options.cursor) : 0;
    const limit = options.limit ?? 1000;
    const page = names.slice(start, start + limit);
    const complete = start + limit >= names.length;
    return {
      keys: page.map((name) => ({ name, metadata: this.store.get(name)?.metadata as M })),
      list_complete: complete,
      ...(complete ? {} : { cursor: String(start + limit) })
    };
  }
}

interface MockRateLimitState {
  windowStart: number;
  count: number;
}

function computeWindowStart(nowMs: number, windowMs: number): number {
  return nowMs - (nowMs % windowMs);
}

function createMockRateLimiterNamespace(): NonNullable<Env["RATE_LIMITER_DO"]> {
  const stateByKey = new Map<string, MockRateLimitState>();

  return {
    idFromName(name: string) {
      return {
        toString(): string {
          return name;
        }
      };
    },
    get(id: { toString(): string }) {
      const key = id.toString();
      return {
        async fetch(_input: unknown, init?: { body?: unknown }): Promise<Response> {
          const raw = typeof init?.body === "string" ? init.body : "{}";
          const parsed = JSON.parse(raw) as { limit?: number; windowMs?: number; nowMs?: number };
          const limit = Math.max(1, Math.floor(Number(parsed.limit ?? 1)));
          const windowMs = Math.max(1, Math.floor(Number(parsed.windowMs ?? 1)));
          const nowMs = Math.floor(Number(parsed.nowMs ?? Date.now()));
          const windowStart = computeWindowStart(nowMs, windowMs);

          const current = stateByKey.get(key);
          if (!current || current.windowStart !== windowStart) {
            stateByKey.set(key, { windowStart, count: 1 });
          } else {
            current.count += 1;
          }

          const state = stateByKey.get(key)!;
          const allowed = state.count <= limit;
          const remaining = Math.max(0, limit - state.count);
          const retryAfterMs = allowed ? 0 : Math.max(0, windowStart + windowMs - nowMs);
          return Response.json({
            allowed,
            limit,
            remaining,
            windowMs,
            windowStart,
            retryAfterMs
          });
        }
      };
    }
  } as unknown as NonNullable<Env["RATE_LIMITER_DO"]>;
}

function base64Key32(): string {
  const bytes = new Uint8Array(32);
  bytes.fill(7);
  return Buffer.from(bytes).toString("base64");
}

export function createMockEnv(overrides: Partial<Env> = {}): Env {
  return {
    OFP_KV: new MemoryKV() as unknown as Env["OFP_KV"],
    RATE_LIMITER_DO: createMockRateLimiterNamespace(),
    TEST_AUTH_BYPASS: "1",
    SUPABASE_ANON_KEY: "test-anon-key",
    AUTH_ALLOWED_REDIRECT_ORIGINS: "http://localhost",
    ALLOW_MEMORY_READ_FALLBACK: "1",
    PUSH_DATA_ENC_KEY: base64Key32(),
    SEC_USER_AGENT: "OpenFinancePulse contact@example.com",
    ...overrides
  };
}
