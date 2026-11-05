import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../../src/index";
import { handleIngestJob } from "../../src/ingest/queue";
import { ingestGdelt } from "../../src/ingest/sources/gdelt";
import { withDb } from "../../src/services/db";
import { TRACKED_COMPANIES } from "../../src/ingest/trackedCompanies";
import { createMockEnv } from "../helpers/mockEnv";
import { resetTestDb, testDb } from "../helpers/pgDb";
import type { Env, IngestQueueMessage } from "../../src/types";

vi.mock("pg", async () => (await import("../helpers/pgDb")).pgModuleMock());

const secLimiter = {
  idFromName: (name: string) => ({ toString: () => name }),
  get: () => ({ fetch: async () => new Response(JSON.stringify({ ok: true }), { status: 200 }) })
} as unknown as Env["SEC_LIMITER_DO"];

function env(overrides: Partial<Env> = {}): Env {
  return createMockEnv({ DATABASE_URL: "postgres://pglite/test", SEC_LIMITER_DO: secLimiter, ...overrides });
}

function macro(source: string): IngestQueueMessage {
  return { job: "INGEST_MACRO", run_id: `run-${source}`, params: { source } };
}

type Route = (url: string, init?: RequestInit) => Response | Promise<Response>;
function mockUpstream(routes: Record<string, Route>): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const key = Object.keys(routes).find((prefix) => url.startsWith(prefix));
    if (!key) {
      throw new Error(`Unexpected upstream call: ${url}`);
    }
    return routes[key]!(url, init);
  });
}

async function observations(code: string): Promise<Array<{ obs_date: string; value_num: number; value_raw: string }>> {
  const result = await testDb().query<{ obs_date: string; value_num: number; value_raw: string }>(
    `select so.obs_date::text as obs_date, so.value_num, so.value_raw
     from series_observations so join series s on s.series_id = so.series_id
     where s.series_code = $1 order by so.obs_date`,
    [code]
  );
  return result.rows;
}

/** Monthly BLS rows (newest first, like the API) with October 2025 unpublished. */
function blsRows(valueFor: (year: number, month: number) => number): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = [];
  for (let year = 2024; year <= 2026; year += 1) {
    for (let month = 1; month <= 12; month += 1) {
      if (year === 2026 && month > 9) {
        continue;
      }
      const missing = year === 2025 && month === 10;
      rows.push({
        year: String(year),
        period: `M${String(month).padStart(2, "0")}`,
        value: missing ? "-" : valueFor(year, month).toFixed(3),
        footnotes: missing ? [{ code: "X", text: "Data unavailable due to the 2025 lapse in appropriations" }] : [{}]
      });
    }
  }
  rows.push({ year: "2025", period: "M13", value: "999.000" }); // annual average must be ignored
  return rows.reverse();
}

describe("ingestion against real Postgres", () => {
  beforeAll(async () => {
    await resetTestDb({ seed: true });
  });
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("BLS: one POST for all series, NSA CPI, YoY matched by date across the missing October 2025", async () => {
    const cpi = (year: number, month: number) => 300 + (year - 2024) * 12 + month;
    const spy = mockUpstream({
      "https://api.bls.gov/": () =>
        Response.json({
          status: "REQUEST_SUCCEEDED",
          Results: {
            series: [
              { seriesID: "CUUR0000SA0", data: blsRows(cpi) },
              { seriesID: "LNS14000000", data: blsRows(() => 4.1) },
              { seriesID: "CES0000000001", data: blsRows((y, m) => 158000 + m) },
              { seriesID: "CES0500000003", data: blsRows(() => 35.5) }
            ]
          }
        })
    });

    await handleIngestJob(macro("BLS"), env({ BLS_API_KEY: "test-key" }));

    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0]!;
    expect(String(url)).toBe("https://api.bls.gov/publicAPI/v2/timeseries/data/");
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body.seriesid).toEqual(["CUUR0000SA0", "LNS14000000", "CES0000000001", "CES0500000003"]);
    expect(body.registrationkey).toBe("test-key");

    const yoy = await observations("US_CPI_YOY");
    const byDate = new Map(yoy.map((row) => [row.obs_date, row.value_num]));
    // Sep 2026 vs Sep 2025 (an index-based shift would compare against Aug 2025).
    expect(byDate.get("2026-09-01")).toBe(Number((((cpi(2026, 9) - cpi(2025, 9)) / cpi(2025, 9)) * 100).toFixed(1)));
    // No base value for Oct 2025, so neither Oct 2025 itself nor (later) Oct 2026 can be computed.
    expect(byDate.has("2025-10-01")).toBe(false);
    expect(byDate.get("2025-11-01")).toBe(Number((((cpi(2025, 11) - cpi(2024, 11)) / cpi(2024, 11)) * 100).toFixed(1)));
    expect((await observations("US_UNEMPLOYMENT_RATE")).every((row) => row.value_raw === "4.100")).toBe(true);
  });

  it("BLS: a non-success status fails the job instead of reporting success", async () => {
    mockUpstream({ "https://api.bls.gov/": () => Response.json({ status: "REQUEST_NOT_PROCESSED", message: ["daily threshold reached"] }) });
    await expect(handleIngestJob(macro("BLS"), env())).rejects.toThrow(/REQUEST_NOT_PROCESSED/);
  });

  it("queue: a failing job is retried with backoff (not acked), an unsupported message is dropped", async () => {
    mockUpstream({ "https://api.bls.gov/": () => new Response("upstream down", { status: 503 }) });
    const outcomes: string[] = [];
    const delays: number[] = [];
    await worker.queue(
      {
        queue: "ofp-ingest",
        messages: [
          { body: macro("BLS"), attempts: 2, ack: () => outcomes.push("ack"), retry: (opts: { delaySeconds: number }) => (outcomes.push("retry"), delays.push(opts.delaySeconds)) },
          { body: { job: "NOPE" }, attempts: 1, ack: () => outcomes.push("ack"), retry: () => outcomes.push("retry") }
        ]
      } as any,
      env()
    );
    expect(outcomes).toEqual(["retry", "ack"]);
    expect(delays).toEqual([60]);
  });

  it("BEA: stores Table 1.1.1 growth rates as published, and skips explicitly without a key", async () => {
    await expect(handleIngestJob(macro("BEA"), env())).resolves.toEqual([expect.objectContaining({ status: "skipped" })]);

    const spy = mockUpstream({
      "https://apps.bea.gov/": () =>
        Response.json({
          BEAAPI: {
            Results: {
              Data: [
                { LineNumber: "1", TimePeriod: "2026Q1", DataValue: "1.4" },
                { LineNumber: "1", TimePeriod: "2026Q2", DataValue: "3.0" },
                { LineNumber: "2", TimePeriod: "2026Q2", DataValue: "2.5" }
              ]
            }
          }
        })
    });
    await handleIngestJob(macro("BEA"), env({ BEA_API_KEY: "bea-key" }));
    expect(String(spy.mock.calls[0]![0])).toContain("method=GetData");
    expect(String(spy.mock.calls[0]![0])).toContain("TableName=T10101");
    expect(await observations("US_REAL_GDP_GROWTH_SAAR")).toEqual([
      { obs_date: "2026-01-01", value_num: 1.4, value_raw: "1.4" },
      { obs_date: "2026-04-01", value_num: 3, value_raw: "3.0" }
    ]);
  });

  it("ECB: applies official revisions, keeps the previous value in the revision log, and recomputes derived YoY", async () => {
    const csv = (overrides: Record<string, string> = {}) => {
      const lines = ["KEY,FREQ,REF_AREA,ADJUSTMENT,ICP_ITEM,STS_INSTITUTION,ICP_SUFFIX,TIME_PERIOD,OBS_VALUE"];
      for (let month = 1; month <= 12; month += 1) {
        for (const year of [2025, 2026]) {
          const period = `${year}-${String(month).padStart(2, "0")}`;
          if (year === 2026 && month > 9) {
            continue;
          }
          lines.push(`ICP.M.U2,M,U2,N,000000,4,INX,${period},${overrides[period] ?? (year === 2025 ? "120.00" : "123.00")}`);
        }
      }
      return lines.join("\n");
    };

    mockUpstream({ "https://data-api.ecb.europa.eu/": () => new Response(csv()) });
    await handleIngestJob(macro("ECB"), env());
    expect((await observations("EU_HICP_RAW")).find((row) => row.obs_date === "2026-09-01")?.value_raw).toBe("123.00");
    expect((await observations("EU_HICP_YOY")).find((row) => row.obs_date === "2026-09-01")?.value_num).toBe(2.5);

    vi.restoreAllMocks();
    mockUpstream({ "https://data-api.ecb.europa.eu/": () => new Response(csv({ "2026-09": "123.60" })) });
    const [result] = await handleIngestJob(macro("ECB"), env());
    expect(result?.revisions).toBe(1);
    expect((await observations("EU_HICP_RAW")).find((row) => row.obs_date === "2026-09-01")?.value_raw).toBe("123.60");
    expect((await observations("EU_HICP_YOY")).find((row) => row.obs_date === "2026-09-01")?.value_num).toBe(3);
    const revisions = await testDb().query<{ previous_value_raw: string; new_value_raw: string }>(
      "select previous_value_raw, new_value_raw from series_observation_revisions"
    );
    expect(revisions.rows).toEqual([{ previous_value_raw: "123.00", new_value_raw: "123.60" }]);
  });

  it("SEC: reconciles recent filings with their acceptance time, flags only recent ones as breaking, links the issuer", async () => {
    const now = Date.now();
    const iso = (offsetHours: number) => new Date(now - offsetHours * 3_600_000).toISOString();
    const submissions = {
      name: "NVIDIA CORP",
      filings: {
        recent: {
          accessionNumber: ["0001045810-26-000101", "0001045810-26-000100", "0001045810-26-000099"],
          form: ["4", "8-K", "10-Q"],
          filingDate: [iso(1).slice(0, 10), iso(5).slice(0, 10), iso(24 * 10).slice(0, 10)],
          acceptanceDateTime: [iso(1), iso(5), iso(24 * 10)],
          primaryDocument: ["xslF345X05/form4.xml", "nvda-8k.htm", "nvda-10q.htm"]
        }
      }
    };
    const spy = mockUpstream({ "https://data.sec.gov/submissions/": () => Response.json(submissions) });
    const job: IngestQueueMessage = { job: "INGEST_SEC", run_id: "run-sec", params: { cik: "0001045810" } };
    await handleIngestJob(job, env());
    await handleIngestJob(job, env()); // second poll must not re-date or duplicate

    expect((spy.mock.calls[0]![1] as RequestInit & { headers: Record<string, string> }).headers["user-agent"]).toMatch(/@/);
    const items = await testDb().query<{ accession: string; event_time: Date; is_breaking: boolean; linked: string[] }>(
      `select ci.meta->>'accession' as accession, ci.event_time, ci.is_breaking,
              array(select e.slug from content_item_entities cie join entities e on e.entity_id = cie.entity_id where cie.item_id = ci.item_id order by e.slug) as linked
       from content_items ci where ci.item_type = 'sec_filing' order by ci.event_time desc`
    );
    expect(items.rows.map((row) => [row.accession, row.event_time.toISOString(), row.is_breaking, row.linked])).toEqual([
      ["0001045810-26-000101", iso(1), true, ["nvidia", "sec"]],
      ["0001045810-26-000100", iso(5), true, ["nvidia", "sec"]],
      ["0001045810-26-000099", iso(240), false, ["nvidia", "sec"]]
    ]);
  });

  it("GDELT: uses a 24h timespan, drops the in-progress interval, dates items by interval end, de-duplicates", async () => {
    const timeline = {
      timeline: [
        {
          series: "Article Count",
          data: [
            { date: "20261105T000000Z", value: 40 },
            { date: "20261105T001500Z", value: 52 },
            { date: "20261105T003000Z", value: 3 } // still accumulating: must be ignored
          ]
        }
      ]
    };
    const spy = mockUpstream({ "https://api.gdeltproject.org/": () => Response.json(timeline) });
    const companies = TRACKED_COMPANIES.slice(0, 2);
    const sleeps: number[] = [];
    const run = () =>
      withDb(env(), (client) => ingestGdelt({ client, env: env(), runId: "run-gdelt" }, { companies, sleep: async (ms) => void sleeps.push(ms) }));
    await run();
    await run();

    expect(String(spy.mock.calls[0]![0])).toContain("timespan=24h");
    expect(sleeps.every((ms) => ms >= 5000)).toBe(true);
    const rows = await testDb().query<{ headline_generated: string; event_time: Date; meta: Record<string, unknown> }>(
      "select headline_generated, event_time, meta from content_items where item_type = 'gdelt_link' and meta->>'run_id' = 'run-gdelt' order by headline_generated"
    );
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows[0]!.headline_generated).toBe("Apple index activity (15-minute): 52 articles +12 vs previous");
    expect(rows.rows[0]!.event_time.toISOString()).toBe("2026-11-05T00:15:00.000Z");
    expect(rows.rows[0]!.meta.mention_count).toBe(52);
  });

  it("GDELT: the job fails only when every tracked company failed", async () => {
    mockUpstream({ "https://api.gdeltproject.org/": () => new Response("Please limit requests to one every 5 seconds") });
    await expect(
      withDb(env(), (client) =>
        ingestGdelt({ client, env: env(), runId: "run-throttled" }, { companies: TRACKED_COMPANIES.slice(0, 2), sleep: async () => undefined })
      )
    ).rejects.toThrow(/all 2 tracked companies failed/);
  });
});
