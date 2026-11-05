import { withDb } from "../services/db";
import { logEvent } from "../services/log";
import { applyRetention } from "../services/postgres";
import type { Env, IngestQueueMessage, MacroSource } from "../types";
import { ingestBea } from "./sources/bea";
import { ingestBls } from "./sources/bls";
import { ingestEurostat, ingestOecd, ingestWorldBank } from "./sources/conditional";
import { ingestEcb } from "./sources/ecb";
import { ingestEia } from "./sources/eia";
import { ingestFrb } from "./sources/frb";
import { ingestGdelt } from "./sources/gdelt";
import { ingestSec } from "./sources/sec";
import type { IngestContext, SourceRunResult } from "./sources/types";
import { ALLOWED_INGEST_JOBS, MACRO_SOURCES } from "./types";

const MACRO_RUNNERS: Record<MacroSource, (ctx: IngestContext) => Promise<SourceRunResult>> = {
  BLS: ingestBls,
  EIA: ingestEia,
  ECB: ingestEcb,
  FRB: ingestFrb,
  BEA: ingestBea,
  EUROSTAT: ingestEurostat,
  OECD: ingestOecd,
  WORLD_BANK: ingestWorldBank
};

export function isIngestMessage(input: unknown): input is IngestQueueMessage {
  if (!input || typeof input !== "object") {
    return false;
  }
  const message = input as Partial<IngestQueueMessage>;
  return (
    typeof message.job === "string" &&
    ALLOWED_INGEST_JOBS.includes(message.job) &&
    typeof message.run_id === "string" &&
    !!message.params &&
    typeof message.params === "object"
  );
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Runs one ingest job. Any failure throws, so the queue retries the message
 * with backoff and eventually dead-letters it; nothing is silently replaced
 * with placeholder data.
 */
export async function handleIngestJob(message: IngestQueueMessage, env: Env): Promise<SourceRunResult[]> {
  const started = Date.now();
  const results = await runJob(message, env);
  for (const result of results) {
    logEvent("info", "ingest_completed", { job: message.job, run_id: message.run_id, duration_ms: Date.now() - started, ...result });
  }
  return results;
}

async function runJob(message: IngestQueueMessage, env: Env): Promise<SourceRunResult[]> {
  switch (message.job) {
    case "RECOMPUTE_DERIVED":
      // Retired job type; derived series are computed during ingestion.
      return [];
    case "MAINTENANCE_RETENTION": {
      const removed = await applyRetention(env, {
        gdeltDays: positiveInt(env.GDELT_RETENTION_DAYS, 90),
        notificationDays: positiveInt(env.NOTIFICATION_RETENTION_DAYS, 90)
      });
      return [{ source: "RETENTION", status: "ok", note: JSON.stringify(removed) }];
    }
    case "INGEST_GDELT":
      return [await withDb(env, (client) => ingestGdelt({ client, env, runId: message.run_id }))];
    case "INGEST_SEC": {
      const cik = typeof message.params.cik === "string" ? message.params.cik : "";
      if (!/^\d{1,10}$/.test(cik)) {
        throw new Error("INGEST_SEC requires params.cik (digits).");
      }
      return [await withDb(env, (client) => ingestSec({ client, env, runId: message.run_id }, cik))];
    }
    case "INGEST_MACRO": {
      const requested = message.params.source;
      // Legacy messages without `source` run every macro source.
      const sources = typeof requested === "string" ? [requested] : MACRO_SOURCES;
      const results: SourceRunResult[] = [];
      for (const source of sources) {
        const runner = MACRO_RUNNERS[source as MacroSource];
        if (!runner) {
          throw new Error(`Unknown macro source: ${String(source)}`);
        }
        results.push(await withDb(env, (client) => runner({ client, env, runId: message.run_id })));
      }
      return results;
    }
  }
}
