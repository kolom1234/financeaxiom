type KVLike = {
  get: (key: string) => Promise<string | null>;
  put: (key: string, value: string, options?: { expirationTtl?: number }) => Promise<void>;
  delete?: (key: string) => Promise<void>;
};

export async function cacheGetJson<T>(kv: KVLike | undefined, key: string): Promise<T | null> {
  if (!kv) {
    return null;
  }
  const raw = await kv.get(key);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    console.error("cache_get_json_parse_error", { key, error: String((error as Error).message || error) });
    await kv.delete?.(key);
    return null;
  }
}

export async function cachePutJson(
  kv: KVLike | undefined,
  key: string,
  value: unknown,
  expirationTtl: number
): Promise<void> {
  if (!kv) {
    return;
  }
  await kv.put(key, JSON.stringify(value), { expirationTtl });
}
