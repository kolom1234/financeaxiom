import {
  assertNoFred,
  ensureNewsMetadataOnly,
  filterEurostatRowsByGeo,
  requireLicenseSnapshot,
  shouldQuarantineDataset
} from "@ofp/policy";

export function gateA_licenseSnapshot<T extends { license_id?: string | null }>(input: T): T {
  return requireLicenseSnapshot(input);
}

export function gateB_newsMetadataOnly(input: Record<string, unknown>): Record<string, unknown> {
  return ensureNewsMetadataOnly(input);
}

export function gateC_eurostatGeo<T extends { geo?: string | null }>(rows: T[]): T[] {
  return filterEurostatRowsByGeo(rows);
}

/**
 * Gate D: raw-locked statistics (ECB) are stored byte-for-byte as published.
 * Official revisions replace the stored value (previous value kept in
 * series_observation_revisions); derived values live in separate series.
 */
export function gateD_rawValueUnmodified(published: string, stored: string): boolean {
  return published === stored;
}

export function gateE_restrictedDataset(input: {
  third_party_flag?: boolean;
  restriction_notes?: string | null;
  unclear_license?: boolean;
}): boolean {
  return shouldQuarantineDataset(input);
}

export function gateF_fredHardBlock(sourceName: string): void {
  assertNoFred(sourceName);
}

export function gateG_secDeclaredUserAgent(userAgent: string | undefined): boolean {
  if (!userAgent) {
    return false;
  }
  const hasEmail = userAgent.includes("@");
  const hasCompanyText = userAgent.trim().split(" ").length >= 2;
  return hasEmail && hasCompanyText;
}

