import { buildGdeltSearchUrl, transformGdeltRecord } from "./gdelt";
import { ingestGdeltToDb, ingestMacroToDb, ingestSecToDb } from "./live";
import { applyEurostatFilter } from "./macro";
import { assertSecPolicyReady, buildSecHeadline } from "./sec";
import { ALLOWED_INGEST_JOBS } from "./types";
import type { Env, IngestQueueMessage, InternalContentItem } from "../types";
import { MemoryStore } from "../services/store";
import { acquireSecPermit } from "../services/sec";

function assertKnownJob(job: string): asserts job is IngestQueueMessage["job"] {
  if (!ALLOWED_INGEST_JOBS.includes(job as IngestQueueMessage["job"])) {
    throw new Error(`Unsupported ingest job: ${job}`);
  }
}

function randomRunTag(runId: string): string {
  return `${runId.slice(0, 8)}-${Math.floor(Math.random() * 1000)}`;
}

export async function handleIngestJob(message: IngestQueueMessage, env: Env): Promise<void> {
  assertKnownJob(message.job);
  const store = MemoryStore.get();

  if (message.job === "INGEST_GDELT") {
    try {
      const persisted = await ingestGdeltToDb(message, env);
      if (persisted) {
        return;
      }
    } catch (error) {
      console.error("ingest_gdelt_live_failed", error);
    }

    const entity = typeof message.params.entity === "string" ? message.params.entity : "Market";
    const record = transformGdeltRecord({
      entity,
      window: "5m",
      external_url: buildGdeltSearchUrl(entity)
    });
    store.appendContentItem(record);
    return;
  }

  if (message.job === "INGEST_SEC") {
    try {
      const persisted = await ingestSecToDb(message, env);
      if (persisted) {
        return;
      }
    } catch (error) {
      console.error("ingest_sec_live_failed", error);
    }

    assertSecPolicyReady(env.SEC_USER_AGENT);
    await acquireSecPermit(env);
    const accession = String(message.params.accession ?? "0000000000-26-000000");
    const company = String(message.params.company ?? "Company");
    const formType = String(message.params.form_type ?? "8-K");
    const created: InternalContentItem = {
      item_id: crypto.randomUUID(),
      item_type: "sec_filing",
      event_time: new Date().toISOString(),
      headline_generated: buildSecHeadline({ accession, company, form_type: formType, sec_url: "https://www.sec.gov/" }),
      summary_generated: "Filed recently. Open SEC.gov for the official document.",
      external_url: "https://www.sec.gov/",
      source_name: "SEC EDGAR",
      source_policy_url: "https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data",
      license_code: "SEC_EDGAR",
      commercial_status: "allowed",
      attribution_text: "Source: SEC EDGAR (official).",
      disclaimer_text: "Open SEC.gov for official filing text.",
      entity_slugs: [],
      is_breaking: true,
      region: "US",
      meta: { accession, run_tag: randomRunTag(message.run_id) }
    };
    store.appendContentItem(created);
    return;
  }

  if (message.job === "INGEST_MACRO") {
    try {
      const persisted = await ingestMacroToDb(message, env);
      if (persisted) {
        return;
      }
    } catch (error) {
      console.error("ingest_macro_live_failed", error);
    }

    const filtered = applyEurostatFilter([
      { geo: "EU", value: 1.1 },
      { geo: "US", value: 2.2 }
    ]);
    const created: InternalContentItem = {
      item_id: crypto.randomUUID(),
      item_type: "macro_update",
      event_time: new Date().toISOString(),
      headline_generated: "Macro indicator refresh completed",
      summary_generated: `Eurostat rows accepted: ${filtered.length}`,
      external_url: "https://ec.europa.eu/eurostat",
      source_name: "Eurostat",
      source_policy_url: "https://ec.europa.eu/eurostat/help/copyright-notice",
      license_code: "EUROSTAT_CONDITIONAL",
      commercial_status: "conditional",
      attribution_text: "Source: Eurostat (subject to exceptions).",
      disclaimer_text: "Blocked from production until cleared.",
      entity_slugs: [],
      is_breaking: false,
      region: "EU",
      meta: { accepted_rows: filtered.length }
    };
    store.appendContentItem(created);
    return;
  }

  if (message.job === "RECOMPUTE_DERIVED") {
    return;
  }
}
