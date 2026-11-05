-- Reference data (licenses, sources, entities). Safe to apply to every environment.
-- Sample content for local development lives in sample_data.sql.

insert into licenses (
  code, name, policy_url, commercial_status, attribution_required, attribution_template,
  must_indicate_changes, modification_allowed, redistribution_allowed, no_cache, no_archive,
  required_disclaimer, country_exclusion, notes, last_reviewed_at
) values
(
  'GDELT',
  'GDELT Project Terms',
  'https://www.gdeltproject.org/about.html',
  'allowed',
  true,
  'Index data: GDELT (citation + link).',
  false,
  true,
  true,
  false,
  false,
  'Publisher content is not hosted on this site.',
  null,
  'Citation and link are mandatory.',
  now()
),
(
  'SEC_EDGAR',
  'SEC EDGAR Fair Access',
  'https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data',
  'allowed',
  true,
  'Source: SEC EDGAR (official).',
  false,
  true,
  true,
  false,
  false,
  'Open SEC.gov for official filing text.',
  null,
  'Global rate limit <=10 rps and declared user agent required.',
  now()
),
(
  'ECB_STATS',
  'ECB Statistics Reuse Policy',
  'https://www.ecb.europa.eu/stats/ecb_statistics/governance_and_quality_framework/html/usage_policy.en.html',
  'allowed',
  true,
  'Source: ECB statistics.',
  true,
  true,
  true,
  false,
  false,
  'Raw series must remain unmodified.',
  null,
  'Raw locked; derived values stored separately.',
  now()
),
(
  'BLS_PUBLIC',
  'BLS Public Data Terms',
  'https://www.bls.gov/developers/home.htm',
  'allowed',
  true,
  'Source: BLS.',
  false,
  true,
  true,
  false,
  false,
  'Official source data.',
  null,
  'Public labor statistics API terms.',
  now()
),
(
  'BEA_PUBLIC',
  'BEA API Terms',
  'https://apps.bea.gov/API/docs/index.htm',
  'allowed',
  true,
  'Source: BEA.',
  false,
  true,
  true,
  false,
  false,
  'Official source data.',
  null,
  'Public GDP and national accounts API.',
  now()
),
(
  'EIA_PUBLIC',
  'EIA Open Data',
  'https://www.eia.gov/opendata/',
  'allowed',
  true,
  'Source: EIA.',
  false,
  true,
  true,
  false,
  false,
  'Official source data.',
  null,
  'Public energy indicators.',
  now()
),
(
  'FRB_PUBLIC',
  'Federal Reserve Board Data',
  'https://www.federalreserve.gov/data.htm',
  'allowed',
  true,
  'Source: Federal Reserve Board.',
  false,
  true,
  true,
  false,
  false,
  'Official source data.',
  null,
  'Public US monetary and financial statistics.',
  now()
),
(
  'EUROSTAT_CONDITIONAL',
  'Eurostat Conditional',
  'https://ec.europa.eu/eurostat/help/copyright-notice',
  'conditional',
  true,
  'Source: Eurostat (subject to exceptions).',
  false,
  true,
  true,
  false,
  false,
  'Some datasets may include third-party rights and exceptions.',
  '{"exclude":["US","NON_EU_DEFAULT"]}',
  'Allow only EU/EA/EFTA/candidate in production.',
  now()
),
(
  'OECD_CONDITIONAL',
  'OECD Conditional',
  'https://www.oecd.org/en/about/terms-conditions.html',
  'conditional',
  true,
  'Source: OECD (license review required).',
  false,
  true,
  true,
  false,
  false,
  'Third-party or restricted datasets are blocked from production.',
  null,
  'Default to conditional until dataset-level review clears it.',
  now()
),
(
  'WORLD_BANK_CONDITIONAL',
  'World Bank Conditional',
  'https://datacatalog.worldbank.org/public-licenses',
  'conditional',
  true,
  'Source: World Bank Data (license review required).',
  false,
  true,
  true,
  false,
  false,
  'Only CC BY 4.0 datasets without additional restrictions may be shown.',
  null,
  'Default conditional gate on third-party or unclear restrictions.',
  now()
),
(
  'FRED_DISALLOWED',
  'FRED Legal Restrictions',
  'https://fred.stlouisfed.org/legal/',
  'disallowed',
  true,
  'View on FRED.',
  false,
  false,
  false,
  true,
  true,
  'No FRED data is displayed, stored, cached, or served in production.',
  null,
  'Hard block in code and tests.',
  now()
)
on conflict (code) do nothing;

with l as (select code, license_id from licenses)
insert into sources (name, homepage_url, docs_url, default_license_id, ingestion_rules, active)
values
(
  'GDELT',
  'https://www.gdeltproject.org/',
  'https://www.gdeltproject.org/about.html',
  (select license_id from l where code = 'GDELT'),
  '{"metadata_only":true,"publisher_content_blocked":true}'::jsonb,
  true
),
(
  'SEC EDGAR',
  'https://www.sec.gov/edgar.shtml',
  'https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data',
  (select license_id from l where code = 'SEC_EDGAR'),
  '{"global_rps_limit":10,"requires_user_agent":true}'::jsonb,
  true
),
(
  'BLS',
  'https://www.bls.gov/',
  'https://www.bls.gov/developers/',
  (select license_id from l where code = 'BLS_PUBLIC'),
  '{"official_stats":true}'::jsonb,
  true
),
(
  'BEA',
  'https://www.bea.gov/',
  'https://apps.bea.gov/API/docs/index.htm',
  (select license_id from l where code = 'BEA_PUBLIC'),
  '{"official_stats":true}'::jsonb,
  true
),
(
  'EIA',
  'https://www.eia.gov/',
  'https://www.eia.gov/opendata/',
  (select license_id from l where code = 'EIA_PUBLIC'),
  '{"official_stats":true}'::jsonb,
  true
),
(
  'Federal Reserve Board',
  'https://www.federalreserve.gov/',
  'https://www.federalreserve.gov/data.htm',
  (select license_id from l where code = 'FRB_PUBLIC'),
  '{"official_stats":true}'::jsonb,
  true
),
(
  'ECB',
  'https://www.ecb.europa.eu/',
  'https://www.ecb.europa.eu/stats/ecb_statistics/governance_and_quality_framework/html/usage_policy.en.html',
  (select license_id from l where code = 'ECB_STATS'),
  '{"raw_locked_required":true}'::jsonb,
  true
),
(
  'Eurostat',
  'https://ec.europa.eu/eurostat',
  'https://ec.europa.eu/eurostat/help/copyright-notice',
  (select license_id from l where code = 'EUROSTAT_CONDITIONAL'),
  '{"geo_filter":"EU_EA_EFTA_CANDIDATE"}'::jsonb,
  true
),
(
  'OECD',
  'https://www.oecd.org/',
  'https://www.oecd.org/en/about/terms-conditions.html',
  (select license_id from l where code = 'OECD_CONDITIONAL'),
  '{"default_gate":"conditional"}'::jsonb,
  true
),
(
  'World Bank',
  'https://www.worldbank.org/',
  'https://datacatalog.worldbank.org/public-licenses',
  (select license_id from l where code = 'WORLD_BANK_CONDITIONAL'),
  '{"default_gate":"conditional"}'::jsonb,
  true
)
on conflict (name) do nothing;

insert into entities (slug, entity_type, name, primary_ticker, tickers, exchanges, meta, cik)
values
('nvidia', 'company', 'NVIDIA', 'NVDA', array['NVDA'], array['NASDAQ'], '{"sector":"semiconductor"}'::jsonb, '0001045810'),
('sec', 'agency', 'U.S. Securities and Exchange Commission', null, null, null, '{}'::jsonb, null),
('ecb', 'agency', 'European Central Bank', null, null, null, '{}'::jsonb, null),
('bls', 'agency', 'U.S. Bureau of Labor Statistics', null, null, null, '{}'::jsonb, null),
('bea', 'agency', 'U.S. Bureau of Economic Analysis', null, null, null, '{}'::jsonb, null),
('eia', 'agency', 'U.S. Energy Information Administration', null, null, null, '{}'::jsonb, null),
('frb', 'agency', 'Federal Reserve Board', null, null, null, '{}'::jsonb, null),
('world-bank', 'agency', 'World Bank', null, null, null, '{}'::jsonb, null),
('oecd', 'agency', 'Organisation for Economic Co-operation and Development', null, null, null, '{}'::jsonb, null)
on conflict (slug) do nothing;

