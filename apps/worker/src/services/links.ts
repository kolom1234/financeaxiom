import type { FeedItemPayload } from "@ofp/shared";

const GDELT_SEARCH_BASE_URL = "https://api.gdeltproject.org/api/v2/doc/doc";
const GDELT_DOC_PATH = "/api/v2/doc/doc";
const GDELT_MAX_RECORDS = 5;

interface EntityInfo {
  name: string;
  slug?: string;
}

export interface MappedFeedItemInput {
  externalUrl: string | null;
  itemType: FeedItemPayload["item_type"];
  headline: string;
  entities: EntityInfo[];
}

/** Public GDELT article-list search for an entity (link-out only, no content is fetched). */
export function buildGdeltSearchUrl(entity: string): string {
  return `${GDELT_SEARCH_BASE_URL}?query=${encodeURIComponent(entity.trim())}&mode=artlist&format=html&sort=datedesc&maxrecords=${GDELT_MAX_RECORDS}`;
}

function normalizeGdeltSearchUrl(value: string): string {
  try {
    const parsed = new URL(value);
    if (parsed.hostname.toLowerCase() !== "api.gdeltproject.org") {
      return value;
    }
    if (!parsed.pathname.startsWith(`${GDELT_DOC_PATH}/`) && parsed.pathname !== GDELT_DOC_PATH) {
      return value;
    }
    parsed.pathname = GDELT_DOC_PATH;
    parsed.searchParams.set("maxrecords", String(GDELT_MAX_RECORDS));
    return parsed.toString();
  } catch {
    return value;
  }
}

/** Returns an http(s) URL or null; rejects other schemes (javascript:, data:, ...). */
export function normalizeHttpUrl(value: string | null | undefined): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed || trimmed.toLowerCase() === "about:blank") {
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return null;
    }
    const isLegacyGdeltHome =
      parsed.hostname.toLowerCase() === "www.gdeltproject.org" &&
      (parsed.pathname === "/" || parsed.pathname === "" || !parsed.pathname.toLowerCase().includes("/api/"));
    if (isLegacyGdeltHome) {
      return null;
    }
    return normalizeGdeltSearchUrl(parsed.toString());
  } catch {
    return null;
  }
}

function extractGdeltQueryFromHeadline(headline: string): string | null {
  const match = headline.match(/^(.*?)\s+(?:index\s+activity|mentions\s+spike)\b/i);
  return match?.[1]?.trim() ?? null;
}

export function resolveOpenSourceUrl(input: MappedFeedItemInput): string | null {
  const direct = normalizeHttpUrl(input.externalUrl);
  if (direct) {
    return direct;
  }

  if (input.itemType !== "gdelt_link") {
    return null;
  }

  const fromHeadline = extractGdeltQueryFromHeadline(input.headline);
  const fromEntity =
    input.entities.find((entity) => entity.name.trim().length > 0)?.name.trim() ||
    input.entities.find((entity) => entity.slug && entity.slug.trim().length > 0)?.slug?.trim() ||
    "";

  const query = fromHeadline || fromEntity;
  if (!query) {
    return null;
  }

  return buildGdeltSearchUrl(query);
}

/** Normalises every item's outbound link (safe scheme, canonical GDELT search). */
export function withOpenSourceLinks(items: FeedItemPayload[]): FeedItemPayload[] {
  return items.map((item) => ({
    ...item,
    external_url: resolveOpenSourceUrl({
      externalUrl: item.external_url ?? null,
      itemType: item.item_type,
      headline: item.headline,
      entities: item.entities.map((entity) => ({ name: entity.name, slug: entity.slug }))
    })
  }));
}
