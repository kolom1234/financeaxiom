import type { ApiEnvelope, FeedItemPayload, RegionPolicy } from "@ofp/shared";
import { API_BASE } from "./apiBase";

export type FeedTab = "breaking" | "filings" | "macro" | "newsindex";

export interface EnvelopeMeta {
  generated_at: string;
  cursor: string | null;
  cache: {
    hit: boolean;
    ttl: number;
  };
}

/** Indicator card as served by /api/indicators/key. */
export interface IndicatorCard {
  series_id: string;
  series_code: string;
  title: string;
  units: string;
  is_derived: boolean;
  latest_value: number;
  /** ISO date (YYYY-MM-DD) of the latest observation. */
  period: string;
  /** Year-over-year % change; null for series already expressed in %. */
  yoy: number | null;
  /** Latest minus previous observation, in change_unit ("pp" for % series). */
  change: number | null;
  change_unit: string;
  sparkline: number[];
  source: { name: string; policy_url?: string };
  license: { code?: string; commercial_status?: string; attribution_text: string; disclaimer_text?: string };
}

export interface GeoPayload {
  country: string;
  us_state_code: string | null;
  us_state_privacy_required: boolean;
  region_policy: RegionPolicy;
  location_known?: boolean;
}

/**
 * `stale` is true when the live request failed. In that case the data is the
 * last response this browser actually received for the same request (`asOf`),
 * or empty if there is none. Nothing is ever fabricated.
 */
interface ApiResult<T> {
  data: T;
  meta: EnvelopeMeta;
  stale: boolean;
  status: number;
  error: string | null;
  asOf: string | null;
}

const lastGood = new Map<string, { data: unknown; meta: EnvelopeMeta; receivedAt: string }>();

function emptyMeta(): EnvelopeMeta {
  return { generated_at: new Date().toISOString(), cursor: null, cache: { hit: false, ttl: 0 } };
}

async function fetchEnvelope<T>(path: string, empty: T): Promise<ApiResult<T>> {
  let status = 0;
  let error: string;
  try {
    const response = await fetch(`${API_BASE}${path}`);
    status = response.status;
    const payload = (await response.json().catch(() => null)) as (ApiEnvelope<T> & { error?: { message?: string } }) | null;
    if (response.ok && payload && "data" in payload) {
      const meta = payload.meta ?? emptyMeta();
      lastGood.set(path, { data: payload.data, meta, receivedAt: new Date().toISOString() });
      return { data: payload.data, meta, stale: false, status, error: null, asOf: null };
    }
    error = payload?.error?.message ?? `Request failed with ${response.status}`;
  } catch (cause) {
    error = cause instanceof Error ? cause.message : "Network error";
  }

  // 4xx answers are definitive (e.g. not found): never substitute other data for them.
  const previous = status >= 400 && status < 500 && status !== 429 ? undefined : lastGood.get(path);
  return {
    data: (previous?.data as T | undefined) ?? empty,
    meta: previous?.meta ?? emptyMeta(),
    stale: true,
    status,
    error,
    asOf: previous?.receivedAt ?? null
  };
}

export interface FeedResult {
  items: FeedItemPayload[];
  next_cursor: string | null;
  meta: EnvelopeMeta;
  stale: boolean;
  error: string | null;
  asOf: string | null;
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
  const result = await fetchEnvelope<{ items: FeedItemPayload[]; next_cursor: string | null }>(`/api/feed?${params.toString()}`, {
    items: [],
    next_cursor: null
  });
  return {
    items: result.data.items,
    next_cursor: result.data.next_cursor,
    meta: result.meta,
    stale: result.stale,
    error: result.error,
    asOf: result.asOf
  };
}

export interface IndicatorsResult {
  cards: IndicatorCard[];
  meta: EnvelopeMeta;
  stale: boolean;
  error: string | null;
  asOf: string | null;
}

export async function getIndicators(): Promise<IndicatorsResult> {
  const result = await fetchEnvelope<{ cards: IndicatorCard[] }>("/api/indicators/key", { cards: [] });
  return { cards: result.data.cards, meta: result.meta, stale: result.stale, error: result.error, asOf: result.asOf };
}

/**
 * Visitor region for consent purposes. If it cannot be determined, the
 * strictest policy (EU/UK/CH: prior consent + TCF signal) is applied.
 */
export async function getGeo(): Promise<GeoPayload> {
  const result = await fetchEnvelope<GeoPayload | null>("/api/geo", null);
  if (result.stale || !result.data) {
    return { country: "XX", us_state_code: null, us_state_privacy_required: false, region_policy: "EU_UK_CH", location_known: false };
  }
  return result.data;
}

export type LoadState<T> = { status: "ok"; data: T } | { status: "not_found" } | { status: "error"; message: string };

function toLoadState<T>(result: ApiResult<T | null>): LoadState<T> {
  if (!result.stale && result.data !== null) {
    return { status: "ok", data: result.data };
  }
  if (result.status === 404) {
    return { status: "not_found" };
  }
  return { status: "error", message: result.error ?? "Request failed." };
}

export interface EntityResult {
  entity: { name: string; slug: string; primary_ticker?: string | null };
  items: FeedItemPayload[];
}

export async function getEntity(slug: string): Promise<LoadState<EntityResult>> {
  return toLoadState(await fetchEnvelope<EntityResult | null>(`/api/entity/${encodeURIComponent(slug)}`, null));
}

export async function getSeries(seriesId: string, mode: "raw" | "derived" = "raw"): Promise<LoadState<Record<string, unknown>>> {
  return toLoadState(await fetchEnvelope<Record<string, unknown> | null>(`/api/series/${encodeURIComponent(seriesId)}?mode=${mode}`, null));
}

export async function getFiling(accession: string): Promise<LoadState<Record<string, unknown>>> {
  return toLoadState(await fetchEnvelope<Record<string, unknown> | null>(`/api/f/${encodeURIComponent(accession)}`, null));
}

export async function getLegal(): Promise<LoadState<Record<string, unknown>>> {
  return toLoadState(await fetchEnvelope<Record<string, unknown> | null>("/api/legal", null));
}
