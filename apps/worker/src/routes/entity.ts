import { fetchEntityFromDb, resolveOpenSourceUrl } from "../services/postgres";
import { allowMemoryReadFallback } from "../services/fallbackPolicy";
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

function filterAllowedLicense(items: FeedItemPayload[]): FeedItemPayload[] {
  return items.filter((item) => item.license.commercial_status === "allowed");
}

export async function handleEntity(request: Request, env: Env, slug: string): Promise<Response> {
  const fromDb = await fetchEntityFromDb(env, slug);
  if (fromDb) {
    if (fromDb.items.length === 0 && fromDb.entity.slug === slug && fromDb.entity.name === slug) {
      return errorJson(request, env, 404, "Entity not found.");
    }
    return okJson(request, env, {
      entity: fromDb.entity,
      items: filterAllowedLicense(applyOpenSourceFallback(fromDb.items))
    });
  }

  if (!allowMemoryReadFallback(env)) {
    return errorJson(request, env, 503, "Persistent entity store is unavailable.");
  }

  const store = MemoryStore.get();
  const entity = store.getEntity(slug);
  if (!entity) {
    return errorJson(request, env, 404, "Entity not found.");
  }
  const items = filterAllowedLicense(applyOpenSourceFallback(store.listEntityFeed(slug)));
  return okJson(request, env, { entity, items });
}
