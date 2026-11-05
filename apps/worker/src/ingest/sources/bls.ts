import { fetchJson, UpstreamError } from "../http";
import { latestPoint, pad2, safeNumber, sortByObsDate, type NumPoint } from "../parse";
import { licenseIdFor, persistContentItem, persistSeries, requireSource } from "../persist";
import { computeYearOverYear } from "../series";
import type { IngestContext, SourceRunResult } from "./types";

const BLS_ENDPOINT = "https://api.bls.gov/publicAPI/v2/timeseries/data/";
const BLS_DOCS = "https://www.bls.gov/developers/";

/**
 * CPI-U all items, NOT seasonally adjusted: BLS computes the headline
 * 12-month change from the unadjusted index.
 */
export const BLS_SERIES = {
  cpiIndexNsa: "CUUR0000SA0",
  unemploymentRate: "LNS14000000",
  nonfarmPayrolls: "CES0000000001",
  avgHourlyEarnings: "CES0500000003"
} as const;

interface BlsResponse {
  status?: string;
  message?: string[];
  Results?: { series?: Array<{ seriesID?: string; data?: Array<Record<string, unknown>> }> };
}

/** Monthly observations; skips "-" (not published, e.g. October 2025) and M13 annual averages. */
export function parseBlsMonthly(rows: Array<Record<string, unknown>>): NumPoint[] {
  const points: NumPoint[] = [];
  for (const row of rows) {
    const period = typeof row.period === "string" ? row.period : "";
    const year = typeof row.year === "string" ? Number(row.year) : Number.NaN;
    const value = safeNumber(row.value);
    if (!/^M(0[1-9]|1[0-2])$/.test(period) || !Number.isFinite(year) || value === null) {
      continue;
    }
    points.push({ obsDate: `${year}-${pad2(Number(period.slice(1)))}-01`, valueNum: value, valueRaw: String(row.value).trim() });
  }
  return sortByObsDate(points);
}

/** One POST for all series (counts as a single query against the daily limit). */
async function fetchBlsSeries(seriesIds: string[], registrationKey: string | undefined): Promise<Map<string, NumPoint[]>> {
  const currentYear = new Date().getUTCFullYear();
  const payload = await fetchJson<BlsResponse>(
    BLS_ENDPOINT,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        seriesid: seriesIds,
        startyear: String(currentYear - 2),
        endyear: String(currentYear),
        ...(registrationKey ? { registrationkey: registrationKey } : {})
      })
    },
    "bls"
  );
  if (payload.status !== "REQUEST_SUCCEEDED") {
    throw new UpstreamError(`bls: ${payload.status ?? "unknown status"} ${(payload.message ?? []).join(" ")}`.trim(), false);
  }
  const bySeries = new Map<string, NumPoint[]>();
  for (const series of payload.Results?.series ?? []) {
    if (series.seriesID) {
      bySeries.set(series.seriesID, parseBlsMonthly(series.data ?? []));
    }
  }
  return bySeries;
}

export async function ingestBls(ctx: IngestContext): Promise<SourceRunResult> {
  const source = await requireSource(ctx.client, "BLS");
  const licenseId = await licenseIdFor(ctx.client, "BLS_PUBLIC", source);
  const data = await fetchBlsSeries(Object.values(BLS_SERIES), ctx.env.BLS_API_KEY?.trim() || undefined);

  const cpiYoy = computeYearOverYear(data.get(BLS_SERIES.cpiIndexNsa) ?? []).slice(-24);
  const unemployment = (data.get(BLS_SERIES.unemploymentRate) ?? []).slice(-36);
  const payrolls = (data.get(BLS_SERIES.nonfarmPayrolls) ?? []).slice(-36);
  const earnings = (data.get(BLS_SERIES.avgHourlyEarnings) ?? []).slice(-36);

  const common = { sourceId: source.sourceId, geo: "US", frequency: "monthly", licenseId, originUrl: BLS_DOCS, rawLocked: false };
  let series = 0;
  let observations = 0;
  const persist = async (definition: Parameters<typeof persistSeries>[1], points: NumPoint[]): Promise<void> => {
    if (points.length === 0) {
      return;
    }
    await persistSeries(ctx.client, definition, points);
    series += 1;
    observations += points.length;
  };

  await persist(
    {
      ...common,
      seriesCode: "US_CPI_YOY",
      title: "US CPI YoY",
      units: "%",
      isDerived: true,
      derivation: { method: "yoy_date_matched", input: BLS_SERIES.cpiIndexNsa, seasonal_adjustment: "not_seasonally_adjusted" }
    },
    cpiYoy
  );
  await persist({ ...common, seriesCode: "US_UNEMPLOYMENT_RATE", title: "US Unemployment Rate", units: "%", isDerived: false, derivation: null }, unemployment);
  await persist({ ...common, seriesCode: "US_NONFARM_PAYROLLS", title: "US Nonfarm Payrolls", units: "thousand persons", isDerived: false, derivation: null }, payrolls);
  await persist({ ...common, seriesCode: "US_AVG_HOURLY_EARNINGS", title: "US Avg Hourly Earnings", units: "USD/hour", isDerived: false, derivation: null }, earnings);

  const latest = {
    cpi: latestPoint(cpiYoy),
    unemployment: latestPoint(unemployment),
    payrolls: latestPoint(payrolls),
    earnings: latestPoint(earnings)
  };
  const periods = Object.values(latest)
    .map((point) => point?.obsDate)
    .filter((value): value is string => Boolean(value))
    .sort();
  const period = periods[periods.length - 1];
  let items = 0;
  if (period) {
    await persistContentItem(ctx.client, {
      itemType: "macro_update",
      eventTime: new Date().toISOString(),
      headline: "BLS CPI, labor, and wage indicators refreshed",
      summary: `CPI YoY ${latest.cpi?.valueNum ?? "n/a"}% · Unemployment ${latest.unemployment?.valueNum ?? "n/a"}% · Payrolls ${
        latest.payrolls?.valueNum ?? "n/a"
      }k · AHE $${latest.earnings?.valueNum ?? "n/a"}`,
      externalUrl: BLS_DOCS,
      sourceId: source.sourceId,
      licenseId,
      isBreaking: true,
      region: "US",
      meta: { series: ["US_CPI_YOY", "US_UNEMPLOYMENT_RATE", "US_NONFARM_PAYROLLS", "US_AVG_HOURLY_EARNINGS"], period, run_id: ctx.runId },
      dedupeKey: `macro:bls:${period}`
    });
    items = 1;
  }
  return { source: "BLS", status: "ok", series, observations, items };
}
