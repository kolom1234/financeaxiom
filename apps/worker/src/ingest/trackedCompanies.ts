/**
 * Companies tracked by the GDELT index signal. CIKs verified against
 * https://www.sec.gov/files/company_tickers.json.
 * `secFilings` controls which issuers are polled on SEC EDGAR.
 */
export interface TrackedCompany {
  entity: string;
  slug: string;
  ticker: string;
  cik: string;
  secFilings: boolean;
}

export const TRACKED_COMPANIES: ReadonlyArray<TrackedCompany> = [
  { entity: "Microsoft", slug: "microsoft", ticker: "MSFT", cik: "0000789019", secFilings: false },
  { entity: "Apple", slug: "apple", ticker: "AAPL", cik: "0000320193", secFilings: false },
  { entity: "NVIDIA", slug: "nvidia", ticker: "NVDA", cik: "0001045810", secFilings: true },
  { entity: "Amazon", slug: "amazon", ticker: "AMZN", cik: "0001018724", secFilings: false },
  { entity: "Alphabet", slug: "alphabet", ticker: "GOOGL", cik: "0001652044", secFilings: false },
  { entity: "Meta", slug: "meta", ticker: "META", cik: "0001326801", secFilings: false },
  { entity: "Broadcom", slug: "broadcom", ticker: "AVGO", cik: "0001730168", secFilings: false },
  { entity: "Tesla", slug: "tesla", ticker: "TSLA", cik: "0001318605", secFilings: false },
  { entity: "Costco", slug: "costco", ticker: "COST", cik: "0000909832", secFilings: false },
  { entity: "Netflix", slug: "netflix", ticker: "NFLX", cik: "0001065280", secFilings: false }
];
