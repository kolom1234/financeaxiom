import type { IngestQueueMessage, PushQueueMessage } from "../types";
import { TRACKED_COMPANIES } from "./trackedCompanies";
import { MACRO_SOURCES } from "./types";

/** Cron expressions must match apps/worker/wrangler.toml [triggers]. */
export const CRON = {
  sec: "*/2 * * * *",
  gdeltAndPush: "*/5 * * * *",
  macro: "0 */3 * * *",
  retention: "17 4 * * *"
} as const;

/**
 * Messages for a cron tick. An unknown/empty cron (manual trigger) enqueues
 * every ingest job but not retention.
 */
export function buildScheduledMessages(
  cron: string | undefined,
  runId: string
): { ingest: IngestQueueMessage[]; push: PushQueueMessage[] } {
  const all = !cron;
  const ingest: IngestQueueMessage[] = [];
  const push: PushQueueMessage[] = [];

  if (all || cron === CRON.gdeltAndPush) {
    ingest.push({ job: "INGEST_GDELT", run_id: runId, params: {} });
    push.push({ job: "PUSH_FANOUT_BREAKING", run_id: runId, params: { limit: 25 } });
  }
  if (all || cron === CRON.sec) {
    for (const company of TRACKED_COMPANIES.filter((entry) => entry.secFilings)) {
      ingest.push({ job: "INGEST_SEC", run_id: runId, params: { cik: company.cik } });
    }
  }
  if (all || cron === CRON.macro) {
    for (const source of MACRO_SOURCES) {
      ingest.push({ job: "INGEST_MACRO", run_id: runId, params: { source } });
    }
  }
  if (cron === CRON.retention) {
    ingest.push({ job: "MAINTENANCE_RETENTION", run_id: runId, params: {} });
  }
  return { ingest, push };
}
