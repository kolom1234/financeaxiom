import { gateC_eurostatGeo, gateD_ecbRawImmutability, gateE_restrictedDataset } from "../compliance/gates";

export interface MacroRow {
  geo?: string | null;
  value: number;
}

export function applyEurostatFilter<T extends MacroRow>(rows: T[]): T[] {
  return gateC_eurostatGeo(rows);
}

export async function validateEcbRawUnchanged(previousRaw: string, nextRaw: string): Promise<void> {
  const ok = await gateD_ecbRawImmutability(previousRaw, nextRaw);
  if (!ok) {
    throw new Error("ECB raw locked series changed unexpectedly.");
  }
}

export function shouldBlockDatasetForProduction(input: {
  third_party_flag?: boolean;
  restriction_notes?: string | null;
  unclear_license?: boolean;
}): boolean {
  return gateE_restrictedDataset(input);
}
