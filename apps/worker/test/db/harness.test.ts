import { beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { resetTestDb } from "../helpers/pgDb";

vi.mock("pg", async () => (await import("../helpers/pgDb")).pgModuleMock());

describe("pglite harness", () => {
  let db: PGlite;

  // Starting Postgres (WASM) and applying every migration is setup, not the
  // behaviour under test, so it runs in a hook with the configured hookTimeout.
  beforeAll(async () => {
    db = await resetTestDb({ seed: true });
  });

  it("applies all migrations and the seed", async () => {
    const licenses = await db.query<{ count: number }>("select count(*)::int as count from licenses");
    expect(licenses.rows[0]?.count).toBeGreaterThan(0);
  });
});
