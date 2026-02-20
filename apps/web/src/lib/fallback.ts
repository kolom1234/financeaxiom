import type { FeedItemPayload } from "@ofp/shared";

export const fallbackFeed: FeedItemPayload[] = [
  {
    item_id: "itm-gdelt-1",
    item_type: "gdelt_link",
    event_time: "2026-02-16T10:12:00Z",
    headline: "NVIDIA index activity (10-minute): 84 mentions",
    summary: "Detected via index metadata. Open original sources for full coverage.",
    meta: { query: "NVIDIA", mention_count: 84, source_count: 3 },
    external_url: "https://api.gdeltproject.org/api/v2/doc/doc?query=NVIDIA&mode=artlist&format=html&sort=datedesc&maxrecords=5",
    entities: [{ slug: "nvidia", name: "NVIDIA", primary_ticker: "NVDA" }],
    source: { name: "GDELT", policy_url: "https://www.gdeltproject.org/about.html" },
    license: {
      code: "GDELT",
      commercial_status: "allowed",
      attribution_text: "Index data: GDELT (citation + link).",
      disclaimer_text: "Publisher content is not hosted on this site."
    }
  },
  {
    item_id: "itm-gdelt-2",
    item_type: "gdelt_link",
    event_time: "2026-02-16T09:44:00Z",
    headline: "SEC index activity (10-minute): 42 mentions",
    summary: "Detected via index metadata trend acceleration in global coverage.",
    meta: { query: "SEC", mention_count: 42, source_count: 2 },
    external_url: "https://api.gdeltproject.org/api/v2/doc/doc?query=SEC&mode=artlist&format=html&sort=datedesc&maxrecords=5",
    entities: [
      { slug: "nvidia", name: "NVIDIA", primary_ticker: "NVDA" },
      { slug: "sec", name: "U.S. Securities and Exchange Commission", primary_ticker: null }
    ],
    source: { name: "GDELT", policy_url: "https://www.gdeltproject.org/about.html" },
    license: {
      code: "GDELT",
      commercial_status: "allowed",
      attribution_text: "Index data: GDELT (citation + link).",
      disclaimer_text: "Publisher content is not hosted on this site."
    }
  },
  {
    item_id: "itm-sec-1",
    item_type: "sec_filing",
    event_time: "2026-02-16T09:30:00Z",
    headline: "[Filing] NVIDIA 8-K filed",
    summary: "Filed recently. Open SEC.gov for the official document.",
    external_url: "https://www.sec.gov/",
    entities: [{ slug: "nvidia", name: "NVIDIA", primary_ticker: "NVDA" }],
    source: {
      name: "SEC EDGAR",
      policy_url: "https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data"
    },
    license: {
      code: "SEC_EDGAR",
      commercial_status: "allowed",
      attribution_text: "Source: SEC EDGAR (official).",
      disclaimer_text: "Open SEC.gov for official filing text."
    }
  },
  {
    item_id: "itm-sec-2",
    item_type: "sec_filing",
    event_time: "2026-02-16T08:58:00Z",
    headline: "[Filing] Major issuer 10-Q submitted",
    summary: "Latest filing metadata indexed from EDGAR endpoint.",
    external_url: "https://www.sec.gov/",
    entities: [{ slug: "sec", name: "U.S. Securities and Exchange Commission", primary_ticker: null }],
    source: {
      name: "SEC EDGAR",
      policy_url: "https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data"
    },
    license: {
      code: "SEC_EDGAR",
      commercial_status: "allowed",
      attribution_text: "Source: SEC EDGAR (official).",
      disclaimer_text: "Open SEC.gov for official filing text."
    }
  },
  {
    item_id: "itm-macro-1",
    item_type: "macro_update",
    event_time: "2026-02-16T08:40:00Z",
    headline: "BLS CPI and unemployment indicators refreshed",
    summary: "CPI YoY and labor metrics updated from official BLS releases.",
    external_url: "https://www.bls.gov/developers/",
    entities: [],
    source: { name: "BLS", policy_url: "https://www.bls.gov/developers/" },
    license: {
      code: "BLS_PUBLIC",
      commercial_status: "allowed",
      attribution_text: "Source: BLS.",
      disclaimer_text: "Official source data."
    }
  },
  {
    item_id: "itm-macro-2",
    item_type: "macro_update",
    event_time: "2026-02-16T08:20:00Z",
    headline: "BEA GDP estimate refreshed",
    summary: "Latest GDP growth estimate synchronized from BEA API.",
    external_url: "https://apps.bea.gov/API/docs/index.htm",
    entities: [],
    source: { name: "BEA", policy_url: "https://apps.bea.gov/API/docs/index.htm" },
    license: {
      code: "BEA_PUBLIC",
      commercial_status: "allowed",
      attribution_text: "Source: BEA.",
      disclaimer_text: "Official source data."
    }
  },
  {
    item_id: "itm-macro-3",
    item_type: "macro_update",
    event_time: "2026-02-16T07:54:00Z",
    headline: "EIA weekly crude inventory updated",
    summary: "Weekly U.S. crude stock series updated from EIA endpoint.",
    external_url: "https://www.eia.gov/opendata/",
    entities: [],
    source: { name: "EIA", policy_url: "https://www.eia.gov/opendata/" },
    license: {
      code: "EIA_PUBLIC",
      commercial_status: "allowed",
      attribution_text: "Source: EIA.",
      disclaimer_text: "Official source data."
    }
  },
  {
    item_id: "itm-macro-4",
    item_type: "macro_update",
    event_time: "2026-02-16T07:30:00Z",
    headline: "Federal Reserve Board rates snapshot updated",
    summary: "Fed funds and U.S. 10Y yield synchronized from FRB release tables.",
    external_url: "https://www.federalreserve.gov/datadownload/",
    entities: [],
    source: {
      name: "Federal Reserve Board",
      policy_url: "https://www.federalreserve.gov/datadownload/"
    },
    license: {
      code: "FRB_PUBLIC",
      commercial_status: "allowed",
      attribution_text: "Source: Federal Reserve Board.",
      disclaimer_text: "Official source data."
    }
  },
  {
    item_id: "itm-macro-5",
    item_type: "macro_update",
    event_time: "2026-02-16T07:05:00Z",
    headline: "Euro area HICP YoY updated",
    summary: "Derived YoY value updated from ECB raw series.",
    external_url: "https://www.ecb.europa.eu/stats/",
    entities: [{ slug: "ecb", name: "European Central Bank", primary_ticker: null }],
    source: {
      name: "ECB",
      policy_url: "https://www.ecb.europa.eu/stats/ecb_statistics/governance_and_quality_framework/html/usage_policy.en.html"
    },
    license: {
      code: "ECB_STATS",
      commercial_status: "allowed",
      attribution_text: "Source: ECB statistics.",
      disclaimer_text: "Raw series are unmodified; derived values are separate."
    }
  },
  {
    item_id: "itm-macro-6",
    item_type: "macro_update",
    event_time: "2026-02-16T06:36:00Z",
    headline: "Labor-market snapshot refreshed",
    summary: "Unemployment and participation trend cards recalculated.",
    external_url: "https://www.bls.gov/developers/",
    entities: [],
    source: { name: "BLS", policy_url: "https://www.bls.gov/developers/" },
    license: {
      code: "BLS_PUBLIC",
      commercial_status: "allowed",
      attribution_text: "Source: BLS.",
      disclaimer_text: "Official source data."
    }
  }
];

export const fallbackIndicators = [
  {
    series_id: "US_CPI_YOY",
    title: "US CPI YoY",
    latest_value: 2.7,
    period: "2026-01",
    yoy: 2.7,
    sparkline: [2.5, 2.4, 2.6, 2.8, 2.7, 2.7],
    source: { name: "BLS", policy_url: "https://www.bls.gov/developers/" },
    license: {
      code: "BLS_PUBLIC",
      commercial_status: "allowed",
      attribution_text: "Source: BLS."
    }
  },
  {
    series_id: "US_UNEMPLOYMENT_RATE",
    title: "US Unemployment Rate",
    latest_value: 3.9,
    period: "2026-01",
    yoy: -0.2,
    sparkline: [4.1, 4.0, 4.0, 3.9, 3.9, 3.9],
    source: { name: "BLS", policy_url: "https://www.bls.gov/developers/" },
    license: {
      code: "BLS_PUBLIC",
      commercial_status: "allowed",
      attribution_text: "Source: BLS."
    }
  },
  {
    series_id: "US_NONFARM_PAYROLLS",
    title: "US Nonfarm Payrolls",
    latest_value: 159820,
    period: "2026-01",
    yoy: 1.2,
    sparkline: [158920, 159040, 159180, 159410, 159620, 159820],
    source: { name: "BLS", policy_url: "https://www.bls.gov/developers/" },
    license: {
      code: "BLS_PUBLIC",
      commercial_status: "allowed",
      attribution_text: "Source: BLS."
    }
  },
  {
    series_id: "US_AVG_HOURLY_EARNINGS",
    title: "US Avg Hourly Earnings",
    latest_value: 35.5,
    period: "2026-01",
    yoy: 3.2,
    sparkline: [34.6, 34.8, 35, 35.1, 35.3, 35.5],
    source: { name: "BLS", policy_url: "https://www.bls.gov/developers/" },
    license: {
      code: "BLS_PUBLIC",
      commercial_status: "allowed",
      attribution_text: "Source: BLS."
    }
  },
  {
    series_id: "US_GDP_QOQ",
    title: "US GDP QoQ",
    latest_value: 0.6,
    period: "2025-Q4",
    yoy: 2.1,
    sparkline: [0.2, 0.3, 0.5, 0.7, 0.6, 0.6],
    source: { name: "BEA", policy_url: "https://apps.bea.gov/API/docs/index.htm" },
    license: {
      code: "BEA_PUBLIC",
      commercial_status: "allowed",
      attribution_text: "Source: BEA."
    }
  },
  {
    series_id: "US_EIA_CRUDE_STOCKS",
    title: "US Crude Stocks",
    latest_value: 430.5,
    period: "2026-W06",
    yoy: 1.3,
    sparkline: [427, 428, 426, 429, 431, 430.5],
    source: { name: "EIA", policy_url: "https://www.eia.gov/opendata/" },
    license: {
      code: "EIA_PUBLIC",
      commercial_status: "allowed",
      attribution_text: "Source: EIA."
    }
  },
  {
    series_id: "US_FEDFUNDS",
    title: "US Fed Funds Target",
    latest_value: 5.25,
    period: "2026-02",
    yoy: -0.6,
    sparkline: [5.5, 5.5, 5.5, 5.25, 5.25, 5.25],
    source: { name: "Federal Reserve Board", policy_url: "https://www.federalreserve.gov/datadownload/" },
    license: {
      code: "FRB_PUBLIC",
      commercial_status: "allowed",
      attribution_text: "Source: Federal Reserve Board."
    }
  },
  {
    series_id: "US_TREASURY_10Y",
    title: "US 10Y Treasury Yield",
    latest_value: 4.1,
    period: "2026-02",
    yoy: -0.4,
    sparkline: [4.6, 4.5, 4.4, 4.3, 4.2, 4.1],
    source: { name: "Federal Reserve Board", policy_url: "https://www.federalreserve.gov/datadownload/" },
    license: {
      code: "FRB_PUBLIC",
      commercial_status: "allowed",
      attribution_text: "Source: Federal Reserve Board."
    }
  },
  {
    series_id: "EU_HICP_YOY",
    title: "EU HICP YoY",
    latest_value: 2.3,
    period: "2026-01",
    yoy: 2.3,
    sparkline: [2.8, 2.7, 2.6, 2.5, 2.4, 2.3],
    source: {
      name: "ECB",
      policy_url: "https://www.ecb.europa.eu/stats/ecb_statistics/governance_and_quality_framework/html/usage_policy.en.html"
    },
    license: {
      code: "ECB_STATS",
      commercial_status: "allowed",
      attribution_text: "Source: ECB statistics."
    }
  }
];

export const fallbackGeo = {
  country: "US",
  us_state_code: null,
  us_state_privacy_required: false,
  region_policy: "NON_EU"
};
