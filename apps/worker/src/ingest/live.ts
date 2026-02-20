import { buildGdeltHeadline, buildGdeltSearchUrl, transformGdeltRecord } from "./gdelt";
import { applyEurostatFilter, shouldBlockDatasetForProduction, validateEcbRawUnchanged } from "./macro";
import { assertSecPolicyReady, buildSecHeadline } from "./sec";
import {
  getExistingObservationRaw,
  linkItemEntity,
  resolveLicenseContext,
  resolveSourceContext,
  upsertContentItem,
  upsertEntity,
  upsertFiling,
  upsertSeries,
  upsertSeriesObservation,
  withIngestDb
} from "../services/ingestDb";
import { sha256Hex } from "../services/hash";
import { acquireSecPermit } from "../services/sec";
import type { Env, IngestQueueMessage } from "../types";

type DbClient = Parameters<Parameters<typeof withIngestDb>[1]>[0];
type NumPoint = { obsDate: string; valueNum: number; valueRaw: string };

function toIsoMinuteBucket(now: Date, intervalMinutes: number): string {
  const bucket = new Date(now);
  bucket.setUTCSeconds(0, 0);
  bucket.setUTCMinutes(Math.floor(bucket.getUTCMinutes() / intervalMinutes) * intervalMinutes);
  return bucket.toISOString();
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

function normalizeCik(input: string): string {
  const digits = input.replace(/\D/g, "");
  return digits.padStart(10, "0");
}

function safeNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, "").trim());
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function normalizeEntitySlug(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function round1(value: number): number {
  return Number(value.toFixed(1));
}

function monthStartFromYearMonth(value: string): string | null {
  const match = value.match(/^(\d{4})-(\d{2})$/);
  if (!match) {
    return null;
  }
  return `${match[1]}-${match[2]}-01`;
}

function parseQuarterStart(period: string): string | null {
  const match = period.match(/^(\d{4})Q([1-4])$/);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const quarter = Number(match[2]);
  const month = quarter === 1 ? 1 : quarter === 2 ? 4 : quarter === 3 ? 7 : 10;
  return `${year}-${pad2(month)}-01`;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === "\"") {
      const isEscapedQuote = inQuotes && line[index + 1] === "\"";
      if (isEscapedQuote) {
        current += "\"";
        index += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (char === "," && !inQuotes) {
      out.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  out.push(current);
  return out;
}

function parseCsv(text: string): string[][] {
  return text
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map(parseCsvLine);
}

function parseBlsMonthlyRows(rowsRaw: Record<string, unknown>[]): NumPoint[] {
  return sortByObsDate(
    rowsRaw
      .map((row) => {
        const period = typeof row.period === "string" ? row.period : "";
        const year = typeof row.year === "string" ? Number(row.year) : Number.NaN;
        const value = safeNumber(row.value);
        if (!/^M(0[1-9]|1[0-2])$/.test(period) || !Number.isFinite(year) || value === null) {
          return null;
        }
        const month = Number(period.slice(1));
        return {
          obsDate: `${year}-${pad2(month)}-01`,
          valueNum: value,
          valueRaw: String(value)
        } as NumPoint;
      })
      .filter((row): row is NumPoint => row !== null)
  );
}

function extractFrbRowPoints(rowHtml: string | null, headers: Map<string, string>): NumPoint[] {
  if (!rowHtml) {
    return [];
  }
  const valueRegex = /headers="[^"]* col(\d+)"[^>]*>&nbsp;\s*([^<&]+)\s*&nbsp;<\/td>/g;
  const points: NumPoint[] = [];
  let valueMatch = valueRegex.exec(rowHtml);
  while (valueMatch) {
    const colId = valueMatch[1] ?? "";
    const obsDate = headers.get(colId);
    const value = safeNumber(valueMatch[2] ?? "");
    if (obsDate && value !== null) {
      points.push({
        obsDate,
        valueNum: value,
        valueRaw: String(value)
      });
    }
    valueMatch = valueRegex.exec(rowHtml);
  }
  return sortByObsDate(points);
}

function latest<T extends { obsDate: string }>(rows: T[]): T | null {
  if (rows.length === 0) {
    return null;
  }
  const sorted = [...rows].sort((a, b) => a.obsDate.localeCompare(b.obsDate));
  return sorted[sorted.length - 1] ?? null;
}

function sortByObsDate<T extends { obsDate: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.obsDate.localeCompare(b.obsDate));
}

function computeYearOverYear(series: NumPoint[]): NumPoint[] {
  if (series.length < 13) {
    return [];
  }
  const out: NumPoint[] = [];
  for (let index = 12; index < series.length; index += 1) {
    const current = series[index];
    const prev = series[index - 12];
    if (!current || !prev) {
      continue;
    }
    if (Math.abs(prev.valueNum) < 0.000001) {
      continue;
    }
    const yoy = round1(((current.valueNum - prev.valueNum) / Math.abs(prev.valueNum)) * 100);
    out.push({
      obsDate: current.obsDate,
      valueNum: yoy,
      valueRaw: String(yoy)
    });
  }
  return out;
}

const UPSTREAM_TIMEOUT_MS = 10_000;
const UPSTREAM_MAX_ATTEMPTS = 3;
const UPSTREAM_RETRY_BASE_MS = 250;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function computeBackoff(attempt: number): number {
  return UPSTREAM_RETRY_BASE_MS * 2 ** Math.max(0, attempt - 1);
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

function isRetryableFetchError(error: unknown): boolean {
  if (error instanceof Error) {
    if (error.name === "AbortError") {
      return true;
    }
    return error.name === "TypeError";
  }
  return false;
}

async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort("upstream_timeout");
  }, UPSTREAM_TIMEOUT_MS);

  const combinedInit: RequestInit = { ...init };
  const originalSignal = init.signal;
  if (originalSignal) {
    const forwardAbort = () => {
      controller.abort(originalSignal.reason ?? "upstream_abort");
    };
    originalSignal.addEventListener("abort", forwardAbort);
    if (originalSignal.aborted) {
      forwardAbort();
    }
    const response = await fetch(url, { ...combinedInit, signal: controller.signal }).finally(() => {
      clearTimeout(timeout);
      originalSignal.removeEventListener("abort", forwardAbort);
    });
    return response;
  }

  try {
    return await fetch(url, { ...combinedInit, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson<T>(url: string, init: RequestInit = {}, label: string = "json"): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= UPSTREAM_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetchWithTimeout(url, init);
      if (!response.ok) {
        if (isRetryableStatus(response.status) && attempt < UPSTREAM_MAX_ATTEMPTS) {
          const waitMs = computeBackoff(attempt);
          await sleep(waitMs);
          continue;
        }
        throw new Error(`Fetch failed: ${response.status} ${response.statusText} (${label})`);
      }
      return (await response.json()) as T;
    } catch (error) {
      lastError = error;
      if (attempt < UPSTREAM_MAX_ATTEMPTS && isRetryableFetchError(error)) {
        const waitMs = computeBackoff(attempt);
        await sleep(waitMs);
        continue;
      }
      if (attempt < UPSTREAM_MAX_ATTEMPTS && error instanceof Error && error.message.includes("Fetch failed")) {
        const shouldRetry =
          error.message.includes("429") || error.message.includes("5") || error.message.includes("408");
        if (shouldRetry) {
          const waitMs = computeBackoff(attempt);
          await sleep(waitMs);
          continue;
        }
      }
      throw error;
    }
  }
  throw new Error(`Fetch failed after retries: ${String(lastError)}`);
}

async function fetchText(url: string, init: RequestInit = {}, label: string = "text"): Promise<string> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= UPSTREAM_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetchWithTimeout(url, init);
      if (!response.ok) {
        if (isRetryableStatus(response.status) && attempt < UPSTREAM_MAX_ATTEMPTS) {
          const waitMs = computeBackoff(attempt);
          await sleep(waitMs);
          continue;
        }
        throw new Error(`Fetch failed: ${response.status} ${response.statusText} (${label})`);
      }
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < UPSTREAM_MAX_ATTEMPTS && isRetryableFetchError(error)) {
        const waitMs = computeBackoff(attempt);
        await sleep(waitMs);
        continue;
      }
      if (attempt < UPSTREAM_MAX_ATTEMPTS && error instanceof Error && error.message.includes("Fetch failed")) {
        const shouldRetry =
          error.message.includes("429") || error.message.includes("5") || error.message.includes("408");
        if (shouldRetry) {
          const waitMs = computeBackoff(attempt);
          await sleep(waitMs);
          continue;
        }
      }
      throw error;
    }
  }
  throw new Error(`Fetch failed after retries: ${String(lastError)}`);
}

async function resolveLicenseId(client: DbClient, code: string, fallbackLicenseId: string): Promise<string> {
  const license = await resolveLicenseContext(client, code);
  return license?.licenseId ?? fallbackLicenseId;
}

interface GdeltMentionSignal {
  latest: number | null;
  previous: number | null;
}

async function fetchGdeltMentionCount(entity: string): Promise<GdeltMentionSignal> {
  const query = encodeURIComponent(entity);
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${query}&mode=timelinevolraw&format=json`;
  const response = await fetchJson<Record<string, unknown>>(url, {
    headers: { accept: "application/json" }
  }, "gdelt_timeline");
  if (!response) {
    return { latest: null, previous: null };
  }
  const json = response;
  const timeline = Array.isArray(json.timeline) ? (json.timeline as Record<string, unknown>[]) : [];
  if (timeline.length === 0) {
    return { latest: null, previous: null };
  }
  const candidate = timeline[timeline.length - 1];
  if (!candidate) {
    return { latest: null, previous: null };
  }
  const latest = safeNumber(candidate.value ?? candidate.count ?? candidate.norm ?? null);

  const previous = timeline.length > 1 ? safeNumber(timeline[timeline.length - 2]?.value ?? timeline[timeline.length - 2]?.count ?? null) : null;
  return { latest, previous };
}

interface GdeltMetaSignal {
  sourceCount: number | null;
  articleCount: number | null;
}

function extractDomain(source: unknown): string | null {
  if (typeof source !== "string") {
    return null;
  }
  const trimmed = source.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.toLowerCase();
}

async function fetchGdeltArticleSignals(entity: string): Promise<GdeltMetaSignal> {
  try {
    const query = encodeURIComponent(entity);
    const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${query}&mode=artlist&format=json&sort=datedesc&maxrecords=5`;
    const json = await fetchJson<Record<string, unknown>>(url, {
      headers: { accept: "application/json" }
    }, "gdelt_artlist");
    const articles = Array.isArray(json.articles) ? (json.articles as Record<string, unknown>[]) : [];
    const sources = new Set<string>();
    for (const article of articles) {
      const sourceField =
        extractDomain((article as Record<string, unknown>).source_domain) ??
        extractDomain((article as Record<string, unknown>).source) ??
        extractDomain((article as Record<string, unknown>).site) ??
        null;
      if (sourceField) {
        sources.add(sourceField);
        continue;
      }

      const urlValue = (article as Record<string, unknown>).url;
      if (typeof urlValue === "string") {
        try {
          sources.add(new URL(urlValue).hostname.toLowerCase());
        } catch {
          // ignore non-parsable urls
        }
      }
    }
    return {
      sourceCount: sources.size > 0 ? sources.size : null,
      articleCount: articles.length > 0 ? articles.length : null
    };
  } catch {
    return { sourceCount: null, articleCount: null };
  }
}

export async function ingestGdeltToDb(message: IngestQueueMessage, env: Env): Promise<boolean> {
  const result = await withIngestDb(env, async (client) => {
    const source = await resolveSourceContext(client, "GDELT");
    if (!source) {
      return false;
    }

    const entity = typeof message.params.entity === "string" ? message.params.entity : "NVIDIA";
    const ticker = typeof message.params.ticker === "string" ? message.params.ticker.toUpperCase() : null;
    const now = new Date();
    let mentionCount: number | null = null;
    let mentionDelta: number | null = null;
    let articleSignals: GdeltMetaSignal = { sourceCount: null, articleCount: null };
    try {
      const mentionSignal = await fetchGdeltMentionCount(entity);
      mentionCount = mentionSignal.latest;
      mentionDelta = mentionCount === null || mentionSignal.previous === null ? null : mentionCount - mentionSignal.previous;
      articleSignals = await fetchGdeltArticleSignals(entity);
    } catch {
      mentionCount = null;
      mentionDelta = null;
      articleSignals = { sourceCount: null, articleCount: null };
    }

    const searchUrl = buildGdeltSearchUrl(entity);
    const record = transformGdeltRecord({
      entity,
      window: "10m",
      external_url: searchUrl,
      score: mentionCount ?? undefined
    });
    const entitySlug = normalizeEntitySlug(entity);
    if (entitySlug) {
      await upsertEntity(client, {
        slug: entitySlug,
        name: entity,
        entityType: "company",
        primaryTicker: ticker,
        tickers: ticker ? [ticker] : null,
        exchanges: ["NASDAQ"],
        meta: {
          source: "gdelt",
          auto_seeded: true
        }
      });
    }

    const licenseId = await resolveLicenseId(client, "GDELT", source.defaultLicenseId);
    const dedupeKey = `gdelt:${entitySlug || entity.toLowerCase()}:${toIsoMinuteBucket(now, 10)}`;
    const upserted = await upsertContentItem(client, {
      itemType: "gdelt_link",
      eventTime: now.toISOString(),
      headline: buildGdeltHeadline({ entity, window: "10m", external_url: searchUrl, score: mentionCount ?? undefined, scoreDelta: mentionDelta ?? undefined }),
      summary:
        mentionCount === null
          ? record.summary_generated ?? "Detected via index metadata. Open original sources for full coverage."
          : `Detected via index metadata (volume: ${Math.round(mentionCount)}). Open original sources for full coverage.`,
      externalUrl: record.external_url,
      sourceId: source.sourceId,
      licenseId,
      isBreaking: true,
      region: "GLOBAL",
      meta: {
        ...record.meta,
        mention_count: mentionCount,
        article_count: articleSignals.articleCount,
        source_count: articleSignals.sourceCount,
        query: entity,
        run_id: message.run_id
      },
      dedupeKey
    });

    if (entitySlug) {
      await linkItemEntity(client, upserted.itemId, entitySlug, "subject");
    }
    return true;
  });

  return result ?? false;
}

interface SecSubmissions {
  cik?: string;
  name?: string;
  filings?: {
    recent?: {
      accessionNumber?: string[];
      form?: string[];
      filingDate?: string[];
      acceptanceDateTime?: string[];
      primaryDocument?: string[];
      items?: string[];
    };
  };
}

function secArchiveUrl(cik: string, accession: string, primaryDocument?: string | null): string {
  const numericCik = String(Number(cik));
  const accessionCompact = accession.replace(/-/g, "");
  const base = `https://www.sec.gov/Archives/edgar/data/${numericCik}/${accessionCompact}/`;
  if (primaryDocument && primaryDocument.trim().length > 0) {
    return `${base}${primaryDocument.trim()}`;
  }
  return base;
}

function extractLatestSecFiling(payload: SecSubmissions): {
  accession: string;
  formType: string;
  filingDate: string | null;
  acceptanceDateTime: string | null;
  primaryDocument: string | null;
} | null {
  const recent = payload.filings?.recent;
  if (!recent) {
    return null;
  }

  const accessions = Array.isArray(recent.accessionNumber) ? recent.accessionNumber : [];
  const forms = Array.isArray(recent.form) ? recent.form : [];
  const filingDates = Array.isArray(recent.filingDate) ? recent.filingDate : [];
  const accepted = Array.isArray(recent.acceptanceDateTime) ? recent.acceptanceDateTime : [];
  const docs = Array.isArray(recent.primaryDocument) ? recent.primaryDocument : [];

  for (let index = 0; index < accessions.length; index += 1) {
    const accession = accessions[index];
    if (!accession) {
      continue;
    }
    return {
      accession,
      formType: forms[index] ?? "8-K",
      filingDate: filingDates[index] ?? null,
      acceptanceDateTime: accepted[index] ?? null,
      primaryDocument: docs[index] ?? null
    };
  }
  return null;
}

export async function ingestSecToDb(message: IngestQueueMessage, env: Env): Promise<boolean> {
  const result = await withIngestDb(env, async (client) => {
    const source = await resolveSourceContext(client, "SEC EDGAR");
    if (!source) {
      return false;
    }

    assertSecPolicyReady(env.SEC_USER_AGENT);
    await acquireSecPermit(env);

    const cikInput = typeof message.params.cik === "string" ? message.params.cik : "1045810";
    const cik = normalizeCik(cikInput);
    const secJson = (await fetchJson(`https://data.sec.gov/submissions/CIK${cik}.json`, {
      headers: {
        "user-agent": env.SEC_USER_AGENT ?? "Open Finance Pulse contact@financeaxiom.com",
        accept: "application/json"
      }
    })) as SecSubmissions;

    const latestFiling = extractLatestSecFiling(secJson);
    if (!latestFiling) {
      return true;
    }
    const licenseId = await resolveLicenseId(client, "SEC_EDGAR", source.defaultLicenseId);

    const companyName = secJson.name ?? "Company";
    const secUrl = secArchiveUrl(cik, latestFiling.accession, latestFiling.primaryDocument);

    await upsertFiling(client, {
      accession: latestFiling.accession,
      cik,
      companyName,
      formType: latestFiling.formType,
      filedAt: latestFiling.filingDate ? `${latestFiling.filingDate}T00:00:00.000Z` : null,
      acceptedAt: latestFiling.acceptanceDateTime ?? null,
      secUrl,
      meta: {
        source: "SEC EDGAR",
        run_id: message.run_id
      }
    });

    const headline = buildSecHeadline({
      accession: latestFiling.accession,
      company: companyName,
      form_type: latestFiling.formType,
      sec_url: secUrl
    });

    const item = await upsertContentItem(client, {
      itemType: "sec_filing",
      eventTime: new Date().toISOString(),
      headline,
      summary: "Filed recently. Open SEC.gov for the official document.",
      externalUrl: secUrl,
      sourceId: source.sourceId,
      licenseId,
      isBreaking: true,
      region: "US",
      meta: {
        accession: latestFiling.accession,
        cik,
        form_type: latestFiling.formType,
        run_id: message.run_id
      },
      dedupeKey: `sec:${latestFiling.accession}`
    });

    await linkItemEntity(client, item.itemId, "sec", "regulator");
    if (cik === "0001045810") {
      await linkItemEntity(client, item.itemId, "nvidia", "issuer");
    }
    return true;
  });

  return result ?? false;
}

async function ingestBls(client: DbClient, runId: string): Promise<boolean> {
  const source = await resolveSourceContext(client, "BLS");
  if (!source) {
    return false;
  }
  const licenseId = await resolveLicenseId(client, "BLS_PUBLIC", source.defaultLicenseId);

  const currentYear = new Date().getUTCFullYear();
  const startYear = currentYear - 2;
  const endYear = currentYear;

  const cpiPayload = (await fetchJson(
    `https://api.bls.gov/publicAPI/v2/timeseries/data/CUSR0000SA0?startyear=${startYear}&endyear=${endYear}`
  )) as Record<string, unknown>;
  const cpiRowsRaw = (((cpiPayload.Results as Record<string, unknown> | undefined)?.series as Record<string, unknown>[] | undefined)?.[0]
    ?.data ?? []) as Record<string, unknown>[];
  const cpiLevels = parseBlsMonthlyRows(cpiRowsRaw);

  const cpiYoy = computeYearOverYear(cpiLevels).slice(-24);
  if (cpiYoy.length > 0) {
    const seriesId = await upsertSeries(client, {
      sourceId: source.sourceId,
      seriesCode: "US_CPI_YOY",
      title: "US CPI YoY",
      geo: "US",
      frequency: "monthly",
      units: "%",
      isDerived: true,
      derivation: { method: "yoy_from_bls_cpi_raw" },
      licenseId,
      originUrl: "https://www.bls.gov/developers/",
      rawLocked: false
    });

    for (const row of cpiYoy) {
      await upsertSeriesObservation(client, seriesId, {
        obsDate: row.obsDate,
        valueRaw: row.valueRaw,
        valueNum: row.valueNum
      });
    }
  }

  const unemploymentPayload = (await fetchJson(
    `https://api.bls.gov/publicAPI/v2/timeseries/data/LNS14000000?startyear=${startYear}&endyear=${endYear}`
  )) as Record<string, unknown>;
  const unemploymentSeries = (unemploymentPayload.Results as { series?: Record<string, unknown>[] } | undefined)?.series ?? [];
  const unemploymentRaw = (unemploymentSeries[0]?.data as Record<string, unknown>[] | undefined) ?? [];
  const unemploymentRows = parseBlsMonthlyRows(unemploymentRaw).slice(-24);

  if (unemploymentRows.length > 0) {
    const unemploymentSeriesId = await upsertSeries(client, {
      sourceId: source.sourceId,
      seriesCode: "US_UNEMPLOYMENT_RATE",
      title: "US Unemployment Rate",
      geo: "US",
      frequency: "monthly",
      units: "%",
      isDerived: false,
      derivation: null,
      licenseId,
      originUrl: "https://www.bls.gov/developers/",
      rawLocked: false
    });

    for (const row of unemploymentRows) {
      await upsertSeriesObservation(client, unemploymentSeriesId, {
        obsDate: row.obsDate,
        valueRaw: row.valueRaw,
        valueNum: row.valueNum
      });
    }
  }

  const payrollPayload = (await fetchJson(
    `https://api.bls.gov/publicAPI/v2/timeseries/data/CES0000000001?startyear=${startYear}&endyear=${endYear}`
  )) as Record<string, unknown>;
  const payrollSeries = (payrollPayload.Results as { series?: Record<string, unknown>[] } | undefined)?.series ?? [];
  const payrollRaw = (payrollSeries[0]?.data as Record<string, unknown>[] | undefined) ?? [];
  const payrollRows = parseBlsMonthlyRows(payrollRaw).slice(-24);
  if (payrollRows.length > 0) {
    const payrollSeriesId = await upsertSeries(client, {
      sourceId: source.sourceId,
      seriesCode: "US_NONFARM_PAYROLLS",
      title: "US Nonfarm Payrolls",
      geo: "US",
      frequency: "monthly",
      units: "thousand persons",
      isDerived: false,
      derivation: null,
      licenseId,
      originUrl: "https://www.bls.gov/developers/",
      rawLocked: false
    });
    for (const row of payrollRows) {
      await upsertSeriesObservation(client, payrollSeriesId, {
        obsDate: row.obsDate,
        valueRaw: row.valueRaw,
        valueNum: row.valueNum
      });
    }
  }

  const earningsPayload = (await fetchJson(
    `https://api.bls.gov/publicAPI/v2/timeseries/data/CES0500000003?startyear=${startYear}&endyear=${endYear}`
  )) as Record<string, unknown>;
  const earningsSeries = (earningsPayload.Results as { series?: Record<string, unknown>[] } | undefined)?.series ?? [];
  const earningsRaw = (earningsSeries[0]?.data as Record<string, unknown>[] | undefined) ?? [];
  const earningsRows = parseBlsMonthlyRows(earningsRaw).slice(-24);
  if (earningsRows.length > 0) {
    const earningsSeriesId = await upsertSeries(client, {
      sourceId: source.sourceId,
      seriesCode: "US_AVG_HOURLY_EARNINGS",
      title: "US Avg Hourly Earnings",
      geo: "US",
      frequency: "monthly",
      units: "USD/hour",
      isDerived: false,
      derivation: null,
      licenseId,
      originUrl: "https://www.bls.gov/developers/",
      rawLocked: false
    });
    for (const row of earningsRows) {
      await upsertSeriesObservation(client, earningsSeriesId, {
        obsDate: row.obsDate,
        valueRaw: row.valueRaw,
        valueNum: row.valueNum
      });
    }
  }

  const latestCpi = latest(cpiYoy);
  const latestUnemployment = latest(unemploymentRows);
  const latestPayroll = latest(payrollRows);
  const latestEarnings = latest(earningsRows);
  if (latestCpi || latestUnemployment || latestPayroll || latestEarnings) {
    const periods = [latestCpi?.obsDate, latestUnemployment?.obsDate, latestPayroll?.obsDate, latestEarnings?.obsDate].filter(
      (value): value is string => Boolean(value)
    );
    periods.sort((left, right) => left.localeCompare(right));
    const period = periods[periods.length - 1] ?? new Date().toISOString().slice(0, 10);
    await upsertContentItem(client, {
      itemType: "macro_update",
      eventTime: new Date().toISOString(),
      headline: "BLS CPI, labor, and wage indicators refreshed",
      summary: `CPI YoY ${latestCpi?.valueNum ?? "n/a"}% · Unemployment ${latestUnemployment?.valueNum ?? "n/a"}% · Payrolls ${
        latestPayroll?.valueNum ?? "n/a"
      }k · AHE ${latestEarnings?.valueNum ?? "n/a"}`,
      externalUrl: "https://www.bls.gov/developers/",
      sourceId: source.sourceId,
      licenseId,
      isBreaking: true,
      region: "US",
      meta: {
        series: ["US_CPI_YOY", "US_UNEMPLOYMENT_RATE", "US_NONFARM_PAYROLLS", "US_AVG_HOURLY_EARNINGS"],
        run_id: runId
      },
      dedupeKey: `macro:bls:${period}`
    });
  }

  return true;
}

async function ingestEia(client: DbClient, runId: string, env: Env): Promise<boolean> {
  const source = await resolveSourceContext(client, "EIA");
  if (!source) {
    return false;
  }
  const licenseId = await resolveLicenseId(client, "EIA_PUBLIC", source.defaultLicenseId);

  const apiKey = env.EIA_API_KEY?.trim() || "DEMO_KEY";
  const url =
    "https://api.eia.gov/v2/petroleum/stoc/wstk/data/?" +
    "frequency=weekly&data[0]=value&facets[duoarea][]=NUS&facets[product][]=EPC0&facets[process][]=SAX" +
    "&sort[0][column]=period&sort[0][direction]=desc&length=26&api_key=" +
    encodeURIComponent(apiKey);
  const payload = (await fetchJson(url)) as Record<string, unknown>;
  const data = ((((payload.response as Record<string, unknown> | undefined)?.data as
    | Record<string, unknown>[]
    | undefined) ?? []) as Record<string, unknown>[])
    .map((row) => {
      const period = typeof row.period === "string" ? row.period : null;
      const value = safeNumber(row.value);
      if (!period || value === null) {
        return null;
      }
      return {
        obsDate: period,
        valueNum: value,
        valueRaw: String(value)
      } as NumPoint;
    })
    .filter((row): row is NumPoint => row !== null);

  const rows = sortByObsDate(data).slice(-26);
  if (rows.length === 0) {
    return true;
  }

  const seriesId = await upsertSeries(client, {
    sourceId: source.sourceId,
    seriesCode: "US_EIA_CRUDE_STOCKS",
    title: "US Crude Stocks",
    geo: "US",
    frequency: "weekly",
    units: "MBBL",
    isDerived: false,
    derivation: null,
    licenseId,
    originUrl: "https://www.eia.gov/opendata/",
    rawLocked: false
  });

  for (const row of rows) {
    await upsertSeriesObservation(client, seriesId, {
      obsDate: row.obsDate,
      valueRaw: row.valueRaw,
      valueNum: row.valueNum
    });
  }

  const latestRow = latest(rows);
  if (latestRow) {
    await upsertContentItem(client, {
      itemType: "macro_update",
      eventTime: new Date().toISOString(),
      headline: "EIA weekly crude inventory updated",
      summary: `U.S. ending stocks excluding SPR: ${latestRow.valueNum} MBBL`,
      externalUrl: "https://www.eia.gov/opendata/",
      sourceId: source.sourceId,
      licenseId,
      isBreaking: false,
      region: "US",
      meta: {
        series: "US_EIA_CRUDE_STOCKS",
        run_id: runId
      },
      dedupeKey: `macro:eia:${latestRow.obsDate}`
    });
  }

  return true;
}

async function ingestEcb(client: DbClient, runId: string): Promise<boolean> {
  const source = await resolveSourceContext(client, "ECB");
  if (!source) {
    return false;
  }
  const licenseId = await resolveLicenseId(client, "ECB_STATS", source.defaultLicenseId);

  const startPeriod = `${new Date().getUTCFullYear() - 3}-01`;
  const csv = await fetchText(
    `https://data-api.ecb.europa.eu/service/data/ICP/M.U2.N.000000.4.INX?format=csvdata&detail=dataonly&startPeriod=${startPeriod}`
  );
  const rows = parseCsv(csv).slice(1);
  const rawPoints = sortByObsDate(
    rows
      .map((columns) => {
        if (columns.length < 9) {
          return null;
        }
        const period = columns[7] ?? "";
        const valueRaw = columns[8] ?? "";
        const obsDate = monthStartFromYearMonth(period);
        const value = safeNumber(valueRaw);
        if (!obsDate || value === null) {
          return null;
        }
        return {
          obsDate,
          valueNum: value,
          valueRaw
        } as NumPoint;
      })
      .filter((point): point is NumPoint => point !== null)
      .slice(-48)
  );

  if (rawPoints.length === 0) {
    return true;
  }

  const rawSeriesId = await upsertSeries(client, {
    sourceId: source.sourceId,
    seriesCode: "EU_HICP_RAW",
    title: "EU HICP Raw",
    geo: "EU",
    frequency: "monthly",
    units: "index",
    isDerived: false,
    derivation: null,
    licenseId,
    originUrl: "https://www.ecb.europa.eu/stats/",
    rawLocked: true
  });

  let blockedRevisionCount = 0;
  for (const point of rawPoints) {
    const previousRaw = await getExistingObservationRaw(client, rawSeriesId, point.obsDate);
    if (previousRaw !== null) {
      try {
        await validateEcbRawUnchanged(previousRaw, point.valueRaw);
      } catch {
        blockedRevisionCount += 1;
        continue;
      }
    }
    await upsertSeriesObservation(client, rawSeriesId, {
      obsDate: point.obsDate,
      valueRaw: point.valueRaw,
      valueNum: point.valueNum,
      sourceHash: await sha256Hex(point.valueRaw)
    });
  }

  if (blockedRevisionCount > 0) {
    return true;
  }

  const derivedPoints = computeYearOverYear(rawPoints).slice(-24);
  if (derivedPoints.length > 0) {
    const derivedSeriesId = await upsertSeries(client, {
      sourceId: source.sourceId,
      seriesCode: "EU_HICP_YOY",
      title: "EU HICP YoY",
      geo: "EU",
      frequency: "monthly",
      units: "%",
      isDerived: true,
      derivation: { method: "yoy_from_raw" },
      licenseId,
      originUrl: "https://www.ecb.europa.eu/stats/",
      rawLocked: false
    });

    for (const point of derivedPoints) {
      await upsertSeriesObservation(client, derivedSeriesId, {
        obsDate: point.obsDate,
        valueRaw: point.valueRaw,
        valueNum: point.valueNum
      });
    }

    const latestDerived = latest(derivedPoints);
    if (latestDerived) {
      await upsertContentItem(client, {
        itemType: "macro_update",
        eventTime: new Date().toISOString(),
        headline: "Euro area HICP YoY updated",
        summary: `Derived from ECB raw index: ${latestDerived.valueNum}%`,
        externalUrl: "https://www.ecb.europa.eu/stats/",
        sourceId: source.sourceId,
        licenseId,
        isBreaking: false,
        region: "EU",
        meta: {
          series: "EU_HICP_YOY",
          raw_locked: true,
          run_id: runId
        },
        dedupeKey: `macro:ecb:${latestDerived.obsDate}`
      });
    }
  }

  return true;
}

async function ingestFrb(client: DbClient, runId: string): Promise<boolean> {
  const source = await resolveSourceContext(client, "Federal Reserve Board");
  if (!source) {
    return false;
  }
  const licenseId = await resolveLicenseId(client, "FRB_PUBLIC", source.defaultLicenseId);

  const html = await fetchText("https://www.federalreserve.gov/releases/h15/");
  const headerRegex = /<th id="col(\d+)" class="colhead">(\d{4})<br>([A-Za-z]{3})<br>(\d{1,2})<\/th>/g;
  const headers = new Map<string, string>();
  const monthMap: Record<string, number> = {
    Jan: 1,
    Feb: 2,
    Mar: 3,
    Apr: 4,
    May: 5,
    Jun: 6,
    Jul: 7,
    Aug: 8,
    Sep: 9,
    Oct: 10,
    Nov: 11,
    Dec: 12
  };
  let headerMatch = headerRegex.exec(html);
  while (headerMatch) {
    const colId = headerMatch[1] ?? "";
    const year = Number(headerMatch[2] ?? "");
    const monthAbbr = headerMatch[3] ?? "";
    const day = Number(headerMatch[4] ?? "");
    const month = monthMap[monthAbbr];
    if (month) {
      headers.set(colId, `${year}-${pad2(month)}-${pad2(day)}`);
    }
    headerMatch = headerRegex.exec(html);
  }

  const fedFundsRows = extractFrbRowPoints(html.match(/Federal funds \(effective\)[\s\S]*?<\/tr>/i)?.[0] ?? null, headers);
  const treasuryRows = extractFrbRowPoints(html.match(/<th[^>]*>\s*10-year\s*<\/th>[\s\S]*?<\/tr>/i)?.[0] ?? null, headers);
  if (fedFundsRows.length === 0 && treasuryRows.length === 0) {
    return true;
  }

  let latestFedFunds: NumPoint | null = null;
  if (fedFundsRows.length > 0) {
    const fedFundsSeriesId = await upsertSeries(client, {
      sourceId: source.sourceId,
      seriesCode: "US_FEDFUNDS",
      title: "US Effective Fed Funds",
      geo: "US",
      frequency: "daily",
      units: "%",
      isDerived: false,
      derivation: null,
      licenseId,
      originUrl: "https://www.federalreserve.gov/releases/h15/",
      rawLocked: false
    });
    for (const row of fedFundsRows) {
      await upsertSeriesObservation(client, fedFundsSeriesId, {
        obsDate: row.obsDate,
        valueRaw: row.valueRaw,
        valueNum: row.valueNum
      });
    }
    latestFedFunds = latest(fedFundsRows);
  }

  let latestTenYear: NumPoint | null = null;
  if (treasuryRows.length > 0) {
    const treasurySeriesId = await upsertSeries(client, {
      sourceId: source.sourceId,
      seriesCode: "US_TREASURY_10Y",
      title: "US 10Y Treasury Yield",
      geo: "US",
      frequency: "daily",
      units: "%",
      isDerived: false,
      derivation: null,
      licenseId,
      originUrl: "https://www.federalreserve.gov/releases/h15/",
      rawLocked: false
    });
    for (const row of treasuryRows) {
      await upsertSeriesObservation(client, treasurySeriesId, {
        obsDate: row.obsDate,
        valueRaw: row.valueRaw,
        valueNum: row.valueNum
      });
    }
    latestTenYear = latest(treasuryRows);
  }

  if (latestFedFunds || latestTenYear) {
    const periodCandidates = [latestFedFunds?.obsDate, latestTenYear?.obsDate].filter((value): value is string => Boolean(value));
    periodCandidates.sort((left, right) => left.localeCompare(right));
    const period = periodCandidates[periodCandidates.length - 1] ?? new Date().toISOString().slice(0, 10);
    await upsertContentItem(client, {
      itemType: "fact_flash",
      eventTime: new Date().toISOString(),
      headline: "Federal Reserve Board rates snapshot updated",
      summary: `Fed funds ${latestFedFunds?.valueNum ?? "n/a"}% · US 10Y ${latestTenYear?.valueNum ?? "n/a"}%`,
      externalUrl: "https://www.federalreserve.gov/releases/h15/",
      sourceId: source.sourceId,
      licenseId,
      isBreaking: true,
      region: "US",
      meta: {
        series: ["US_FEDFUNDS", "US_TREASURY_10Y"],
        run_id: runId
      },
      dedupeKey: `macro:frb:${period}`
    });
  }

  return true;
}

async function ingestBea(client: DbClient, runId: string, env: Env): Promise<boolean> {
  const source = await resolveSourceContext(client, "BEA");
  if (!source) {
    return false;
  }
  const licenseId = await resolveLicenseId(client, "BEA_PUBLIC", source.defaultLicenseId);
  const apiKey = env.BEA_API_KEY?.trim() || "sample";

  const currentYear = new Date().getUTCFullYear();
  const years = [currentYear - 2, currentYear - 1, currentYear].join(",");
  const url =
    "https://apps.bea.gov/api/data/?" +
    `UserID=${encodeURIComponent(apiKey)}&datasetname=NIPA&TableName=T10101&Frequency=Q&Year=${encodeURIComponent(years)}&ResultFormat=JSON`;
  const payload = (await fetchJson(url)) as Record<string, unknown>;
  const dataRows =
    ((payload.BEAAPI as { Results?: { Data?: Record<string, unknown>[] } } | undefined)?.Results?.Data ?? []) as Record<
      string,
      unknown
    >[];

  const gdpLevels = sortByObsDate(
    dataRows
      .map((row) => {
        const lineNumber = String(row.LineNumber ?? "");
        const period = typeof row.TimePeriod === "string" ? row.TimePeriod : "";
        const value = safeNumber(row.DataValue);
        if (lineNumber !== "1" || !period || value === null) {
          return null;
        }
        const obsDate = parseQuarterStart(period);
        if (!obsDate) {
          return null;
        }
        return {
          obsDate,
          valueNum: value,
          valueRaw: String(value)
        } as NumPoint;
      })
      .filter((row): row is NumPoint => row !== null)
      .slice(-20)
  );

  if (gdpLevels.length < 2) {
    return true;
  }

  const qoq: NumPoint[] = [];
  for (let index = 1; index < gdpLevels.length; index += 1) {
    const current = gdpLevels[index];
    const prev = gdpLevels[index - 1];
    if (!current || !prev) {
      continue;
    }
    if (Math.abs(prev.valueNum) < 0.000001) {
      continue;
    }
    const value = round1(((current.valueNum - prev.valueNum) / Math.abs(prev.valueNum)) * 100);
    qoq.push({
      obsDate: current.obsDate,
      valueNum: value,
      valueRaw: String(value)
    });
  }

  if (qoq.length === 0) {
    return true;
  }

  const seriesId = await upsertSeries(client, {
    sourceId: source.sourceId,
    seriesCode: "US_GDP_QOQ",
    title: "US GDP QoQ",
    geo: "US",
    frequency: "quarterly",
    units: "%",
    isDerived: true,
    derivation: { method: "qoq_from_bea_levels" },
    licenseId,
    originUrl: "https://apps.bea.gov/API/docs/index.htm",
    rawLocked: false
  });

  for (const row of qoq) {
    await upsertSeriesObservation(client, seriesId, {
      obsDate: row.obsDate,
      valueRaw: row.valueRaw,
      valueNum: row.valueNum
    });
  }

  const latestRow = latest(qoq);
  if (latestRow) {
    await upsertContentItem(client, {
      itemType: "macro_update",
      eventTime: new Date().toISOString(),
      headline: "BEA GDP estimate refreshed",
      summary: `Quarter-over-quarter GDP change: ${latestRow.valueNum}%`,
      externalUrl: "https://apps.bea.gov/API/docs/index.htm",
      sourceId: source.sourceId,
      licenseId,
      isBreaking: true,
      region: "US",
      meta: {
        series: "US_GDP_QOQ",
        run_id: runId
      },
      dedupeKey: `macro:bea:${latestRow.obsDate}`
    });
  }

  return true;
}

async function ingestEurostatConditional(client: DbClient, runId: string): Promise<boolean> {
  const source = await resolveSourceContext(client, "Eurostat");
  const conditionalLicense = await resolveLicenseContext(client, "EUROSTAT_CONDITIONAL");
  if (!source || !conditionalLicense) {
    return false;
  }

  const payload = (await fetchJson(
    "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/une_rt_m?geo=EA20&sex=T&age=TOTAL&unit=PC_ACT&s_adj=SA"
  )) as Record<string, unknown>;

  const dimension = payload.dimension as Record<string, unknown> | undefined;
  const time = (dimension?.time as Record<string, unknown> | undefined)?.category as Record<string, unknown> | undefined;
  const timeIndex = (time?.index as Record<string, unknown> | undefined) ?? {};
  const valueMap = (payload.value as Record<string, unknown> | undefined) ?? {};

  const points = Object.entries(timeIndex)
    .map(([period, key]) => {
      const obsDate = monthStartFromYearMonth(period);
      const value = safeNumber(valueMap[String(key)]);
      if (!obsDate || value === null) {
        return null;
      }
      return { obsDate, valueNum: value, valueRaw: String(value), value, geo: "EA" };
    })
    .filter((point): point is NumPoint & { geo: string; value: number } => point !== null);

  const filtered = applyEurostatFilter(points).map((row) => ({
    obsDate: row.obsDate,
    valueNum: row.valueNum,
    valueRaw: row.valueRaw
  }));

  if (filtered.length === 0) {
    return true;
  }

  const seriesId = await upsertSeries(client, {
    sourceId: source.sourceId,
    seriesCode: "EU_UNEMPLOYMENT",
    title: "EU Unemployment",
    geo: "EA",
    frequency: "monthly",
    units: "%",
    isDerived: false,
    derivation: null,
    licenseId: conditionalLicense.licenseId,
    originUrl: "https://ec.europa.eu/eurostat",
    rawLocked: false
  });

  for (const point of filtered.slice(-24)) {
    await upsertSeriesObservation(client, seriesId, {
      obsDate: point.obsDate,
      valueRaw: point.valueRaw,
      valueNum: point.valueNum
    });
  }

  const blocked = shouldBlockDatasetForProduction({
    restriction_notes: "Conditional Eurostat dataset requires policy review."
  });
  const latestPoint = latest(filtered);
  if (latestPoint) {
    await upsertContentItem(client, {
      itemType: blocked ? "analysis" : "macro_update",
      eventTime: new Date().toISOString(),
      headline: blocked ? "Eurostat unemployment dataset queued for policy clearance" : "Eurostat unemployment updated",
      summary: blocked
        ? "Dataset remains in compliance hold until conditional-license review is completed."
        : `EA unemployment: ${latestPoint.valueNum}%`,
      externalUrl: "https://ec.europa.eu/eurostat",
      sourceId: source.sourceId,
      licenseId: conditionalLicense.licenseId,
      isBreaking: false,
      region: "EU",
      meta: {
        series: "EU_UNEMPLOYMENT",
        status: blocked ? "quarantine" : "allowed",
        run_id: runId
      },
      dedupeKey: `macro:eurostat:${latestPoint.obsDate}`
    });
  }

  return true;
}

async function ingestOecdConditional(client: DbClient, runId: string, env: Env): Promise<boolean> {
  const source = await resolveSourceContext(client, "OECD");
  const conditionalLicense = await resolveLicenseContext(client, "OECD_CONDITIONAL");
  if (!source || !conditionalLicense) {
    return false;
  }

  const oecdHeaders: HeadersInit = {
    accept: "text/csv,application/vnd.sdmx.data+csv",
    "user-agent": env.SEC_USER_AGENT ?? "Open Finance Pulse contact@financeaxiom.com"
  };

  let points: NumPoint[] = [];
  try {
    let csv: string;
    try {
      csv = await fetchText(
        "https://sdmx.oecd.org/public/rest/data/OECD.SDD.TPS,DSD_LFS@DF_IALFS_UNE_M,1.0/EA20.UNE_LF_M.PT_LF_SUB._Z.N._T.Y_GE15._Z.M?startPeriod=2024-01&format=csvfile",
        { headers: oecdHeaders }
      );
    } catch {
      csv = await fetchText(
        "https://sdmx.oecd.org/public/rest/data/OECD.SDD.TPS,DSD_LFS@DF_IALFS_UNE_M,1.0/all?lastNObservations=24&format=csvfile",
        { headers: oecdHeaders }
      );
    }
    const rows = parseCsv(csv).slice(1);
    points = sortByObsDate(
      rows
        .map((columns) => {
          if (columns.length < 12) {
            return null;
          }
          const area = columns[1] ?? "";
          const measure = columns[2] ?? "";
          const unit = columns[3] ?? "";
          const adjustment = columns[5] ?? "";
          const sex = columns[6] ?? "";
          const age = columns[7] ?? "";
          const activity = columns[8] ?? "";
          const frequency = columns[9] ?? "";
          if (
            area !== "EA20" ||
            measure !== "UNE_LF_M" ||
            unit !== "PT_LF_SUB" ||
            adjustment !== "N" ||
            sex !== "_T" ||
            age !== "Y_GE15" ||
            activity !== "_Z" ||
            frequency !== "M"
          ) {
            return null;
          }
          const period = columns[10] ?? "";
          const valueRaw = columns[11] ?? "";
          const obsDate = monthStartFromYearMonth(period);
          const value = safeNumber(valueRaw);
          if (!obsDate || value === null) {
            return null;
          }
          return {
            obsDate,
            valueNum: value,
            valueRaw
          } as NumPoint;
        })
        .filter((point): point is NumPoint => point !== null)
        .slice(-24)
    );
  } catch {
    await upsertContentItem(client, {
      itemType: "analysis",
      eventTime: new Date().toISOString(),
      headline: "OECD labor dataset queued for policy clearance",
      summary: "OECD endpoint unavailable from current runtime; metadata-only compliance hold remains active.",
      externalUrl: "https://www.oecd.org/",
      sourceId: source.sourceId,
      licenseId: conditionalLicense.licenseId,
      isBreaking: false,
      region: "GLOBAL",
      meta: {
        status: "quarantine",
        reason: "endpoint_unavailable",
        run_id: runId
      },
      dedupeKey: `macro:oecd:hold:${new Date().toISOString().slice(0, 10)}`
    });
    return true;
  }

  if (points.length === 0) {
    return true;
  }

  const seriesId = await upsertSeries(client, {
    sourceId: source.sourceId,
    seriesCode: "OECD_EA20_UNEMPLOYMENT",
    title: "OECD EA20 Unemployment",
    geo: "EA",
    frequency: "monthly",
    units: "%",
    isDerived: false,
    derivation: null,
    licenseId: conditionalLicense.licenseId,
    originUrl: "https://sdmx.oecd.org/",
    rawLocked: false
  });
  for (const point of points) {
    await upsertSeriesObservation(client, seriesId, {
      obsDate: point.obsDate,
      valueRaw: point.valueRaw,
      valueNum: point.valueNum
    });
  }

  const blocked = shouldBlockDatasetForProduction({
    unclear_license: true
  });
  const latestPoint = latest(points);
  if (latestPoint) {
    await upsertContentItem(client, {
      itemType: blocked ? "analysis" : "macro_update",
      eventTime: new Date().toISOString(),
      headline: blocked ? "OECD labor dataset queued for policy clearance" : "OECD labor indicator updated",
      summary: blocked
        ? "OECD dataset is retained as metadata-only pending rights validation."
        : `EA20 unemployment: ${latestPoint.valueNum}%`,
      externalUrl: "https://www.oecd.org/",
      sourceId: source.sourceId,
      licenseId: conditionalLicense.licenseId,
      isBreaking: false,
      region: "GLOBAL",
      meta: {
        series: "OECD_EA20_UNEMPLOYMENT",
        status: blocked ? "quarantine" : "allowed",
        run_id: runId
      },
      dedupeKey: `macro:oecd:${latestPoint.obsDate}`
    });
  }
  return true;
}

async function ingestWorldBankConditional(client: DbClient, runId: string): Promise<boolean> {
  const source = await resolveSourceContext(client, "World Bank");
  const conditionalLicense = await resolveLicenseContext(client, "WORLD_BANK_CONDITIONAL");
  if (!source || !conditionalLicense) {
    return false;
  }

  const payload = (await fetchJson(
    "https://api.worldbank.org/v2/country/WLD/indicator/NY.GDP.MKTP.CD?format=json&per_page=30"
  )) as unknown[];
  const rows = Array.isArray(payload) && Array.isArray(payload[1]) ? (payload[1] as Record<string, unknown>[]) : [];
  const points = sortByObsDate(
    rows
      .map((row) => {
        const year = typeof row.date === "string" ? row.date : "";
        const value = safeNumber(row.value);
        if (!/^\d{4}$/.test(year) || value === null) {
          return null;
        }
        return {
          obsDate: `${year}-01-01`,
          valueNum: value,
          valueRaw: String(value)
        } as NumPoint;
      })
      .filter((row): row is NumPoint => row !== null)
      .slice(-20)
  );

  if (points.length === 0) {
    return true;
  }

  const seriesId = await upsertSeries(client, {
    sourceId: source.sourceId,
    seriesCode: "WB_GLOBAL_GDP_USD",
    title: "World Bank Global GDP (Current USD)",
    geo: "GLOBAL",
    frequency: "annual",
    units: "USD",
    isDerived: false,
    derivation: null,
    licenseId: conditionalLicense.licenseId,
    originUrl: "https://datacatalog.worldbank.org/",
    rawLocked: false
  });
  for (const point of points) {
    await upsertSeriesObservation(client, seriesId, {
      obsDate: point.obsDate,
      valueRaw: point.valueRaw,
      valueNum: point.valueNum
    });
  }

  const blocked = shouldBlockDatasetForProduction({
    unclear_license: true
  });
  const latestPoint = latest(points);
  if (latestPoint) {
    await upsertContentItem(client, {
      itemType: blocked ? "analysis" : "macro_update",
      eventTime: new Date().toISOString(),
      headline: blocked ? "World Bank GDP dataset queued for license review" : "World Bank GDP indicator updated",
      summary: blocked
        ? "Dataset remains in compliance hold until conditional license checks pass."
        : `Global GDP latest point: ${latestPoint.valueNum}`,
      externalUrl: "https://datacatalog.worldbank.org/",
      sourceId: source.sourceId,
      licenseId: conditionalLicense.licenseId,
      isBreaking: false,
      region: "GLOBAL",
      meta: {
        series: "WB_GLOBAL_GDP_USD",
        status: blocked ? "quarantine" : "allowed",
        run_id: runId
      },
      dedupeKey: `macro:wb:${latestPoint.obsDate}`
    });
  }
  return true;
}

export async function ingestMacroToDb(message: IngestQueueMessage, env: Env): Promise<boolean> {
  const result = await withIngestDb(env, async (client) => {
    let successCount = 0;

    const run = async (label: string, fn: () => Promise<boolean>): Promise<void> => {
      try {
        const ok = await fn();
        if (ok) {
          successCount += 1;
        }
      } catch (error) {
        console.error("macro_ingest_step_failed", label, error);
      }
    };

    await run("BLS", () => ingestBls(client, message.run_id));
    await run("EIA", () => ingestEia(client, message.run_id, env));
    await run("ECB", () => ingestEcb(client, message.run_id));
    await run("FRB", () => ingestFrb(client, message.run_id));
    await run("BEA", () => ingestBea(client, message.run_id, env));
    await run("EUROSTAT", () => ingestEurostatConditional(client, message.run_id));
    await run("OECD", () => ingestOecdConditional(client, message.run_id, env));
    await run("WORLD_BANK", () => ingestWorldBankConditional(client, message.run_id));

    return successCount > 0;
  });

  return result ?? false;
}
