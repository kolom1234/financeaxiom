import { gateB_newsMetadataOnly, gateF_fredHardBlock } from "../compliance/gates";
import { buildGdeltSearchUrl } from "../services/links";
import type { InternalContentItem } from "../types";

export { buildGdeltSearchUrl };

/** GDELT DOC API timelines use 15-minute steps for timespans under 72 hours. */
export const GDELT_TIMESPAN = "24h";
export const GDELT_INTERVAL_MINUTES = 15;

export interface GdeltInput {
  entity: string;
  external_url: string;
  /** Distinct articles matched in the latest complete interval (TimelineVolRaw). */
  articleCount?: number;
  /** Change versus the previous interval. */
  articleDelta?: number;
  publisher_headline?: string;
  article_body?: string;
  image_url?: string;
}

export interface GdeltTimelinePoint {
  intervalEnd: string;
  value: number;
}

export function buildGdeltHeadline(input: Pick<GdeltInput, "entity" | "articleCount" | "articleDelta">): string {
  const base = `${input.entity.trim()} index activity (${GDELT_INTERVAL_MINUTES}-minute)`;
  if (input.articleCount === undefined) {
    return base;
  }
  const count = `${base}: ${Math.round(input.articleCount)} articles`;
  if (input.articleDelta === undefined) {
    return count;
  }
  const delta = Math.round(input.articleDelta);
  return `${count} ${delta > 0 ? `+${delta}` : String(delta)} vs previous`;
}

/** "20261105T001500Z" -> ISO string. */
function parseGdeltDate(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const match = value.match(/^(\d{4})(\d{2})(\d{2})T?(\d{2})(\d{2})(\d{2})Z?$/);
  if (!match) {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
  }
  return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}.000Z`;
}

/**
 * Parses TimelineVolRaw JSON. Accepts both `{timeline:[{series, data:[{date,value}]}]}`
 * and a flat `{timeline:[{date,value}]}`. The final interval is dropped because it
 * may still be accumulating articles, which would bias "vs previous" downwards.
 */
export function parseGdeltTimeline(json: unknown): GdeltTimelinePoint[] {
  const timeline = (json as { timeline?: unknown })?.timeline;
  if (!Array.isArray(timeline) || timeline.length === 0) {
    return [];
  }
  const first = timeline[0] as Record<string, unknown>;
  const rawPoints = Array.isArray(first?.data) ? (first.data as unknown[]) : timeline;
  const points: GdeltTimelinePoint[] = [];
  for (const raw of rawPoints) {
    const entry = raw as Record<string, unknown>;
    const intervalEnd = parseGdeltDate(entry.date);
    const value = typeof entry.value === "number" ? entry.value : Number(entry.value);
    if (intervalEnd && Number.isFinite(value)) {
      points.push({ intervalEnd, value });
    }
  }
  points.sort((left, right) => left.intervalEnd.localeCompare(right.intervalEnd));
  return points.slice(0, -1);
}

/** Metadata-only GDELT record (Gate B: no publisher headline/body/image; Gate F: no FRED). */
export function transformGdeltRecord(input: GdeltInput): InternalContentItem {
  gateF_fredHardBlock("GDELT");
  gateB_newsMetadataOnly(input as unknown as Record<string, unknown>);

  return {
    item_id: crypto.randomUUID(),
    item_type: "gdelt_link",
    event_time: new Date().toISOString(),
    headline_generated: buildGdeltHeadline(input),
    summary_generated: "Detected via index metadata. Open original sources for full coverage.",
    external_url: input.external_url,
    source_name: "GDELT",
    source_policy_url: "https://www.gdeltproject.org/about.html",
    license_code: "GDELT",
    commercial_status: "allowed",
    attribution_text: "Index data: GDELT (citation + link).",
    disclaimer_text: "Publisher content is not hosted on this site.",
    entity_slugs: [input.entity.toLowerCase()],
    is_breaking: true,
    region: "GLOBAL",
    meta: {
      interval_minutes: GDELT_INTERVAL_MINUTES,
      mention_count: input.articleCount ?? null
    }
  };
}
