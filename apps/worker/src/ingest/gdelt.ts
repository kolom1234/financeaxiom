import { gateB_newsMetadataOnly, gateF_fredHardBlock } from "../compliance/gates";
import type { InternalContentItem } from "../types";

export interface GdeltInput {
  entity: string;
  window: string;
  external_url: string;
  score?: number;
  scoreDelta?: number;
  publisher_headline?: string;
  article_body?: string;
  image_url?: string;
}

const WINDOW_LABEL_MAP: Record<string, string> = {
  "5m": "5-minute",
  "10m": "10-minute"
};

function normalizeEntity(input: string): string {
  return input.trim();
}

function describeWindow(window: string): string {
  return WINDOW_LABEL_MAP[window] ?? `${window} window`;
}

export function buildGdeltHeadline(input: GdeltInput): string {
  const entity = normalizeEntity(input.entity);
  const base = `${entity} index activity (${describeWindow(input.window)})`;
  if (input.score === undefined || input.score === null) {
    return base;
  }
  const mentions = Math.round(input.score);
  const delta = input.scoreDelta;
  if (delta === undefined || delta === null) {
    return `${base}: ${mentions} mentions`;
  }
  const deltaText = delta > 0 ? ` +${Math.round(delta)} vs previous` : ` ${Math.round(delta)} vs previous`;
  return `${base}: ${mentions} mentions${deltaText}`;
}

export function buildGdeltSearchUrl(entity: string): string {
  const query = encodeURIComponent(entity.trim());
  return `https://api.gdeltproject.org/api/v2/doc/doc?query=${query}&mode=artlist&format=html&sort=datedesc&maxrecords=5`;
}

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
      window: input.window,
      score: input.score ?? null
    }
  };
}
