import { hasDatabase } from "../services/db";
import { allowMemoryReadFallback } from "../services/fallbackPolicy";
import { normalizeHttpUrl } from "../services/links";
import { queryFiling } from "../services/postgres";
import { MemoryStore } from "../services/store";
import { parsePathParam, secAccession } from "./schemas";
import { HttpError, okJson } from "./utils";
import type { Env } from "../types";

const FILING_NOTE = "SEC metadata only. Filing text is available on SEC.gov.";
const SEC_HOME = "https://www.sec.gov/";

export async function handleFiling(request: Request, env: Env, rawAccession: string): Promise<Response> {
  const accession = parsePathParam(secAccession, rawAccession);
  if (!accession) {
    throw new HttpError(400, "Invalid SEC accession number.");
  }

  if (hasDatabase(env)) {
    const filing = await queryFiling(env, accession);
    if (!filing) {
      throw new HttpError(404, "Filing not found.");
    }
    return okJson(request, env, { ...filing, sec_url: normalizeHttpUrl(filing.sec_url) ?? SEC_HOME, note: FILING_NOTE });
  }

  if (!allowMemoryReadFallback(env)) {
    throw new HttpError(503, "Persistent filing store is unavailable.");
  }

  const filing = MemoryStore.get().getFiling(accession);
  if (!filing) {
    throw new HttpError(404, "Filing not found.");
  }
  return okJson(request, env, {
    accession: filing.accession,
    cik: filing.cik,
    company_name: filing.company_name,
    form_type: filing.form_type,
    filed_at: filing.filed_at,
    accepted_at: filing.accepted_at,
    sec_url: normalizeHttpUrl(filing.sec_url) ?? SEC_HOME,
    source: { name: "SEC EDGAR", policy_url: "https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data" },
    license: {
      code: "SEC_EDGAR",
      commercial_status: "allowed",
      attribution_text: "Source: SEC EDGAR (official).",
      disclaimer_text: "Open SEC.gov for official filing text."
    },
    note: FILING_NOTE
  });
}
