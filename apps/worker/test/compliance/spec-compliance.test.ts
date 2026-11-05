import { describe, expect, it } from "vitest";
import { transformGdeltRecord } from "../../src/ingest/gdelt";
import { applyEurostatFilter, assertRawValueUnmodified } from "../../src/ingest/macro";
import { parseEcbCsv } from "../../src/ingest/sources/ecb";
import { SlidingWindowPerSecondLimiter } from "../../src/services/rateLimiter";
import { gateF_fredHardBlock } from "../../src/compliance/gates";
import { ALLOWED_INGEST_JOBS } from "../../src/ingest/types";

describe("SPEC compliance tests", () => {
  it("gdelt_metadata_only", () => {
    const transformed = transformGdeltRecord({
      entity: "NVIDIA",
      external_url: "https://api.gdeltproject.org/api/v2/doc/doc?query=NVIDIA&mode=artlist&format=html&sort=datedesc&maxrecords=5"
    });
    expect(transformed.headline_generated.length).toBeGreaterThan(0);
    expect(transformed.meta).not.toHaveProperty("article_body");
    expect(transformed.meta).not.toHaveProperty("publisher_headline");
  });

  it("eurostat_geo_filter", () => {
    const rows = [
      { geo: "EU", value: 1 },
      { geo: "EFTA", value: 2 },
      { geo: "US", value: 3 }
    ];
    const filtered = applyEurostatFilter(rows);
    expect(filtered).toEqual([
      { geo: "EU", value: 1 },
      { geo: "EFTA", value: 2 }
    ]);
  });

  it("ecb_raw_unmodified", () => {
    // Raw ECB values are kept byte-for-byte as published (no re-formatting such as "121.80" -> "121.8").
    const csv = "KEY,FREQ,REF_AREA,ADJUSTMENT,ICP_ITEM,STS_INSTITUTION,ICP_SUFFIX,TIME_PERIOD,OBS_VALUE\nICP.M,M,U2,N,000000,4,INX,2026-01,121.80";
    const [point] = parseEcbCsv(csv);
    expect(point?.valueRaw).toBe("121.80");
    expect(() => assertRawValueUnmodified("121.80", point!.valueRaw)).not.toThrow();
    expect(() => assertRawValueUnmodified("121.80", "121.8")).toThrow(/modified/);
  });

  it("sec_rate_limit", () => {
    const limiter = new SlidingWindowPerSecondLimiter(10);
    const now = Date.now();
    let accepted = 0;
    for (let i = 0; i < 100; i += 1) {
      if (limiter.acquire(now + i)) {
        accepted += 1;
      }
    }
    expect(accepted).toBe(10);
  });

  it("fred_blocked", () => {
    expect(() => gateF_fredHardBlock("FRED")).toThrow();
    expect(ALLOWED_INGEST_JOBS.includes("INGEST_GDELT")).toBe(true);
    expect((ALLOWED_INGEST_JOBS as string[]).some((job) => job.includes("FRED"))).toBe(false);
  });
});
