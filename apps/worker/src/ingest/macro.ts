import { gateC_eurostatGeo, gateD_rawValueUnmodified, gateE_restrictedDataset } from "../compliance/gates";

export interface MacroRow {
  geo?: string | null;
  value: number;
}

export function applyEurostatFilter<T extends MacroRow>(rows: T[]): T[] {
  return gateC_eurostatGeo(rows);
}

/** Throws if a stored raw value differs from the published text (raw values must not be transformed). */
export function assertRawValueUnmodified(published: string, stored: string): void {
  if (!gateD_rawValueUnmodified(published, stored)) {
    throw new Error("Raw-locked value was modified before storage.");
  }
}

export function shouldBlockDatasetForProduction(input: {
  third_party_flag?: boolean;
  restriction_notes?: string | null;
  unclear_license?: boolean;
}): boolean {
  return gateE_restrictedDataset(input);
}
