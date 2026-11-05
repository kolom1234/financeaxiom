import { hasDatabase } from "../services/db";
import { allowMemoryReadFallback } from "../services/fallbackPolicy";
import { withOpenSourceLinks } from "../services/links";
import { queryEntity } from "../services/postgres";
import { MemoryStore } from "../services/store";
import { entitySlug, parsePathParam } from "./schemas";
import { HttpError, okJson } from "./utils";
import type { Env } from "../types";

export async function handleEntity(request: Request, env: Env, rawSlug: string): Promise<Response> {
  const slug = parsePathParam(entitySlug, rawSlug.toLowerCase());
  if (!slug) {
    throw new HttpError(400, "Invalid entity slug.");
  }

  if (hasDatabase(env)) {
    const result = await queryEntity(env, slug);
    if (!result) {
      throw new HttpError(404, "Entity not found.");
    }
    return okJson(request, env, result);
  }

  if (!allowMemoryReadFallback(env)) {
    throw new HttpError(503, "Persistent entity store is unavailable.");
  }

  const store = MemoryStore.get();
  const entity = store.getEntity(slug);
  if (!entity) {
    throw new HttpError(404, "Entity not found.");
  }
  const items = withOpenSourceLinks(store.listEntityFeed(slug)).filter((item) => item.license.commercial_status === "allowed");
  return okJson(request, env, {
    entity: { slug: entity.slug, name: entity.name, primary_ticker: entity.primary_ticker ?? null },
    items
  });
}
