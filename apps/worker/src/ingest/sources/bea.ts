import { fetchJson, UpstreamError } from "../http";
import { latestPoint, parseQuarterStart, safeNumber, sortByObsDate, type NumPoint } from "../parse";
import { licenseIdFor, persistContentItem, persistSeries, requireSource } from "../persist";
import type { IngestContext, SourceRunResult } from "./types";

const BEA_DOCS = "https://apps.bea.gov/API/docs/index.htm";

/**
 * NIPA Table 1.1.1 (T10101) is "Percent Change From Preceding Period in Real
 * Gross Domestic Product" — values are already growth rates, seasonally
 * adjusted at annual rates. Line 1 is GDP. They are stored as published;
 * no further transformation is applied.
 */
export function parseBeaT10101Line1(rows: Array<Record<string, unknown>>): NumPoint[] {
  const points: NumPoint[] = [];
  for (const row of rows) {
    const obsDate = typeof row.TimePeriod === "string" ? parseQuarterStart(row.TimePeriod) : null;
    const raw = typeof row.DataValue === "string" ? row.DataValue.trim() : String(row.DataValue ?? "");
    const value = safeNumber(raw);
    if (String(row.LineNumber ?? "") === "1" && obsDate && value !== null) {
      points.push({ obsDate, valueNum: value, valueRaw: raw });
    }
  }
  return sortByObsDate(points);
}

export async function ingestBea(ctx: IngestContext): Promise<SourceRunResult> {
  const apiKey = ctx.env.BEA_API_KEY?.trim();
  if (!apiKey) {
    return { source: "BEA", status: "skipped", note: "BEA_API_KEY is not configured" };
  }
  const source = await requireSource(ctx.client, "BEA");
  const licenseId = await licenseIdFor(ctx.client, "BEA_PUBLIC", source);

  const currentYear = new Date().getUTCFullYear();
  const years = [currentYear - 4, currentYear - 3, currentYear - 2, currentYear - 1, currentYear].join(",");
  const url =
    "https://apps.bea.gov/api/data/?" +
    `UserID=${encodeURIComponent(apiKey)}&method=GetData&datasetname=NIPA&TableName=T10101&Frequency=Q&Year=${encodeURIComponent(years)}&ResultFormat=JSON`;
  const payload = await fetchJson<{ BEAAPI?: { Results?: { Data?: Array<Record<string, unknown>>; Error?: unknown }; Error?: unknown } }>(url, {}, "bea");
  const error = payload.BEAAPI?.Error ?? payload.BEAAPI?.Results?.Error;
  if (error) {
    throw new UpstreamError(`bea: ${JSON.stringify(error).slice(0, 200)}`, false);
  }
  const growth = parseBeaT10101Line1(payload.BEAAPI?.Results?.Data ?? []).slice(-20);
  if (growth.length === 0) {
    return { source: "BEA", status: "ok", series: 0, observations: 0, items: 0, note: "no observations returned" };
  }

  await persistSeries(
    ctx.client,
    {
      sourceId: source.sourceId,
      seriesCode: "US_REAL_GDP_GROWTH_SAAR",
      title: "US Real GDP Growth (q/q, SAAR)",
      geo: "US",
      frequency: "quarterly",
      units: "%",
      isDerived: false,
      derivation: null,
      licenseId,
      originUrl: BEA_DOCS,
      rawLocked: false
    },
    growth
  );

  const latest = latestPoint(growth)!;
  await persistContentItem(ctx.client, {
    itemType: "macro_update",
    eventTime: new Date().toISOString(),
    headline: "BEA GDP estimate refreshed",
    summary: `Real GDP, percent change from preceding quarter (seasonally adjusted annual rate): ${latest.valueRaw}%`,
    externalUrl: BEA_DOCS,
    sourceId: source.sourceId,
    licenseId,
    isBreaking: true,
    region: "US",
    meta: { series: "US_REAL_GDP_GROWTH_SAAR", period: latest.obsDate, run_id: ctx.runId },
    dedupeKey: `macro:bea:${latest.obsDate}`
  });
  return { source: "BEA", status: "ok", series: 1, observations: growth.length, items: 1 };
}
