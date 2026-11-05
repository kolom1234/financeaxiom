import { upsertEntity, linkItemEntity } from "../../services/ingestDb";
import { describeError, logEvent } from "../../services/log";
import { buildGdeltSearchUrl, GDELT_INTERVAL_MINUTES, GDELT_TIMESPAN, parseGdeltTimeline, transformGdeltRecord } from "../gdelt";
import { fetchJson, UpstreamError } from "../http";
import { licenseIdFor, persistContentItem, requireSource } from "../persist";
import { TRACKED_COMPANIES, type TrackedCompany } from "../trackedCompanies";
import type { IngestContext, SourceRunResult } from "./types";

/** GDELT answers "Please limit requests to one every 5 seconds" when called faster. */
export const GDELT_MIN_REQUEST_SPACING_MS = 5_500;

export interface GdeltRunOptions {
  companies?: ReadonlyArray<TrackedCompany>;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchTimeline(entity: string, sleep: (ms: number) => Promise<void>): Promise<unknown> {
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(entity)}&mode=timelinevolraw&format=json&timespan=${GDELT_TIMESPAN}`;
  try {
    return await fetchJson<unknown>(url, { headers: { accept: "application/json" } }, "gdelt_timeline");
  } catch (error) {
    if (error instanceof UpstreamError && error.retryable) {
      await sleep(GDELT_MIN_REQUEST_SPACING_MS);
      return fetchJson<unknown>(url, { headers: { accept: "application/json" } }, "gdelt_timeline");
    }
    throw error;
  }
}

/**
 * One message processes every tracked company sequentially, spacing requests
 * by GDELT_MIN_REQUEST_SPACING_MS. Individual failures are logged; the job fails
 * (and is retried / dead-lettered) only if every company failed.
 */
export async function ingestGdelt(ctx: IngestContext, options: GdeltRunOptions = {}): Promise<SourceRunResult> {
  const companies = options.companies ?? TRACKED_COMPANIES;
  const sleep = options.sleep ?? defaultSleep;
  const source = await requireSource(ctx.client, "GDELT");
  const licenseId = await licenseIdFor(ctx.client, "GDELT", source);

  let items = 0;
  let failures = 0;
  let noData = 0;
  for (const [index, company] of companies.entries()) {
    if (index > 0) {
      await sleep(GDELT_MIN_REQUEST_SPACING_MS);
    }
    try {
      const points = parseGdeltTimeline(await fetchTimeline(company.entity, sleep));
      const latest = points[points.length - 1];
      const previous = points[points.length - 2];
      if (!latest) {
        noData += 1;
        continue;
      }

      await upsertEntity(ctx.client, {
        slug: company.slug,
        name: company.entity,
        entityType: "company",
        primaryTicker: company.ticker,
        cik: company.cik,
        tickers: [company.ticker],
        exchanges: ["NASDAQ"],
        meta: { source: "gdelt", auto_seeded: true }
      });

      const searchUrl = buildGdeltSearchUrl(company.entity);
      const record = transformGdeltRecord({
        entity: company.entity,
        external_url: searchUrl,
        articleCount: latest.value,
        articleDelta: previous ? latest.value - previous.value : undefined
      });
      const item = await persistContentItem(ctx.client, {
        itemType: "gdelt_link",
        eventTime: latest.intervalEnd,
        headline: record.headline_generated,
        summary: `Detected via index metadata (${Math.round(latest.value)} articles in the ${GDELT_INTERVAL_MINUTES}-minute interval). Open original sources for full coverage.`,
        externalUrl: searchUrl,
        sourceId: source.sourceId,
        licenseId,
        isBreaking: true,
        region: "GLOBAL",
        meta: {
          ...record.meta,
          previous_count: previous?.value ?? null,
          interval_end: latest.intervalEnd,
          query: company.entity,
          run_id: ctx.runId
        },
        dedupeKey: `gdelt:${company.slug}:${latest.intervalEnd}`
      });
      await linkItemEntity(ctx.client, item.itemId, company.slug, "subject");
      items += item.inserted ? 1 : 0;
    } catch (error) {
      failures += 1;
      logEvent("warn", "gdelt_entity_failed", { entity: company.entity, run_id: ctx.runId, ...describeError(error) });
    }
  }

  if (companies.length > 0 && failures === companies.length) {
    throw new Error(`gdelt: all ${failures} tracked companies failed`);
  }
  return { source: "GDELT", status: "ok", items, note: `failures=${failures} no_data=${noData}` };
}
