import { fetchText } from "../http";
import { latestPoint, pad2, safeNumber, sortByObsDate, type NumPoint } from "../parse";
import { licenseIdFor, persistContentItem, persistSeries, requireSource } from "../persist";
import type { IngestContext, SourceRunResult } from "./types";

const H15_URL = "https://www.federalreserve.gov/releases/h15/";
const MONTHS: Record<string, number> = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };

/** Column id -> ISO date from the H.15 daily table header. */
export function parseH15Headers(html: string): Map<string, string> {
  const headers = new Map<string, string>();
  const headerRegex = /<th id="col(\d+)" class="colhead">(\d{4})<br>([A-Za-z]{3})<br>(\d{1,2})<\/th>/g;
  for (const match of html.matchAll(headerRegex)) {
    const month = MONTHS[match[3] ?? ""];
    if (month) {
      headers.set(match[1] ?? "", `${match[2]}-${pad2(month)}-${pad2(Number(match[4]))}`);
    }
  }
  return headers;
}

export function parseH15Row(rowHtml: string | null, headers: Map<string, string>): NumPoint[] {
  if (!rowHtml) {
    return [];
  }
  const points: NumPoint[] = [];
  for (const match of rowHtml.matchAll(/headers="[^"]* col(\d+)"[^>]*>&nbsp;\s*([^<&]+)\s*&nbsp;<\/td>/g)) {
    const obsDate = headers.get(match[1] ?? "");
    const raw = (match[2] ?? "").trim();
    const value = safeNumber(raw);
    if (obsDate && value !== null) {
      points.push({ obsDate, valueNum: value, valueRaw: raw });
    }
  }
  return sortByObsDate(points);
}

export async function ingestFrb(ctx: IngestContext): Promise<SourceRunResult> {
  const source = await requireSource(ctx.client, "Federal Reserve Board");
  const licenseId = await licenseIdFor(ctx.client, "FRB_PUBLIC", source);
  const html = await fetchText(H15_URL, {}, "frb_h15");
  const headers = parseH15Headers(html);
  const fedFunds = parseH15Row(html.match(/Federal funds \(effective\)[\s\S]*?<\/tr>/i)?.[0] ?? null, headers);
  const tenYear = parseH15Row(html.match(/<th[^>]*>\s*10-year\s*<\/th>[\s\S]*?<\/tr>/i)?.[0] ?? null, headers);
  if (fedFunds.length === 0 && tenYear.length === 0) {
    // The page layout changed or was not served: fail loudly instead of reporting success.
    throw new Error("frb_h15: no rate rows found in the H.15 page (layout change?)");
  }

  const common = { sourceId: source.sourceId, geo: "US", frequency: "daily", units: "%", isDerived: false, derivation: null, licenseId, originUrl: H15_URL, rawLocked: false };
  if (fedFunds.length > 0) {
    await persistSeries(ctx.client, { ...common, seriesCode: "US_FEDFUNDS", title: "US Effective Fed Funds" }, fedFunds);
  }
  if (tenYear.length > 0) {
    await persistSeries(ctx.client, { ...common, seriesCode: "US_TREASURY_10Y", title: "US 10Y Treasury Yield" }, tenYear);
  }

  const latestFed = latestPoint(fedFunds);
  const latestTen = latestPoint(tenYear);
  const period = [latestFed?.obsDate, latestTen?.obsDate].filter((value): value is string => Boolean(value)).sort().pop()!;
  await persistContentItem(ctx.client, {
    itemType: "fact_flash",
    eventTime: new Date().toISOString(),
    headline: "Federal Reserve Board rates snapshot updated",
    summary: `Fed funds ${latestFed?.valueNum ?? "n/a"}% · US 10Y ${latestTen?.valueNum ?? "n/a"}% (as of ${period})`,
    externalUrl: H15_URL,
    sourceId: source.sourceId,
    licenseId,
    isBreaking: true,
    region: "US",
    meta: { series: ["US_FEDFUNDS", "US_TREASURY_10Y"], period, run_id: ctx.runId },
    dedupeKey: `macro:frb:${period}`
  });
  return { source: "FRB", status: "ok", series: (fedFunds.length > 0 ? 1 : 0) + (tenYear.length > 0 ? 1 : 0), observations: fedFunds.length + tenYear.length, items: 1 };
}
