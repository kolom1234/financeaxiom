import { fetchText } from "../http";
import { latestPoint, monthStartFromYearMonth, parseCsv, safeNumber, sortByObsDate, type NumPoint } from "../parse";
import { licenseIdFor, persistContentItem, persistRawLockedSeries, persistSeries, requireSource } from "../persist";
import { computeYearOverYear } from "../series";
import type { IngestContext, SourceRunResult } from "./types";

const ECB_STATS = "https://www.ecb.europa.eu/stats/";

/** ECB csvdata: locate TIME_PERIOD / OBS_VALUE by header, falling back to their usual positions (7, 8). */
export function parseEcbCsv(csv: string): NumPoint[] {
  const [header, ...rows] = parseCsv(csv);
  if (!header) {
    return [];
  }
  const periodIndex = header.indexOf("TIME_PERIOD") >= 0 ? header.indexOf("TIME_PERIOD") : 7;
  const valueIndex = header.indexOf("OBS_VALUE") >= 0 ? header.indexOf("OBS_VALUE") : 8;
  const points: NumPoint[] = [];
  for (const columns of rows) {
    const obsDate = monthStartFromYearMonth(columns[periodIndex] ?? "");
    const valueRaw = (columns[valueIndex] ?? "").trim();
    const value = safeNumber(valueRaw);
    if (obsDate && value !== null) {
      // valueRaw is kept exactly as published (raw-lock requirement).
      points.push({ obsDate, valueNum: value, valueRaw });
    }
  }
  return sortByObsDate(points);
}

export async function ingestEcb(ctx: IngestContext): Promise<SourceRunResult> {
  const source = await requireSource(ctx.client, "ECB");
  const licenseId = await licenseIdFor(ctx.client, "ECB_STATS", source);

  const startPeriod = `${new Date().getUTCFullYear() - 3}-01`;
  const csv = await fetchText(
    `https://data-api.ecb.europa.eu/service/data/ICP/M.U2.N.000000.4.INX?format=csvdata&detail=dataonly&startPeriod=${startPeriod}`,
    {},
    "ecb"
  );
  const rawPoints = parseEcbCsv(csv).slice(-48);
  if (rawPoints.length === 0) {
    return { source: "ECB", status: "ok", series: 0, observations: 0, items: 0, note: "no observations returned" };
  }

  const { revisions } = await persistRawLockedSeries(
    ctx.client,
    {
      sourceId: source.sourceId,
      seriesCode: "EU_HICP_RAW",
      title: "EU HICP Raw",
      geo: "EU",
      frequency: "monthly",
      units: "index",
      isDerived: false,
      derivation: null,
      licenseId,
      originUrl: ECB_STATS,
      rawLocked: true
    },
    rawPoints
  );

  // Derived values are computed from the current official raw values (after revisions).
  const derivedPoints = computeYearOverYear(rawPoints).slice(-24);
  let items = 0;
  if (derivedPoints.length > 0) {
    await persistSeries(
      ctx.client,
      {
        sourceId: source.sourceId,
        seriesCode: "EU_HICP_YOY",
        title: "EU HICP YoY",
        geo: "EU",
        frequency: "monthly",
        units: "%",
        isDerived: true,
        derivation: { method: "yoy_date_matched", input: "EU_HICP_RAW" },
        licenseId,
        originUrl: ECB_STATS,
        rawLocked: false
      },
      derivedPoints
    );
    const latest = latestPoint(derivedPoints)!;
    await persistContentItem(ctx.client, {
      itemType: "macro_update",
      eventTime: new Date().toISOString(),
      headline: "Euro area HICP YoY updated",
      summary: `Derived from ECB raw index: ${latest.valueNum}% (${latest.obsDate.slice(0, 7)})`,
      externalUrl: ECB_STATS,
      sourceId: source.sourceId,
      licenseId,
      isBreaking: false,
      region: "EU",
      meta: { series: "EU_HICP_YOY", raw_locked: true, period: latest.obsDate, run_id: ctx.runId },
      dedupeKey: `macro:ecb:${latest.obsDate}`
    });
    items = 1;
  }
  return { source: "ECB", status: "ok", series: derivedPoints.length > 0 ? 2 : 1, observations: rawPoints.length + derivedPoints.length, revisions: revisions.length, items };
}
