import { readFileSync } from "node:fs";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../../src/index";
import { handlePushJob } from "../../src/push/queue";
import { upsertContentItem } from "../../src/services/ingestDb";
import { createMockEnv } from "../helpers/mockEnv";
import { migrationFiles, resetTestDb, setDbConnectFailure, testDb } from "../helpers/pgDb";
import { createBrowserSubscription, vapidEnv } from "../helpers/push";
import type { Env } from "../../src/types";

vi.mock("pg", async () => (await import("../helpers/pgDb")).pgModuleMock());

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const ORIGIN = "https://financeaxiom.com";

function dbEnv(overrides: Partial<Env> = {}): Env {
  return createMockEnv({ DATABASE_URL: "postgres://pglite/test", ALLOW_MEMORY_READ_FALLBACK: undefined, ALLOWED_ORIGINS: ORIGIN, ...overrides });
}

async function call(env: Env, path: string, init: RequestInit & { user?: string } = {}): Promise<{ status: number; body: any; headers: Headers }> {
  const headers = new Headers(init.headers);
  headers.set("origin", ORIGIN);
  if (init.user) {
    headers.set("authorization", `Bearer test-user:${init.user}`);
  }
  if (init.body) {
    headers.set("content-type", "application/json");
  }
  const response = await worker.fetch(new Request(`http://localhost${path}`, { ...init, headers }), env);
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null, headers: response.headers };
}

async function sourceAndLicense(sourceName: string): Promise<{ sourceId: string; licenseId: string }> {
  const result = await testDb().query<{ source_id: string; default_license_id: string }>(
    "select source_id, default_license_id from sources where name = $1",
    [sourceName]
  );
  return { sourceId: result.rows[0]!.source_id, licenseId: result.rows[0]!.default_license_id };
}

describe("API against real Postgres (all migrations + seed)", () => {
  beforeAll(async () => {
    await resetTestDb({ seed: true });
    await testDb().exec(`insert into auth.users (id) values ('${USER_A}'), ('${USER_B}')`);
  });

  beforeEach(() => {
    setDbConnectFailure(false);
    vi.restoreAllMocks();
  });

  describe("status codes", () => {
    it("returns 404 (not 503) for an unknown filing, series and entity", async () => {
      const env = dbEnv();
      expect((await call(env, "/api/f/0000000000-00-000000")).status).toBe(404);
      expect((await call(env, "/api/series/NOPE")).status).toBe(404);
      expect((await call(env, "/api/series/00000000-0000-4000-8000-000000000000")).status).toBe(404);
      expect((await call(env, "/api/entity/no-such-entity")).status).toBe(404);
    });

    it("returns 400 (not 503) for invalid input", async () => {
      const env = dbEnv();
      expect((await call(env, "/api/series/US_CPI_YOY?from=not-a-date")).status).toBe(400);
      expect((await call(env, "/api/series/US_CPI_YOY?from=2026-02-30")).status).toBe(400);
      expect((await call(env, "/api/f/not-an-accession")).status).toBe(400);
      expect((await call(env, "/api/feed?region=MARS")).status).toBe(400);
      expect((await call(env, "/api/feed?cursor=!!!")).status).toBe(400);
    });

    it("returns 503 with CORS headers and a request id when the database is unreachable", async () => {
      setDbConnectFailure(true);
      const response = await call(dbEnv(), "/api/feed?tab=breaking");
      expect(response.status).toBe(503);
      expect(response.headers.get("access-control-allow-origin")).toBe(ORIGIN);
      expect(response.headers.get("x-request-id")).toBeTruthy();
      expect(response.body.error.message).toMatch(/temporarily unavailable/);
    });
  });

  describe("feed", () => {
    it("paginates with a keyset cursor without duplicates when new items arrive", async () => {
      const db = testDb();
      await db.exec("delete from content_items");
      const { sourceId, licenseId } = await sourceAndLicense("GDELT");
      const client = { query: (sql: string, params?: unknown[]) => db.query(sql, params).then((r) => ({ rows: r.rows as any[], rowCount: r.affectedRows || r.rows.length })) };
      for (let index = 0; index < 25; index += 1) {
        await upsertContentItem(client as any, {
          itemType: "gdelt_link",
          eventTime: new Date(Date.UTC(2026, 10, 1, 0, index)).toISOString(),
          headline: `Item ${index}`,
          sourceId,
          licenseId,
          isBreaking: true,
          region: "GLOBAL",
          meta: {},
          dedupeKey: `test:${index}`
        });
      }

      const env = dbEnv();
      const page1 = await call(env, "/api/feed?tab=breaking");
      expect(page1.status).toBe(200);
      expect(page1.body.data.items).toHaveLength(20);
      expect(page1.body.data.next_cursor).toBeTruthy();

      // A newer item arrives between page requests (offset pagination would shift and duplicate).
      await upsertContentItem(client as any, {
        itemType: "gdelt_link",
        eventTime: new Date(Date.UTC(2026, 10, 2)).toISOString(),
        headline: "Newest",
        sourceId,
        licenseId,
        isBreaking: true,
        region: "GLOBAL",
        meta: {},
        dedupeKey: "test:newest"
      });

      const page2 = await call(env, `/api/feed?tab=breaking&cursor=${page1.body.data.next_cursor}`);
      expect(page2.body.data.items).toHaveLength(5);
      expect(page2.body.data.next_cursor).toBeNull();
      const ids = [...page1.body.data.items, ...page2.body.data.items].map((item: { item_id: string }) => item.item_id);
      expect(new Set(ids).size).toBe(25);
    });

    it("treats LIKE wildcards in the search query literally", async () => {
      const env = dbEnv();
      const all = await call(env, "/api/feed?tab=breaking&query=Item");
      expect(all.body.data.items.length).toBeGreaterThan(0);
      const wildcard = await call(env, `/api/feed?tab=breaking&query=${encodeURIComponent("%")}`);
      expect(wildcard.body.data.items).toHaveLength(0);
    });

    it("never re-dates an existing item when the same dedupe key is upserted again", async () => {
      const db = testDb();
      const { sourceId, licenseId } = await sourceAndLicense("SEC EDGAR");
      const client = { query: (sql: string, params?: unknown[]) => db.query(sql, params).then((r) => ({ rows: r.rows as any[], rowCount: r.affectedRows || r.rows.length })) };
      const input = {
        itemType: "sec_filing" as const,
        headline: "[Filing] X 8-K filed",
        sourceId,
        licenseId,
        isBreaking: true,
        region: "US" as const,
        meta: {},
        dedupeKey: "sec:0000000001-26-000001"
      };
      const first = await upsertContentItem(client as any, { ...input, eventTime: "2026-01-01T10:00:00.000Z" });
      const second = await upsertContentItem(client as any, { ...input, eventTime: "2026-11-05T10:00:00.000Z", headline: "[Filing] X 8-K filed (updated)" });
      expect(first.inserted).toBe(true);
      expect(second).toEqual({ itemId: first.itemId, inserted: false });
      const row = await db.query<{ event_time: Date; headline_generated: string }>(
        "select event_time, headline_generated from content_items where item_id = $1",
        [first.itemId]
      );
      expect(row.rows[0]!.event_time.toISOString()).toBe("2026-01-01T10:00:00.000Z");
      expect(row.rows[0]!.headline_generated).toBe("[Filing] X 8-K filed (updated)");
    });
  });

  describe("indicators and series", () => {
    it("computes a date-matched YoY for level series, null YoY for % series, and ISO periods", async () => {
      const db = testDb();
      await db.exec("delete from series");
      const { sourceId, licenseId } = await sourceAndLicense("BLS");
      const insertSeries = async (code: string, units: string, points: Array<[string, number]>) => {
        const series = await db.query<{ series_id: string }>(
          `insert into series (source_id, series_code, title, units, license_id) values ($1, $2, $2, $3, $4) returning series_id`,
          [sourceId, code, units, licenseId]
        );
        for (const [date, value] of points) {
          await db.query("insert into series_observations (series_id, obs_date, value_raw, value_num) values ($1, $2, $3, $4)", [
            series.rows[0]!.series_id,
            date,
            String(value),
            value
          ]);
        }
      };
      // Weekly level series: the year-ago match is 364 days earlier, not index-52.
      await insertSeries("LEVEL_WEEKLY", "MBBL", [
        ["2025-11-07", 400],
        ["2025-11-14", 410],
        ["2026-10-30", 430],
        ["2026-11-06", 440]
      ]);
      await insertSeries("RATE_MONTHLY", "%", [
        ["2026-09-01", 4.3],
        ["2026-10-01", 4.1]
      ]);

      const response = await call(dbEnv(), "/api/indicators/key");
      const cards = response.body.data.cards as Array<Record<string, any>>;
      const level = cards.find((card) => card.series_code === "LEVEL_WEEKLY")!;
      const rate = cards.find((card) => card.series_code === "RATE_MONTHLY")!;
      expect(level.period).toBe("2026-11-06");
      expect(level.yoy).toBe(Number((((440 - 400) / 400) * 100).toFixed(2)));
      expect(level.change).toBe(10);
      expect(rate.yoy).toBeNull();
      expect(rate.change).toBeCloseTo(-0.2, 10);
      expect(rate.change_unit).toBe("pp");

      const series = await call(dbEnv(), "/api/series/LEVEL_WEEKLY?from=2026-01-01");
      expect(series.status).toBe(200);
      expect(series.body.data.observations.map((obs: { obs_date: string }) => obs.obs_date)).toEqual(["2026-10-30", "2026-11-06"]);
    });
  });

  describe("alert rules", () => {
    it("validates input, scopes updates to the owner, enforces the cap and supports delete", async () => {
      const env = dbEnv();
      const invalid = await call(env, "/api/alerts/rules", { method: "POST", user: USER_A, body: JSON.stringify({ enabled: true, rule_type: "bogus", rule: {} }) });
      expect(invalid.status).toBe(400);

      const created = await call(env, "/api/alerts/rules", {
        method: "POST",
        user: USER_A,
        body: JSON.stringify({ enabled: true, rule_type: "ticker", rule: { ticker: "nvda" } })
      });
      expect(created.status).toBe(201);
      expect(created.body.data.rule.rule).toEqual({ ticker: "NVDA" });
      const ruleId = created.body.data.rule.rule_id;

      const hijack = await call(env, "/api/alerts/rules", {
        method: "POST",
        user: USER_B,
        body: JSON.stringify({ rule_id: ruleId, enabled: false, rule_type: "breaking", rule: {} })
      });
      expect(hijack.status).toBe(404);

      await testDb().query(
        "insert into alert_rules (user_id, rule_type, rule) select $1, 'breaking', '{}'::jsonb from generate_series(1, 49)",
        [USER_A]
      );
      const overCap = await call(env, "/api/alerts/rules", { method: "POST", user: USER_A, body: JSON.stringify({ enabled: true, rule_type: "macro", rule: {} }) });
      expect(overCap.status).toBe(409);

      expect((await call(env, `/api/alerts/rules/${ruleId}`, { method: "DELETE", user: USER_B })).status).toBe(404);
      expect((await call(env, `/api/alerts/rules/${ruleId}`, { method: "DELETE", user: USER_A })).status).toBe(200);
      await testDb().query("delete from alert_rules where user_id = $1", [USER_A]);
    });
  });

  describe("push", () => {
    it("stores one IV per field, delivers via the fanout, de-duplicates, and deletes gone subscriptions", async () => {
      const env = dbEnv(await vapidEnv());
      const subscription = await createBrowserSubscription();
      const subscribed = await call(env, "/api/push/subscribe", { method: "POST", user: USER_A, body: JSON.stringify(subscription) });
      expect(subscribed.status).toBe(200);
      // Re-subscribing the same endpoint updates in place (unique user+endpoint).
      await call(env, "/api/push/subscribe", { method: "POST", user: USER_A, body: JSON.stringify(subscription) });

      const stored = await testDb().query<{ enc_iv: string; p256dh_iv: string; auth_iv: string }>(
        "select enc_iv, p256dh_iv, auth_iv from push_subscriptions where user_id = $1",
        [USER_A]
      );
      expect(stored.rows).toHaveLength(1);
      const ivs = stored.rows[0]!;
      expect(new Set([ivs.enc_iv, ivs.p256dh_iv, ivs.auth_iv]).size).toBe(3);

      await call(env, "/api/alerts/rules", { method: "POST", user: USER_A, body: JSON.stringify({ enabled: true, rule_type: "breaking", rule: {} }) });
      const sent: string[] = [];
      const message = { job: "PUSH_FANOUT_BREAKING" as const, run_id: "db-run", params: { limit: 3 } };
      const first = await handlePushJob(message, env, {
        send: async (sub) => {
          expect(sub).toEqual({ endpoint: subscription.endpoint, p256dh: subscription.keys.p256dh, auth: subscription.keys.auth });
          sent.push(sub.endpoint);
          return { outcome: "delivered", status: 201 };
        }
      });
      expect(first.delivered).toBe(3);
      const second = await handlePushJob(message, env, { send: async () => ({ outcome: "delivered", status: 201 }) });
      expect(second.delivered).toBe(0);
      const statuses = await testDb().query<{ status: string }>("select status from notification_events where user_id = $1", [USER_A]);
      expect(statuses.rows.map((row) => row.status)).toEqual(["sent", "sent", "sent"]);

      await testDb().exec("delete from notification_events");
      await handlePushJob(message, env, { send: async () => ({ outcome: "gone", status: 410 }) });
      const remaining = await testDb().query("select 1 from push_subscriptions where user_id = $1", [USER_A]);
      expect(remaining.rows).toHaveLength(0);
    });
  });

  describe("account deletion", () => {
    it("erases the caller's app data only", async () => {
      const env = dbEnv();
      await testDb().exec("delete from alert_rules");
      await call(env, "/api/alerts/rules", { method: "POST", user: USER_A, body: JSON.stringify({ enabled: true, rule_type: "macro", rule: {} }) });
      await call(env, "/api/alerts/rules", { method: "POST", user: USER_B, body: JSON.stringify({ enabled: true, rule_type: "macro", rule: {} }) });
      expect((await call(env, "/api/account/delete", { method: "POST", user: USER_A, body: JSON.stringify({}) })).status).toBe(400);
      const deleted = await call(env, "/api/account/delete", { method: "POST", user: USER_A, body: JSON.stringify({ confirm: "DELETE" }) });
      expect(deleted.status).toBe(200);
      expect(deleted.body.data.deleted.alert_rules).toBe(1);
      expect(deleted.body.data.auth_account_deleted).toBe(false);
      const left = await testDb().query<{ user_id: string }>("select user_id from alert_rules");
      expect(left.rows.map((row) => row.user_id)).toEqual([USER_B]);
    });
  });

  describe("schema", () => {
    it("blocks direct PostgREST writes to user-owned tables (RLS) while allowing reads of own rows", async () => {
      const db = testDb();
      await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${USER_B}', false);`);
      try {
        await expect(
          db.query("insert into alert_rules (user_id, rule_type, rule) values ($1, 'breaking', '{}'::jsonb)", [USER_B])
        ).rejects.toThrow(/row-level security|permission denied/);
        const own = await db.query<{ user_id: string }>("select user_id from alert_rules");
        expect(own.rows.every((row) => row.user_id === USER_B)).toBe(true);
      } finally {
        await db.exec("reset role;");
      }
    });

    it("re-applying every migration is a no-op (idempotent)", async () => {
      for (const file of migrationFiles()) {
        await expect(testDb().exec(readFileSync(new URL(`../../../../supabase/migrations/${file}`, import.meta.url), "utf8"))).resolves.toBeDefined();
      }
    });
  });
});
