import { describe, expect, it } from "vitest";
import {
  assertNoFred,
  ensureNewsMetadataOnly,
  filterEurostatRowsByGeo,
  mustBlockInProduction,
  shouldQuarantineDataset
} from "./index";

describe("policy gates", () => {
  it("blocks FRED sources", () => {
    expect(() => assertNoFred("FRED")).toThrowError(/hard block/i);
    expect(() => assertNoFred("BLS")).not.toThrow();
  });

  it("blocks conditional/disallowed in production", () => {
    expect(mustBlockInProduction("allowed")).toBe(false);
    expect(mustBlockInProduction("conditional")).toBe(true);
    expect(mustBlockInProduction("disallowed")).toBe(true);
  });

  it("filters eurostat rows", () => {
    const rows = [
      { geo: "EU", value: 1 },
      { geo: "US", value: 2 },
      { geo: "EFTA", value: 3 }
    ];
    expect(filterEurostatRowsByGeo(rows)).toEqual([
      { geo: "EU", value: 1 },
      { geo: "EFTA", value: 3 }
    ]);
  });

  it("quarantines restricted datasets", () => {
    expect(shouldQuarantineDataset({})).toBe(false);
    expect(shouldQuarantineDataset({ third_party_flag: true })).toBe(true);
    expect(shouldQuarantineDataset({ unclear_license: true })).toBe(true);
    expect(shouldQuarantineDataset({ restriction_notes: "extra terms" })).toBe(true);
  });

  it("rejects publisher content fields", () => {
    expect(() =>
      ensureNewsMetadataOnly({ publisher_headline: "from publisher", external_url: "https://x.test" })
    ).toThrowError(/not allowed/i);
    expect(() => ensureNewsMetadataOnly({ external_url: "https://x.test" })).not.toThrow();
  });
});

