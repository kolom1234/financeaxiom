import { describe, expect, it } from "vitest";
import { transformGdeltRecord } from "../../src/ingest/gdelt";
import { applyEurostatFilter, validateEcbRawUnchanged } from "../../src/ingest/macro";
import { SlidingWindowPerSecondLimiter } from "../../src/services/rateLimiter";
import { gateF_fredHardBlock } from "../../src/compliance/gates";
import { ALLOWED_INGEST_JOBS } from "../../src/ingest/types";

describe("SPEC compliance tests", () => {
  it("gdelt_metadata_only", () => {
    const transformed = transformGdeltRecord({
      entity: "NVIDIA",
      window: "6h",
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

  it("ecb_raw_immutable", async () => {
    await expect(validateEcbRawUnchanged("121.8", "121.8")).resolves.toBeUndefined();
    await expect(validateEcbRawUnchanged("121.8", "121.9")).rejects.toThrow(/changed unexpectedly/);
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
