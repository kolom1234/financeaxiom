import { beforeAll, describe, expect, it, vi } from "vitest";
import worker from "../../src/index";
import { createMockEnv } from "../helpers/mockEnv";
import { resetTestDb, testDb } from "../helpers/pgDb";
import type { Env } from "../../src/types";

vi.mock("pg", async () => (await import("../helpers/pgDb")).pgModuleMock());

/*
 * Behavioural compliance gates, evaluated against the real schema, RLS
 * policies, reference seed and sample data (not by grepping source code).
 */
function env(): Env {
  return createMockEnv({ DATABASE_URL: "postgres://pglite/compliance", ALLOW_MEMORY_READ_FALLBACK: undefined });
}

async function get(path: string): Promise<any> {
  const response = await worker.fetch(new Request(`http://localhost${path}`), env());
  expect(response.status).toBe(200);
  return ((await response.json()) as { data: any }).data;
}

describe("compliance gates against the real schema", () => {
  beforeAll(async () => {
    await resetTestDb({ sampleData: true });
    // A conditional-license item that must never be served publicly.
    await testDb().exec(`
      insert into content_items (item_type, event_time, headline_generated, source_id, license_id, is_breaking, region)
      select 'macro_update', now(), 'CONDITIONAL ITEM', s.source_id, l.license_id, true, 'GLOBAL'
      from sources s join licenses l on l.code = 'EUROSTAT_CONDITIONAL' where s.name = 'Eurostat';
    `);
  });

  it("Gate F: FRED is registered only as a disallowed license and never as a data source", async () => {
    const fred = await testDb().query<{ commercial_status: string }>("select commercial_status from licenses where code like 'FRED%'");
    expect(fred.rows.map((row) => row.commercial_status)).toEqual(["disallowed"]);
    const sources = await testDb().query("select 1 from sources where upper(name) like '%FRED%'");
    expect(sources.rows).toHaveLength(0);
  });

  it("allow-only exposure: public feed/legal never return conditional or disallowed items", async () => {
    for (const tab of ["breaking", "filings", "macro", "newsindex"]) {
      const data = await get(`/api/feed?tab=${tab}`);
      expect(data.items.every((item: any) => item.license.commercial_status === "allowed")).toBe(true);
      expect(data.items.some((item: any) => item.headline === "CONDITIONAL ITEM")).toBe(false);
    }
    const cards = (await get("/api/indicators/key")).cards;
    expect(cards.every((card: any) => card.license.commercial_status === "allowed")).toBe(true);
  });

  it("Gate B / attribution: every GDELT item links out and carries the GDELT citation", async () => {
    const items = (await get("/api/feed?tab=newsindex")).items;
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.external_url).toMatch(/^https:\/\/api\.gdeltproject\.org\/api\/v2\/doc\/doc\?/);
      expect(item.license.attribution_text).toMatch(/GDELT/);
      expect(item).not.toHaveProperty("article_body");
    }
  });

  it("Gate D: raw-locked ECB values are served exactly as stored, separate from derived values", async () => {
    const raw = await get("/api/series/EU_HICP_RAW?mode=raw");
    expect(raw.raw_locked).toBe(true);
    const stored = await testDb().query<{ obs_date: string; value_raw: string }>(
      "select so.obs_date::text as obs_date, so.value_raw from series_observations so join series s using (series_id) where s.series_code = 'EU_HICP_RAW' order by 1"
    );
    expect(raw.observations.map((obs: any) => [obs.obs_date, obs.value_raw])).toEqual(stored.rows.map((row) => [row.obs_date, row.value_raw]));
    const derived = await worker.fetch(new Request("http://localhost/api/series/EU_HICP_RAW?mode=derived"), env());
    expect(derived.status).toBe(404);
  });

  it("RLS: the anonymous API role cannot read user-owned tables", async () => {
    const db = testDb();
    await db.exec("set role anon;");
    try {
      for (const table of ["push_subscriptions", "alert_rules", "notification_events", "policy_snapshots"]) {
        const rows = await db.query(`select * from ${table}`).catch(() => ({ rows: [] }));
        expect(rows.rows).toHaveLength(0);
      }
      const conditional = await db.query("select 1 from content_items where headline_generated = 'CONDITIONAL ITEM'");
      expect(conditional.rows).toHaveLength(0);
    } finally {
      await db.exec("reset role;");
    }
  });
});
