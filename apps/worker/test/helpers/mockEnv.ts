import type { Env } from "../../src/types";

class MemoryKV implements KVNamespace {
  private store = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async getWithMetadata(): Promise<KVNamespaceGetWithMetadataResult<string>> {
    throw new Error("Not implemented in tests.");
  }

  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  async list(): Promise<KVNamespaceListResult<null>> {
    return {
      keys: [],
      list_complete: true,
      cacheStatus: null
    };
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}

interface MockRateLimitState {
  windowStart: number;
  count: number;
}

function computeWindowStart(nowMs: number, windowMs: number): number {
  return nowMs - (nowMs % windowMs);
}

function createMockRateLimiterNamespace(): DurableObjectNamespace {
  const stateByKey = new Map<string, MockRateLimitState>();

  return {
    idFromName(name: string): DurableObjectId {
      return {
        toString(): string {
          return name;
        }
      } as DurableObjectId;
    },
    newUniqueId(): DurableObjectId {
      const value = crypto.randomUUID();
      return {
        toString(): string {
          return value;
        }
      } as DurableObjectId;
    },
    get(id: DurableObjectId): DurableObjectStub {
      const key = id.toString();
      return {
        async fetch(_input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
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
      } as DurableObjectStub;
    }
  } as DurableObjectNamespace;
}

function base64Key32(): string {
  const bytes = new Uint8Array(32);
  bytes.fill(7);
  return Buffer.from(bytes).toString("base64");
}

export function createMockEnv(overrides: Partial<Env> = {}): Env {
  return {
    OFP_KV: new MemoryKV(),
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
