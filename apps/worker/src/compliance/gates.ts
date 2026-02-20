import {
  assertNoFred,
  ensureNewsMetadataOnly,
  filterEurostatRowsByGeo,
  requireLicenseSnapshot,
  shouldQuarantineDataset
} from "@ofp/policy";
import { sha256Hex } from "../services/hash";

export function gateA_licenseSnapshot<T extends { license_id?: string | null }>(input: T): T {
  return requireLicenseSnapshot(input);
}

export function gateB_newsMetadataOnly(input: Record<string, unknown>): Record<string, unknown> {
  return ensureNewsMetadataOnly(input);
}

export function gateC_eurostatGeo<T extends { geo?: string | null }>(rows: T[]): T[] {
  return filterEurostatRowsByGeo(rows);
}

export async function gateD_ecbRawImmutability(previousRaw: string, nextRaw: string): Promise<boolean> {
  const prevHash = await sha256Hex(previousRaw);
  const nextHash = await sha256Hex(nextRaw);
  return prevHash === nextHash;
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

