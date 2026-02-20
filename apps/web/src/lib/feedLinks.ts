import type { FeedItemPayload } from "@ofp/shared";

const GDELT_SEARCH_BASE_URL = "https://api.gdeltproject.org/api/v2/doc/doc";
const GDELT_MAX_RECORDS = 5;
const GDELT_DOC_PATH = "/api/v2/doc/doc";
const GDELT_SOURCE_PREVIEW_PATH = "/source/gdelt";

function toSafeNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, "").trim());
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function toTrimmedString(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function isValidHttpUrl(value: string): string | null {
  const trimmed = value.trim();
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
    return normalizeGdeltSearchUrl(parsed);
  } catch {
    return null;
  }
}

function normalizeGdeltSearchUrl(parsed: URL): string {
  if (parsed.hostname.toLowerCase() !== "api.gdeltproject.org") {
    return parsed.toString();
  }
  if (!parsed.pathname.startsWith(`${GDELT_DOC_PATH}/`) && parsed.pathname !== GDELT_DOC_PATH) {
    return parsed.toString();
  }

  parsed.pathname = GDELT_DOC_PATH;

  parsed.searchParams.set("maxrecords", String(GDELT_MAX_RECORDS));
  return parsed.toString();
}

function buildGdeltSearchUrl(query: string): string {
  return `${GDELT_SEARCH_BASE_URL}?query=${encodeURIComponent(query)}&mode=artlist&format=html&sort=datedesc&maxrecords=${GDELT_MAX_RECORDS}`;
}

function extractGdeltQueryFromHeadline(headline: string): string | null {
  const trimmed = headline.trim();
  if (!trimmed) {
    return null;
  }

  const match = trimmed.match(/^(.*?)\s+(?:index\s+activity|mentions\s+spike)\b/i);
  if (match?.[1]) {
    return match[1].trim();
  }
  return null;
}

function extractGdeltQueryFromMeta(item: FeedItemPayload): string | null {
  if (typeof item.meta?.query === "string" && item.meta.query.trim().length > 0) {
    return item.meta.query.trim();
  }
  return (
    extractGdeltQueryFromHeadline(item.headline) ||
    item.entities.find((entry) => entry.name.trim().length > 0)?.name.trim() ||
    item.entities.find((entry) => entry.primary_ticker?.trim().length ?? 0 > 0)?.primary_ticker?.trim() ||
    null
  );
}

function extractGdeltDisplayTitle(item: FeedItemPayload): string {
  const query = extractGdeltQueryFromMeta(item);
  if (query) {
    return `${query} Index Signal`;
  }
  return "Index Signal";
}

function safeCountText(value: unknown): string {
  const numeric = toSafeNumber(value);
  if (numeric === null) {
    return "n/a";
  }
  return Math.round(numeric).toLocaleString("en-US");
}

function isValidSearchParamValue(value: string): boolean {
  return value.trim().length > 0;
}

export function buildGdeltSourcePreviewUrl(item: FeedItemPayload): string {
  const params = new URLSearchParams();
  const title = extractGdeltDisplayTitle(item);
  const query = extractGdeltQueryFromMeta(item);
  const mentionText = safeCountText(item.meta?.mention_count);
  const sourceText = safeCountText(item.meta?.source_count);

  params.set("title", title);
  params.set("mentions", mentionText);
  params.set("sources", sourceText);

  if (query && isValidSearchParamValue(query)) {
    params.set("query", query);
  }

  const direct = isValidHttpUrl(toTrimmedString(item.external_url));
  if (direct) {
    params.set("external", direct);
  }

  return `${GDELT_SOURCE_PREVIEW_PATH}?${params.toString()}`;
}

export function resolveOpenSourceUrl(item: FeedItemPayload): string | null {
  const direct = isValidHttpUrl(toTrimmedString(item.external_url));
  if (direct) {
    return direct;
  }

  if (item.item_type !== "gdelt_link") {
    return null;
  }

  const fromHeadline = extractGdeltQueryFromHeadline(item.headline);
  const fromEntityName = item.entities.find((entry) => entry.name.trim().length > 0)?.name;
  const fromEntityTicker = item.entities.find((entry) => (entry.primary_ticker?.trim().length ?? 0) > 0)?.primary_ticker?.trim();

  const query = fromHeadline || fromEntityName || fromEntityTicker;
  if (!query) {
    return null;
  }

  return buildGdeltSearchUrl(query);
}
