import { z } from "zod";
import type { CommercialStatus } from "@ofp/shared";

export const EurostatAllowedGeoSet = new Set([
  "EU",
  "EA",
  "EFTA",
  "AL",
  "BA",
  "MD",
  "ME",
  "MK",
  "RS",
  "TR",
  "UA"
]);

export const LicenseRowSchema = z.object({
  code: z.string().min(1),
  commercial_status: z.enum(["allowed", "conditional", "disallowed"]),
  attribution_required: z.boolean().default(false),
  attribution_template: z.string().optional(),
  policy_url: z.string().url().optional()
});

export type LicenseRow = z.infer<typeof LicenseRowSchema>;

export function assertNoFred(sourceName: string): void {
  if (sourceName.toUpperCase().includes("FRED")) {
    throw new Error("FRED hard block: data ingestion/display is prohibited in production.");
  }
}

export function mustBlockInProduction(status: CommercialStatus): boolean {
  return status !== "allowed";
}

export function requireLicenseSnapshot<T extends { license_id?: string | null }>(input: T): T {
  if (!input.license_id) {
    throw new Error("Missing license snapshot: production display blocked.");
  }
  return input;
}

export function filterEurostatRowsByGeo<T extends { geo?: string | null }>(rows: T[]): T[] {
  return rows.filter((row) => {
    if (!row.geo) {
      return false;
    }
    return EurostatAllowedGeoSet.has(row.geo.toUpperCase());
  });
}

export function shouldQuarantineDataset(input: {
  third_party_flag?: boolean;
  restriction_notes?: string | null;
  unclear_license?: boolean;
}): boolean {
  if (input.third_party_flag) {
    return true;
  }

  if (input.unclear_license) {
    return true;
  }

  if (input.restriction_notes && input.restriction_notes.trim().length > 0) {
    return true;
  }

  return false;
}

export function ensureNewsMetadataOnly(input: Record<string, unknown>): Record<string, unknown> {
  const bannedFields = [
    "publisher_headline",
    "headline_original",
    "article_body",
    "body",
    "publisher_image",
    "image_url",
    "quote_text"
  ];

  for (const key of bannedFields) {
    if (key in input && input[key] != null) {
      throw new Error(`Publisher content field is not allowed: ${key}`);
    }
  }
  return input;
}

export function ecbDerivedSeriesId(rawSeriesCode: string): string {
  return `${rawSeriesCode}__DERIVED`;
}

