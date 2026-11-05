import type { PgClient } from "../../services/db";
import type { Env } from "../../types";

export interface IngestContext {
  client: PgClient;
  env: Env;
  runId: string;
}

export interface SourceRunResult {
  source: string;
  /** ok: data persisted; skipped: not configured (e.g. missing API key); held: compliance hold. */
  status: "ok" | "skipped" | "held";
  series?: number;
  observations?: number;
  revisions?: number;
  items?: number;
  note?: string;
}
