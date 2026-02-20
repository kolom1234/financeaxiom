import { cacheGetJson, cachePutJson } from "../services/cache";
import { allowMemoryReadFallback } from "../services/fallbackPolicy";
import { fetchFeedFromDb, resolveOpenSourceUrl } from "../services/postgres";
import { MemoryStore } from "../services/store";
import { errorJson, okJson } from "./utils";
import type { Env } from "../types";
import type { FeedItemPayload } from "@ofp/shared";

function applyOpenSourceFallback(items: FeedItemPayload[]): FeedItemPayload[] {
  return items.map((item) => ({
    ...item,
    external_url: resolveOpenSourceUrl({
      externalUrl: item.external_url ?? null,
      itemType: item.item_type,
      headline: item.headline,
      entities: item.entities.map((entity) => ({
        name: entity.name,
        slug: entity.slug
      }))
    })
  }));
}

const ALLOWED_TABS = new Set(["breaking", "filings", "macro", "newsindex"]);

export async function handleFeed(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const tab = url.searchParams.get("tab") ?? "breaking";
  if (!ALLOWED_TABS.has(tab)) {
    return errorJson(request, env, 400, "Invalid tab query.");
  }

  const query = url.searchParams.get("query") ?? "";
  const region = url.searchParams.get("region") ?? "GLOBAL";
  if (query.length > 160) {
    return errorJson(request, env, 400, "query must be 160 characters or fewer.");
  }

  const cursorRaw = url.searchParams.get("cursor");
  const offset = cursorRaw ? Number.parseInt(cursorRaw, 10) : 0;
  if (!Number.isFinite(offset) || Number.isNaN(offset) || offset < 0 || offset > 1000) {
    return errorJson(request, env, 400, "cursor must be an integer between 0 and 1000.");
  }

  const pageSize = 20;
  const cacheKey = `feed:${tab}:${query}:${region}:${offset}`;

  const cached = await cacheGetJson<{ items: unknown[]; next_cursor: string | null }>(env.OFP_KV, cacheKey);
  if (cached) {
    const normalizedCachedItems = applyOpenSourceFallback(cached.items as FeedItemPayload[]);
    return okJson(
      request,
      env,
      { items: normalizedCachedItems, next_cursor: cached.next_cursor },
      { cursor: cached.next_cursor, cache: { hit: true, ttl: 60 } }
    );
  }

  const dbItems = await fetchFeedFromDb(env, {
    tab: tab as "breaking" | "filings" | "macro" | "newsindex",
    query,
    region,
    limit: pageSize,
    offset
  });

  if (!dbItems && !allowMemoryReadFallback(env)) {
    return errorJson(request, env, 503, "Persistent feed store is unavailable.");
  }

  const items = applyOpenSourceFallback(dbItems ?? MemoryStore.get().listFeed(tab as "breaking" | "filings" | "macro" | "newsindex", query, region));
  const sliced = dbItems ? items : items.slice(offset, offset + pageSize);
  const nextCursor = sliced.length === pageSize ? String(offset + pageSize) : null;
  const payload = { items: sliced, next_cursor: nextCursor };

  await cachePutJson(env.OFP_KV, cacheKey, payload, 60);
  return okJson(request, env, payload, { cursor: nextCursor, cache: { hit: false, ttl: 60 } });
}
