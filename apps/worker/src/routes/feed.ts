import { z } from "zod";
import type { FeedItemPayload } from "@ofp/shared";
import { compareFeedOrder, decodeFeedCursor, encodeFeedCursor, isAfterCursor } from "../services/cursor";
import { hasDatabase } from "../services/db";
import { allowMemoryReadFallback } from "../services/fallbackPolicy";
import { withOpenSourceLinks } from "../services/links";
import { queryFeed } from "../services/postgres";
import { MemoryStore } from "../services/store";
import { HttpError, okJson, parseQuery } from "./utils";
import type { Env } from "../types";

const PAGE_SIZE = 20;

const FeedQuerySchema = z.object({
  tab: z.enum(["breaking", "filings", "macro", "newsindex"]).default("breaking"),
  query: z
    .string()
    .max(160, "must be 160 characters or fewer")
    .default("")
    .transform((value) => value.trim().replace(/\s+/g, " ")),
  region: z.enum(["US", "EU", "GLOBAL"]).default("GLOBAL"),
  cursor: z.string().max(200).optional()
});

export async function handleFeed(request: Request, env: Env): Promise<Response> {
  const params = parseQuery(new URL(request.url), FeedQuerySchema);
  const cursor = params.cursor ? decodeFeedCursor(params.cursor) : null;
  if (params.cursor && !cursor) {
    throw new HttpError(400, "Invalid query. cursor: malformed pagination cursor");
  }

  let items: FeedItemPayload[];
  let nextCursor: string | null;

  if (hasDatabase(env)) {
    const page = await queryFeed(env, { tab: params.tab, query: params.query, region: params.region, limit: PAGE_SIZE, cursor });
    items = page.items;
    nextCursor = page.nextCursor ? encodeFeedCursor(page.nextCursor) : null;
  } else if (allowMemoryReadFallback(env)) {
    const all = MemoryStore.get()
      .listFeed(params.tab, params.query, params.region)
      .sort(compareFeedOrder)
      .filter((item) => !cursor || isAfterCursor(item, cursor));
    items = withOpenSourceLinks(all.slice(0, PAGE_SIZE));
    const last = items[items.length - 1];
    nextCursor = all.length > PAGE_SIZE && last ? encodeFeedCursor({ eventTime: last.event_time, itemId: last.item_id }) : null;
  } else {
    throw new HttpError(503, "Persistent feed store is unavailable.");
  }

  return okJson(request, env, { items, next_cursor: nextCursor }, { cursor: nextCursor });
}
