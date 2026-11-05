import { resolveLicenseContext } from "../../services/ingestDb";
import { describeError, logEvent } from "../../services/log";
import { fetchJson, fetchText } from "../http";
import { applyEurostatFilter, shouldBlockDatasetForProduction } from "../macro";
import { latestPoint, monthStartFromYearMonth, parseCsvRecords, safeNumber, sortByObsDate, type NumPoint } from "../parse";
import { persistContentItem, persistSeries, requireSource } from "../persist";
import type { IngestContext, SourceRunResult } from "./types";

/*
 * Conditional-license sources (Eurostat, OECD, World Bank). Data is stored with
 * the conditional license, so the public API (allowed-only filter) never shows
 * it until a license review changes the status. Items are quarantine notices.
 */

async function conditionalLicenseId(ctx: IngestContext, code: string): Promise<string> {
  const license = await resolveLicenseContext(ctx.client, code);
  if (!license) {
    throw new Error(`License "${code}" is not registered in the licenses table.`);
  }
  return license.licenseId;
}

export async function ingestEurostat(ctx: IngestContext): Promise<SourceRunResult> {
  const source = await requireSource(ctx.client, "Eurostat");
  const licenseId = await conditionalLicenseId(ctx, "EUROSTAT_CONDITIONAL");
  const payload = await fetchJson<{ dimension?: { time?: { category?: { index?: Record<string, number> } } }; value?: Record<string, unknown> }>(
    "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/une_rt_m?geo=EA20&sex=T&age=TOTAL&unit=PC_ACT&s_adj=SA",
    {},
    "eurostat"
  );
  const timeIndex = payload.dimension?.time?.category?.index ?? {};
  const values = payload.value ?? {};
  const points = applyEurostatFilter(
    Object.entries(timeIndex)
      .map(([period, key]) => {
        const obsDate = monthStartFromYearMonth(period);
        const value = safeNumber(values[String(key)]);
        return obsDate && value !== null ? { obsDate, valueNum: value, valueRaw: String(values[String(key)]), value, geo: "EA" } : null;
      })
      .filter((point): point is NumPoint & { value: number; geo: string } => point !== null)
  ).map(({ obsDate, valueNum, valueRaw }) => ({ obsDate, valueNum, valueRaw }));

  const rows = sortByObsDate(points).slice(-24);
  if (rows.length === 0) {
    return { source: "EUROSTAT", status: "held", series: 0, observations: 0, note: "no observations returned" };
  }
  await persistSeries(
    ctx.client,
    {
      sourceId: source.sourceId,
      seriesCode: "EU_UNEMPLOYMENT",
      title: "EU Unemployment",
      geo: "EA",
      frequency: "monthly",
      units: "%",
      isDerived: false,
      derivation: null,
      licenseId,
      originUrl: "https://ec.europa.eu/eurostat",
      rawLocked: false
    },
    rows
  );
  const blocked = shouldBlockDatasetForProduction({ restriction_notes: "Conditional Eurostat dataset requires policy review." });
  const latest = latestPoint(rows)!;
  await persistContentItem(ctx.client, {
    itemType: blocked ? "analysis" : "macro_update",
    eventTime: new Date().toISOString(),
    headline: blocked ? "Eurostat unemployment dataset queued for policy clearance" : "Eurostat unemployment updated",
    summary: blocked
      ? "Dataset remains in compliance hold until conditional-license review is completed."
      : `EA unemployment: ${latest.valueNum}%`,
    externalUrl: "https://ec.europa.eu/eurostat",
    sourceId: source.sourceId,
    licenseId,
    isBreaking: false,
    region: "EU",
    meta: { series: "EU_UNEMPLOYMENT", status: blocked ? "quarantine" : "allowed", run_id: ctx.runId },
    dedupeKey: `macro:eurostat:${latest.obsDate}`
  });
  return { source: "EUROSTAT", status: blocked ? "held" : "ok", series: 1, observations: rows.length, items: 1 };
}

const OECD_URLS = [
  "https://sdmx.oecd.org/public/rest/data/OECD.SDD.TPS,DSD_LFS@DF_IALFS_UNE_M,1.0/EA20.UNE_LF_M.PT_LF_SUB._Z.N._T.Y_GE15._Z.M?startPeriod=2024-01&format=csvfile",
  "https://sdmx.oecd.org/public/rest/data/OECD.SDD.TPS,DSD_LFS@DF_IALFS_UNE_M,1.0/all?lastNObservations=24&format=csvfile"
];

/** Rows of the EA20 monthly unemployment rate (not seasonally adjusted, 15+, total). */
export function parseOecdUnemployment(csv: string): NumPoint[] {
  const points: NumPoint[] = [];
  for (const record of parseCsvRecords(csv)) {
    const matches =
      record.REF_AREA === "EA20" &&
      record.MEASURE === "UNE_LF_M" &&
      record.UNIT_MEASURE === "PT_LF_SUB" &&
      record.ADJUSTMENT === "N" &&
      record.SEX === "_T" &&
      record.AGE === "Y_GE15" &&
      record.ACTIVITY === "_Z" &&
      record.FREQ === "M";
    const obsDate = monthStartFromYearMonth(record.TIME_PERIOD ?? "");
    const value = safeNumber(record.OBS_VALUE);
    if (matches && obsDate && value !== null) {
      points.push({ obsDate, valueNum: value, valueRaw: (record.OBS_VALUE ?? "").trim() });
    }
  }
  return sortByObsDate(points).slice(-24);
}

export async function ingestOecd(ctx: IngestContext): Promise<SourceRunResult> {
  const source = await requireSource(ctx.client, "OECD");
  const licenseId = await conditionalLicenseId(ctx, "OECD_CONDITIONAL");
  const headers: HeadersInit = {
    accept: "text/csv,application/vnd.sdmx.data+csv",
    "user-agent": ctx.env.SEC_USER_AGENT ?? "Open Finance Pulse contact@financeaxiom.com"
  };

  let points: NumPoint[] = [];
  let lastError: unknown = null;
  for (const url of OECD_URLS) {
    try {
      points = parseOecdUnemployment(await fetchText(url, { headers }, "oecd"));
      if (points.length > 0) {
        break;
      }
    } catch (error) {
      lastError = error;
    }
  }

  if (points.length === 0) {
    // Conditional, non-public dataset: record the hold and report it explicitly (not as success).
    logEvent("warn", "oecd_dataset_unavailable", { run_id: ctx.runId, ...(lastError ? describeError(lastError) : {}) });
    await persistContentItem(ctx.client, {
      itemType: "analysis",
      eventTime: new Date().toISOString(),
      headline: "OECD labor dataset queued for policy clearance",
      summary: "OECD endpoint unavailable from current runtime; metadata-only compliance hold remains active.",
      externalUrl: "https://www.oecd.org/",
      sourceId: source.sourceId,
      licenseId,
      isBreaking: false,
      region: "GLOBAL",
      meta: { status: "quarantine", reason: "endpoint_unavailable", run_id: ctx.runId },
      dedupeKey: `macro:oecd:hold:${new Date().toISOString().slice(0, 10)}`
    });
    return { source: "OECD", status: "held", series: 0, observations: 0, items: 1, note: "endpoint unavailable" };
  }

  await persistSeries(
    ctx.client,
    {
      sourceId: source.sourceId,
      seriesCode: "OECD_EA20_UNEMPLOYMENT",
      title: "OECD EA20 Unemployment",
      geo: "EA",
      frequency: "monthly",
      units: "%",
      isDerived: false,
      derivation: null,
      licenseId,
      originUrl: "https://sdmx.oecd.org/",
      rawLocked: false
    },
    points
  );
  const latest = latestPoint(points)!;
  await persistContentItem(ctx.client, {
    itemType: "analysis",
    eventTime: new Date().toISOString(),
    headline: "OECD labor dataset queued for policy clearance",
    summary: "OECD dataset is retained as metadata-only pending rights validation.",
    externalUrl: "https://www.oecd.org/",
    sourceId: source.sourceId,
    licenseId,
    isBreaking: false,
    region: "GLOBAL",
    meta: { series: "OECD_EA20_UNEMPLOYMENT", status: "quarantine", run_id: ctx.runId },
    dedupeKey: `macro:oecd:${latest.obsDate}`
  });
  return { source: "OECD", status: "held", series: 1, observations: points.length, items: 1 };
}

export async function ingestWorldBank(ctx: IngestContext): Promise<SourceRunResult> {
  const source = await requireSource(ctx.client, "World Bank");
  const licenseId = await conditionalLicenseId(ctx, "WORLD_BANK_CONDITIONAL");
  const payload = await fetchJson<unknown[]>("https://api.worldbank.org/v2/country/WLD/indicator/NY.GDP.MKTP.CD?format=json&per_page=30", {}, "world_bank");
  const rows = Array.isArray(payload) && Array.isArray(payload[1]) ? (payload[1] as Array<Record<string, unknown>>) : [];
  const points = sortByObsDate(
    rows
      .map((row) => {
        const year = typeof row.date === "string" ? row.date : "";
        const value = safeNumber(row.value);
        return /^\d{4}$/.test(year) && value !== null ? { obsDate: `${year}-01-01`, valueNum: value, valueRaw: String(row.value) } : null;
      })
      .filter((row): row is NumPoint => row !== null)
  ).slice(-20);
  if (points.length === 0) {
    return { source: "WORLD_BANK", status: "held", series: 0, observations: 0, note: "no observations returned" };
  }

  await persistSeries(
    ctx.client,
    {
      sourceId: source.sourceId,
      seriesCode: "WB_GLOBAL_GDP_USD",
      title: "World Bank Global GDP (Current USD)",
      geo: "GLOBAL",
      frequency: "annual",
      units: "USD",
      isDerived: false,
      derivation: null,
      licenseId,
      originUrl: "https://datacatalog.worldbank.org/",
      rawLocked: false
    },
    points
  );
  const latest = latestPoint(points)!;
  await persistContentItem(ctx.client, {
    itemType: "analysis",
    eventTime: new Date().toISOString(),
    headline: "World Bank GDP dataset queued for license review",
    summary: "Dataset remains in compliance hold until conditional license checks pass.",
    externalUrl: "https://datacatalog.worldbank.org/",
    sourceId: source.sourceId,
    licenseId,
    isBreaking: false,
    region: "GLOBAL",
    meta: { series: "WB_GLOBAL_GDP_USD", status: "quarantine", run_id: ctx.runId },
    dedupeKey: `macro:wb:${latest.obsDate}`
  });
  return { source: "WORLD_BANK", status: "held", series: 1, observations: points.length, items: 1 };
}
