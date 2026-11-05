import { fetchJson } from "../http";
import { latestPoint, safeNumber, sortByObsDate, type NumPoint } from "../parse";
import { licenseIdFor, persistContentItem, persistSeries, requireSource } from "../persist";
import type { IngestContext, SourceRunResult } from "./types";

const EIA_DOCS = "https://www.eia.gov/opendata/";

export async function ingestEia(ctx: IngestContext): Promise<SourceRunResult> {
  const source = await requireSource(ctx.client, "EIA");
  const licenseId = await licenseIdFor(ctx.client, "EIA_PUBLIC", source);
  const apiKey = ctx.env.EIA_API_KEY?.trim() || "DEMO_KEY";

  // 60 weeks so the one-year-earlier observation exists for YoY.
  const url =
    "https://api.eia.gov/v2/petroleum/stoc/wstk/data/?" +
    "frequency=weekly&data[0]=value&facets[duoarea][]=NUS&facets[product][]=EPC0&facets[process][]=SAX" +
    "&sort[0][column]=period&sort[0][direction]=desc&length=60&api_key=" +
    encodeURIComponent(apiKey);
  const payload = await fetchJson<{ response?: { data?: Array<Record<string, unknown>> } }>(url, {}, "eia");
  const points: NumPoint[] = [];
  for (const row of payload.response?.data ?? []) {
    const period = typeof row.period === "string" && /^\d{4}-\d{2}-\d{2}$/.test(row.period) ? row.period : null;
    const value = safeNumber(row.value);
    if (period && value !== null) {
      points.push({ obsDate: period, valueNum: value, valueRaw: String(row.value) });
    }
  }
  const rows = sortByObsDate(points);
  if (rows.length === 0) {
    return { source: "EIA", status: "ok", series: 0, observations: 0, items: 0, note: "no observations returned" };
  }

  await persistSeries(
    ctx.client,
    {
      sourceId: source.sourceId,
      seriesCode: "US_EIA_CRUDE_STOCKS",
      title: "US Crude Stocks (ex. SPR)",
      geo: "US",
      frequency: "weekly",
      units: "MBBL",
      isDerived: false,
      derivation: null,
      licenseId,
      originUrl: EIA_DOCS,
      rawLocked: false
    },
    rows
  );

  const latest = latestPoint(rows)!;
  await persistContentItem(ctx.client, {
    itemType: "macro_update",
    eventTime: new Date().toISOString(),
    headline: "EIA weekly crude inventory updated",
    summary: `U.S. ending stocks excluding SPR (week of ${latest.obsDate}): ${latest.valueNum.toLocaleString("en-US")} thousand barrels`,
    externalUrl: EIA_DOCS,
    sourceId: source.sourceId,
    licenseId,
    isBreaking: false,
    region: "US",
    meta: { series: "US_EIA_CRUDE_STOCKS", period: latest.obsDate, run_id: ctx.runId },
    dedupeKey: `macro:eia:${latest.obsDate}`
  });
  return { source: "EIA", status: "ok", series: 1, observations: rows.length, items: 1 };
}
