import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import pgTypes from "pg-types";

/**
 * Real-Postgres test harness.
 *
 * PGlite is PostgreSQL compiled to WASM, so migrations, constraints, casts and
 * query semantics behave like production. `pgModuleMock()` exposes a `Client`
 * class with the subset of the `pg` API the worker uses, and values are parsed
 * with the same `pg-types` text parsers that `pg` uses in production (e.g. a
 * `date` column becomes a JS `Date`), so type-handling bugs surface in tests.
 *
 * Usage in a test file:
 *   vi.mock("pg", async () => (await import("../helpers/pgDb")).pgModuleMock());
 *   beforeEach(async () => { await resetTestDb({ seed: true }); });
 */

const SUPABASE_DIR = fileURLToPath(new URL("../../../../supabase/", import.meta.url));

// Minimal stand-ins for objects Supabase provides in every project.
const SUPABASE_BOOTSTRAP_SQL = `
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end
$$;
create schema if not exists extensions;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key);
create or replace function auth.uid() returns uuid
language sql stable
as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
-- Supabase grants table privileges to the API roles by default; RLS is the real gate.
grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`;

// OIDs whose parsing differs between "raw text" and what `pg` returns.
const PG_PARSED_OIDS = [
  16, 17, 20, 21, 23, 26, 114, 199, 700, 701, 1000, 1005, 1007, 1009, 1015, 1016, 1021, 1022, 1082, 1114, 1115, 1182,
  1184, 1185, 1186, 1231, 1700, 2950, 2951, 3802, 3807
];

function pgCompatibleParsers(): Record<number, (value: string) => unknown> {
  const parsers: Record<number, (value: string) => unknown> = {};
  for (const oid of PG_PARSED_OIDS) {
    const parse = pgTypes.getTypeParser(oid, "text") as (value: string) => unknown;
    parsers[oid] = (value: string) => parse(value);
  }
  return parsers;
}

interface HarnessState {
  db: PGlite | null;
  failConnect: boolean;
  queryLog: string[];
}

const state: HarnessState = {
  db: null,
  failConnect: false,
  queryLog: []
};

export function migrationFiles(): string[] {
  return readdirSync(`${SUPABASE_DIR}migrations`)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

export async function resetTestDb(options: { seed?: boolean; sampleData?: boolean } = {}): Promise<PGlite> {
  if (state.db) {
    await state.db.close();
  }
  const db = new PGlite({
    extensions: { pg_trgm, pgcrypto },
    parsers: pgCompatibleParsers()
  });
  await db.exec(SUPABASE_BOOTSTRAP_SQL);
  for (const file of migrationFiles()) {
    const sql = readFileSync(`${SUPABASE_DIR}migrations/${file}`, "utf8");
    try {
      await db.exec(sql);
    } catch (error) {
      throw new Error(`Migration ${file} failed: ${String((error as Error).message ?? error)}`);
    }
  }
  if (options.seed || options.sampleData) {
    await db.exec(readFileSync(`${SUPABASE_DIR}seed.sql`, "utf8"));
  }
  if (options.sampleData) {
    await db.exec(readFileSync(`${SUPABASE_DIR}sample_data.sql`, "utf8"));
  }
  state.db = db;
  state.failConnect = false;
  state.queryLog = [];
  return db;
}

export function testDb(): PGlite {
  if (!state.db) {
    throw new Error("Test DB not initialised. Call resetTestDb() first.");
  }
  return state.db;
}

/** Simulate an unreachable database (connect() rejects). */
export function setDbConnectFailure(fail: boolean): void {
  state.failConnect = fail;
}

export function executedQueries(): string[] {
  return [...state.queryLog];
}

export class PgliteClient {
  constructor(_config?: unknown) {}

  async connect(): Promise<void> {
    if (state.failConnect) {
      throw new Error("connect ECONNREFUSED 127.0.0.1:5432");
    }
    testDb();
  }

  async query(sql: string, params: unknown[] = []): Promise<{ rows: any[]; rowCount: number }> {
    state.queryLog.push(sql);
    const result = await testDb().query<Record<string, unknown>>(sql, params);
    const affected = result.affectedRows ?? 0;
    return {
      rows: result.rows,
      rowCount: affected > 0 ? affected : result.rows.length
    };
  }

  async end(): Promise<void> {}
}

export function pgModuleMock(): Record<string, unknown> {
  const module = { Client: PgliteClient, types: pgTypes };
  return { ...module, default: module };
}
