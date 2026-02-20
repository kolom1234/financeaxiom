import type { ApiEnvelope, FeedItemPayload } from "@ofp/shared";
import { fallbackFeed, fallbackGeo, fallbackIndicators } from "./fallback";
import { API_BASE } from "./apiBase";

export type FeedTab = "breaking" | "filings" | "macro" | "newsindex";

interface EnvelopeMeta {
  generated_at: string;
  cursor: string | null;
  cache: {
    hit: boolean;
    ttl: number;
  };
}

interface EnvelopeResult<T> {
  data: T;
  meta: EnvelopeMeta;
  stale: boolean;
}

export interface FeedResult {
  items: FeedItemPayload[];
  next_cursor: string | null;
  meta: EnvelopeMeta;
  stale: boolean;
}

export interface IndicatorsResult {
  cards: typeof fallbackIndicators;
  meta: EnvelopeMeta;
  stale: boolean;
}

function fallbackMeta(): EnvelopeMeta {
  return {
    generated_at: new Date().toISOString(),
    cursor: null,
    cache: {
      hit: false,
      ttl: 0
    }
  };
}

function fallbackFeedByTab(tab: FeedTab): FeedItemPayload[] {
  switch (tab) {
    case "breaking":
      return fallbackFeed.filter((item) => item.item_type === "gdelt_link" || item.item_type === "sec_filing");
    case "filings":
      return fallbackFeed.filter((item) => item.item_type === "sec_filing" || item.item_type === "fact_flash");
    case "macro":
      return fallbackFeed.filter((item) => item.item_type === "macro_update");
    case "newsindex":
      return fallbackFeed.filter((item) => item.item_type === "gdelt_link");
  }
}

async function fetchEnvelope<T>(path: string, fallbackData: T): Promise<EnvelopeResult<T>> {
  try {
    const response = await fetch(`${API_BASE}${path}`);
    if (!response.ok) {
      throw new Error(`Request failed with ${response.status}`);
    }
    const payload = (await response.json()) as ApiEnvelope<T>;
    return {
      data: payload.data,
      meta: payload.meta ?? fallbackMeta(),
      stale: false
    };
  } catch {
    return {
      data: fallbackData,
      meta: fallbackMeta(),
      stale: true
    };
  }
}

export async function getFeed(
  tab: FeedTab,
  options?: { query?: string; cursor?: string | null; region?: "US" | "EU" | "GLOBAL" }
): Promise<FeedResult> {
  const params = new URLSearchParams({ tab });
  if (options?.query) {
    params.set("query", options.query);
  }
  if (options?.cursor) {
    params.set("cursor", options.cursor);
  }
  if (options?.region) {
    params.set("region", options.region);
  }

  const result = await fetchEnvelope<{ items: FeedItemPayload[]; next_cursor: string | null }>(
    `/api/feed?${params.toString()}`,
    { items: fallbackFeedByTab(tab), next_cursor: null }
  );
  return {
    items: result.data.items,
    next_cursor: result.data.next_cursor,
    meta: result.meta,
    stale: result.stale
  };
}

export async function getIndicators(): Promise<IndicatorsResult> {
  const result = await fetchEnvelope<{ cards: typeof fallbackIndicators }>("/api/indicators/key", {
    cards: fallbackIndicators
  });
  return {
    cards: result.data.cards,
    meta: result.meta,
    stale: result.stale
  };
}

export async function getGeo(): Promise<typeof fallbackGeo> {
  const result = await fetchEnvelope("/api/geo", fallbackGeo);
  return result.data;
}

export async function getEntity(slug: string): Promise<{ entity: { name: string; slug: string }; items: FeedItemPayload[] }> {
  const result = await fetchEnvelope(`/api/entity/${encodeURIComponent(slug)}`, {
    entity: { name: slug.toUpperCase(), slug },
    items: fallbackFeed
  });
  return result.data;
}

export async function getSeries(seriesId: string, mode: "raw" | "derived" = "raw"): Promise<Record<string, unknown>> {
  const result = await fetchEnvelope(`/api/series/${encodeURIComponent(seriesId)}?mode=${mode}`, {
    series_id: seriesId,
    mode,
    title: seriesId,
    observations: []
  });
  return result.data;
}

export async function getFiling(accession: string): Promise<Record<string, unknown>> {
  const result = await fetchEnvelope(`/api/f/${encodeURIComponent(accession)}`, {
    accession,
    company_name: "Unknown",
    form_type: "N/A",
    sec_url: "https://www.sec.gov/"
  });
  return result.data;
}

export async function getLegal(): Promise<Record<string, unknown>> {
  const result = await fetchEnvelope("/api/legal", {
    sources: [],
    licenses: [],
    statements: []
  });
  return result.data;
}
