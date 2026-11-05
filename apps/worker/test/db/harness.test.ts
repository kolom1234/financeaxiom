import { describe, expect, it, vi } from "vitest";
import { resetTestDb } from "../helpers/pgDb";

vi.mock("pg", async () => (await import("../helpers/pgDb")).pgModuleMock());

describe("pglite harness", () => {
  it("applies all migrations and the seed", async () => {
    const db = await resetTestDb({ seed: true });
    const licenses = await db.query<{ count: number }>("select count(*)::int as count from licenses");
    expect(licenses.rows[0]?.count).toBeGreaterThan(0);
  });
});
