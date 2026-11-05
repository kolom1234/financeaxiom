import { assertSecUserAgentConfigured, acquireSecPermit } from "../../services/sec";
import { linkItemEntity, linkItemEntityByCik, upsertEntity, upsertFiling } from "../../services/ingestDb";
import { fetchJson } from "../http";
import { normalizeCik } from "../parse";
import { licenseIdFor, persistContentItem, requireSource } from "../persist";
import { buildSecHeadline } from "../sec";
import { TRACKED_COMPANIES } from "../trackedCompanies";
import type { IngestContext, SourceRunResult } from "./types";

/** How many of the most recent filings are reconciled per run. */
export const SEC_RECENT_FILINGS = 20;
/** Filings accepted within this window are flagged as breaking (push-eligible). */
const BREAKING_WINDOW_MS = 48 * 60 * 60 * 1000;

interface SecSubmissions {
  name?: string;
  filings?: {
    recent?: {
      accessionNumber?: string[];
      form?: string[];
      filingDate?: string[];
      acceptanceDateTime?: string[];
      primaryDocument?: string[];
    };
  };
}

export interface SecFiling {
  accession: string;
  formType: string;
  filingDate: string | null;
  acceptedAt: string | null;
  primaryDocument: string | null;
}

export function secArchiveUrl(cik: string, accession: string, primaryDocument?: string | null): string {
  const base = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replace(/-/g, "")}/`;
  return primaryDocument?.trim() ? `${base}${primaryDocument.trim()}` : base;
}

/** The `limit` most recent filings from the submissions "recent" arrays (newest first). */
export function extractRecentFilings(payload: SecSubmissions, limit = SEC_RECENT_FILINGS): SecFiling[] {
  const recent = payload.filings?.recent;
  const accessions = recent?.accessionNumber ?? [];
  const filings: SecFiling[] = [];
  for (let index = 0; index < accessions.length && filings.length < limit; index += 1) {
    const accession = accessions[index];
    if (!accession || !/^\d{10}-\d{2}-\d{6}$/.test(accession)) {
      continue;
    }
    const accepted = recent?.acceptanceDateTime?.[index];
    const acceptedMs = accepted ? Date.parse(accepted) : Number.NaN;
    filings.push({
      accession,
      formType: recent?.form?.[index]?.trim() || "UNKNOWN",
      filingDate: recent?.filingDate?.[index] ?? null,
      acceptedAt: Number.isNaN(acceptedMs) ? null : new Date(acceptedMs).toISOString(),
      primaryDocument: recent?.primaryDocument?.[index] ?? null
    });
  }
  return filings;
}

export async function ingestSec(ctx: IngestContext, cikInput: string): Promise<SourceRunResult> {
  assertSecUserAgentConfigured(ctx.env);
  const source = await requireSource(ctx.client, "SEC EDGAR");
  const licenseId = await licenseIdFor(ctx.client, "SEC_EDGAR", source);
  const cik = normalizeCik(cikInput);

  await acquireSecPermit(ctx.env);
  const submissions = await fetchJson<SecSubmissions>(
    `https://data.sec.gov/submissions/CIK${cik}.json`,
    { headers: { "user-agent": ctx.env.SEC_USER_AGENT!, accept: "application/json" } },
    "sec_submissions"
  );
  const companyName = submissions.name?.trim() || `CIK ${cik}`;
  const tracked = TRACKED_COMPANIES.find((company) => company.cik === cik);
  if (tracked) {
    await upsertEntity(ctx.client, {
      slug: tracked.slug,
      name: tracked.entity,
      entityType: "company",
      primaryTicker: tracked.ticker,
      cik,
      tickers: [tracked.ticker],
      exchanges: ["NASDAQ"]
    });
  }

  let items = 0;
  const now = Date.now();
  for (const filing of extractRecentFilings(submissions)) {
    const secUrl = secArchiveUrl(cik, filing.accession, filing.primaryDocument);
    const eventTime = filing.acceptedAt ?? (filing.filingDate ? `${filing.filingDate}T00:00:00.000Z` : new Date(now).toISOString());
    await upsertFiling(ctx.client, {
      accession: filing.accession,
      cik,
      companyName,
      formType: filing.formType,
      filedAt: filing.filingDate ? `${filing.filingDate}T00:00:00.000Z` : null,
      acceptedAt: filing.acceptedAt,
      secUrl,
      meta: { source: "SEC EDGAR", run_id: ctx.runId }
    });
    const item = await persistContentItem(ctx.client, {
      itemType: "sec_filing",
      eventTime,
      headline: buildSecHeadline({ accession: filing.accession, company: companyName, form_type: filing.formType, sec_url: secUrl }),
      summary: `Accepted by SEC EDGAR${filing.acceptedAt ? ` at ${filing.acceptedAt}` : ""}. Open SEC.gov for the official document.`,
      externalUrl: secUrl,
      sourceId: source.sourceId,
      licenseId,
      isBreaking: now - Date.parse(eventTime) <= BREAKING_WINDOW_MS,
      region: "US",
      meta: { accession: filing.accession, cik, form_type: filing.formType, run_id: ctx.runId },
      dedupeKey: `sec:${filing.accession}`
    });
    await linkItemEntity(ctx.client, item.itemId, "sec", "regulator");
    await linkItemEntityByCik(ctx.client, item.itemId, cik, "issuer");
    items += item.inserted ? 1 : 0;
  }
  return { source: "SEC", status: "ok", items, note: `cik=${cik}` };
}
