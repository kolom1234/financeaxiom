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

insert into entities (slug, entity_type, name, primary_ticker, tickers, exchanges, meta)
values
('nvidia', 'company', 'NVIDIA', 'NVDA', array['NVDA'], array['NASDAQ'], '{"sector":"semiconductor"}'::jsonb),
('sec', 'agency', 'U.S. Securities and Exchange Commission', null, null, null, '{}'::jsonb),
('ecb', 'agency', 'European Central Bank', null, null, null, '{}'::jsonb),
('bls', 'agency', 'U.S. Bureau of Labor Statistics', null, null, null, '{}'::jsonb),
('bea', 'agency', 'U.S. Bureau of Economic Analysis', null, null, null, '{}'::jsonb),
('eia', 'agency', 'U.S. Energy Information Administration', null, null, null, '{}'::jsonb),
('frb', 'agency', 'Federal Reserve Board', null, null, null, '{}'::jsonb),
('world-bank', 'agency', 'World Bank', null, null, null, '{}'::jsonb),
('oecd', 'agency', 'Organisation for Economic Co-operation and Development', null, null, null, '{}'::jsonb)
on conflict (slug) do nothing;

insert into content_items (
  item_type, event_time, headline_generated, summary_generated, external_url,
  source_id, license_id, is_breaking, region, meta
)
select
  'gdelt_link',
  now() - interval '10 minutes',
  'NVIDIA index activity (6h window): 84 mentions',
  'Detected via index metadata. Open original sources for full coverage.',
  'https://api.gdeltproject.org/api/v2/doc/doc?query=NVIDIA&mode=artlist&format=html&sort=datedesc&maxrecords=5',
  s.source_id,
  l.license_id,
  true,
  'GLOBAL',
  '{"window":"6h","score":84}'::jsonb
from sources s
join licenses l on l.code = 'GDELT'
where s.name = 'GDELT'
and not exists (select 1 from content_items where headline_generated = 'NVIDIA index activity (6h window): 84 mentions');

insert into content_items (
  item_type, event_time, headline_generated, summary_generated, external_url,
  source_id, license_id, is_breaking, region, meta
)
select
  'sec_filing',
  now() - interval '30 minutes',
  '[Filing] NVIDIA 8-K filed',
  'Filed recently. Open SEC.gov for the official document.',
  'https://www.sec.gov/Archives/edgar/data/1045810/000104581026000010/nvda-20260216x8k.htm',
  s.source_id,
  l.license_id,
  true,
  'US',
  '{"form_type":"8-K","accession":"0001045810-26-000010"}'::jsonb
from sources s
join licenses l on l.code = 'SEC_EDGAR'
where s.name = 'SEC EDGAR'
and not exists (select 1 from content_items where headline_generated = '[Filing] NVIDIA 8-K filed');

insert into content_items (
  item_type, event_time, headline_generated, summary_generated, external_url,
  source_id, license_id, is_breaking, region, meta
)
select
  'macro_update',
  now() - interval '90 minutes',
  'Euro area HICP YoY updated',
  'Derived YoY value updated from ECB raw series.',
  'https://www.ecb.europa.eu/stats/',
  s.source_id,
  l.license_id,
  false,
  'EU',
  '{"series":"EU_HICP_YOY","raw_locked":true}'::jsonb
from sources s
join licenses l on l.code = 'ECB_STATS'
where s.name = 'ECB'
and not exists (select 1 from content_items where headline_generated = 'Euro area HICP YoY updated');

insert into content_items (
  item_type, event_time, headline_generated, summary_generated, external_url,
  source_id, license_id, is_breaking, region, meta
)
select
  'macro_update',
  now() - interval '50 minutes',
  'US CPI print aligns with BLS release window',
  'Official BLS release metadata ingested for CPI tracking.',
  'https://www.bls.gov/developers/',
  s.source_id,
  l.license_id,
  true,
  'US',
  '{"series":"US_CPI_YOY","provider":"BLS"}'::jsonb
from sources s
join licenses l on l.code = 'BLS_PUBLIC'
where s.name = 'BLS'
and not exists (select 1 from content_items where headline_generated = 'US CPI print aligns with BLS release window');

insert into content_items (
  item_type, event_time, headline_generated, summary_generated, external_url,
  source_id, license_id, is_breaking, region, meta
)
select
  'macro_update',
  now() - interval '60 minutes',
  'BEA GDP estimate refreshed',
  'Quarterly GDP estimate metadata refreshed from BEA public API.',
  'https://apps.bea.gov/API/docs/index.htm',
  s.source_id,
  l.license_id,
  true,
  'US',
  '{"series":"US_GDP_QOQ","provider":"BEA"}'::jsonb
from sources s
join licenses l on l.code = 'BEA_PUBLIC'
where s.name = 'BEA'
and not exists (select 1 from content_items where headline_generated = 'BEA GDP estimate refreshed');

insert into content_items (
  item_type, event_time, headline_generated, summary_generated, external_url,
  source_id, license_id, is_breaking, region, meta
)
select
  'macro_update',
  now() - interval '80 minutes',
  'EIA weekly crude inventory update posted',
  'Inventory delta captured from EIA weekly petroleum status release.',
  'https://www.eia.gov/opendata/',
  s.source_id,
  l.license_id,
  false,
  'US',
  '{"series":"US_EIA_CRUDE_STOCKS","provider":"EIA"}'::jsonb
from sources s
join licenses l on l.code = 'EIA_PUBLIC'
where s.name = 'EIA'
and not exists (select 1 from content_items where headline_generated = 'EIA weekly crude inventory update posted');

insert into content_items (
  item_type, event_time, headline_generated, summary_generated, external_url,
  source_id, license_id, is_breaking, region, meta
)
select
  'fact_flash',
  now() - interval '40 minutes',
  'Federal Reserve Board policy data snapshot updated',
  'Fed data portal snapshot synced for rates and balance-sheet context.',
  'https://www.federalreserve.gov/data.htm',
  s.source_id,
  l.license_id,
  true,
  'US',
  '{"series":"US_FEDFUNDS","provider":"FRB"}'::jsonb
from sources s
join licenses l on l.code = 'FRB_PUBLIC'
where s.name = 'Federal Reserve Board'
and not exists (select 1 from content_items where headline_generated = 'Federal Reserve Board policy data snapshot updated');

insert into content_items (
  item_type, event_time, headline_generated, summary_generated, external_url,
  source_id, license_id, is_breaking, region, meta
)
select
  'analysis',
  now() - interval '70 minutes',
  'World Bank GDP dataset queued for license review',
  'Dataset remains in compliance hold until conditional license checks pass.',
  'https://datacatalog.worldbank.org/',
  s.source_id,
  l.license_id,
  false,
  'GLOBAL',
  '{"status":"quarantine","reason":"conditional_license"}'::jsonb
from sources s
join licenses l on l.code = 'WORLD_BANK_CONDITIONAL'
where s.name = 'World Bank'
and not exists (select 1 from content_items where headline_generated = 'World Bank GDP dataset queued for license review');

insert into content_items (
  item_type, event_time, headline_generated, summary_generated, external_url,
  source_id, license_id, is_breaking, region, meta
)
select
  'analysis',
  now() - interval '75 minutes',
  'OECD labor dataset queued for policy clearance',
  'OECD dataset is retained as metadata-only pending rights validation.',
  'https://stats.oecd.org/',
  s.source_id,
  l.license_id,
  false,
  'GLOBAL',
  '{"status":"quarantine","reason":"conditional_license"}'::jsonb
from sources s
join licenses l on l.code = 'OECD_CONDITIONAL'
where s.name = 'OECD'
and not exists (select 1 from content_items where headline_generated = 'OECD labor dataset queued for policy clearance');

insert into filings (accession, cik, company_name, form_type, filed_at, accepted_at, sec_url, meta)
values
(
  '0001045810-26-000010',
  '0001045810',
  'NVIDIA CORP',
  '8-K',
  now() - interval '45 minutes',
  now() - interval '42 minutes',
  'https://www.sec.gov/Archives/edgar/data/1045810/000104581026000010/',
  '{"primary_document":"https://www.sec.gov/Archives/edgar/data/1045810/000104581026000010/nvda-20260216x8k.htm"}'::jsonb
)
on conflict (accession) do nothing;

with mapping(headline_generated, entity_slug, role) as (
  values
    ('NVIDIA index activity (6h window): 84 mentions', 'nvidia', 'subject'),
    ('[Filing] NVIDIA 8-K filed', 'nvidia', 'issuer'),
    ('[Filing] NVIDIA 8-K filed', 'sec', 'regulator'),
    ('Euro area HICP YoY updated', 'ecb', 'publisher'),
    ('US CPI print aligns with BLS release window', 'bls', 'publisher'),
    ('BEA GDP estimate refreshed', 'bea', 'publisher'),
    ('EIA weekly crude inventory update posted', 'eia', 'publisher'),
    ('Federal Reserve Board policy data snapshot updated', 'frb', 'publisher'),
    ('World Bank GDP dataset queued for license review', 'world-bank', 'publisher'),
    ('OECD labor dataset queued for policy clearance', 'oecd', 'publisher')
)
insert into content_item_entities (item_id, entity_id, role)
select ci.item_id, e.entity_id, m.role
from mapping m
join content_items ci on ci.headline_generated = m.headline_generated
join entities e on e.slug = m.entity_slug
on conflict (item_id, entity_id) do nothing;

with raw_series as (
  insert into series (
    source_id, series_code, title, geo, frequency, units, is_derived, license_id, origin_url, raw_locked
  )
  select
    s.source_id,
    'EU_HICP_RAW',
    'EU HICP Raw',
    'EU',
    'monthly',
    'index',
    false,
    l.license_id,
    'https://www.ecb.europa.eu/stats/',
    true
  from sources s
  join licenses l on l.code = 'ECB_STATS'
  where s.name = 'ECB'
  on conflict (source_id, series_code, is_derived) do update set title = excluded.title
  returning series_id
),
derived_series as (
  insert into series (
    source_id, series_code, title, geo, frequency, units, is_derived, derivation, license_id, origin_url, raw_locked
  )
  select
    s.source_id,
    'EU_HICP_YOY',
    'EU HICP YoY',
    'EU',
    'monthly',
    '%',
    true,
    '{"method":"yoy_from_raw"}'::jsonb,
    l.license_id,
    'https://www.ecb.europa.eu/stats/',
    false
  from sources s
  join licenses l on l.code = 'ECB_STATS'
  where s.name = 'ECB'
  on conflict (source_id, series_code, is_derived) do update set title = excluded.title
  returning series_id
)
insert into series_observations (series_id, obs_date, value_raw, value_num, source_hash)
select r.series_id, d.obs_date, d.value_raw, d.value_num, d.source_hash
from raw_series r
cross join (
  values
    ('2025-11-01'::date, '121.1', 121.1::double precision, 'h1'),
    ('2025-12-01'::date, '121.4', 121.4::double precision, 'h2'),
    ('2026-01-01'::date, '121.8', 121.8::double precision, 'h3')
) as d(obs_date, value_raw, value_num, source_hash)
on conflict (series_id, obs_date) do update
set value_raw = excluded.value_raw, value_num = excluded.value_num, source_hash = excluded.source_hash;

with derived_series as (
  select series_id from series where series_code = 'EU_HICP_YOY' and is_derived = true limit 1
)
insert into series_observations (series_id, obs_date, value_raw, value_num)
select d.series_id, v.obs_date, v.value_raw, v.value_num
from derived_series d
cross join (
  values
    ('2025-11-01'::date, '2.8', 2.8::double precision),
    ('2025-12-01'::date, '2.5', 2.5::double precision),
    ('2026-01-01'::date, '2.3', 2.3::double precision)
) as v(obs_date, value_raw, value_num)
on conflict (series_id, obs_date) do update
set value_raw = excluded.value_raw, value_num = excluded.value_num;

with us_cpi as (
  insert into series (
    source_id, series_code, title, geo, frequency, units, is_derived, derivation, license_id, origin_url, raw_locked
  )
  select
    s.source_id,
    'US_CPI_YOY',
    'US CPI YoY',
    'US',
    'monthly',
    '%',
    true,
    '{"method":"official_release"}'::jsonb,
    l.license_id,
    'https://www.bls.gov/developers/',
    false
  from sources s
  join licenses l on l.code = 'BLS_PUBLIC'
  where s.name = 'BLS'
  on conflict (source_id, series_code, is_derived) do update set title = excluded.title
  returning series_id
)
insert into series_observations (series_id, obs_date, value_raw, value_num)
select s.series_id, v.obs_date, v.value_raw, v.value_num
from us_cpi s
cross join (
  values
    ('2025-08-01'::date, '3.1', 3.1::double precision),
    ('2025-09-01'::date, '3.0', 3.0::double precision),
    ('2025-10-01'::date, '2.9', 2.9::double precision),
    ('2025-11-01'::date, '2.8', 2.8::double precision),
    ('2025-12-01'::date, '2.7', 2.7::double precision),
    ('2026-01-01'::date, '2.6', 2.6::double precision)
) as v(obs_date, value_raw, value_num)
on conflict (series_id, obs_date) do update
set value_raw = excluded.value_raw, value_num = excluded.value_num;

with us_unemployment as (
  insert into series (
    source_id, series_code, title, geo, frequency, units, is_derived, license_id, origin_url, raw_locked
  )
  select
    s.source_id,
    'US_UNEMPLOYMENT_RATE',
    'US Unemployment Rate',
    'US',
    'monthly',
    '%',
    false,
    l.license_id,
    'https://www.bls.gov/developers/',
    false
  from sources s
  join licenses l on l.code = 'BLS_PUBLIC'
  where s.name = 'BLS'
  on conflict (source_id, series_code, is_derived) do update set title = excluded.title
  returning series_id
)
insert into series_observations (series_id, obs_date, value_raw, value_num)
select s.series_id, v.obs_date, v.value_raw, v.value_num
from us_unemployment s
cross join (
  values
    ('2025-08-01'::date, '4.2', 4.2::double precision),
    ('2025-09-01'::date, '4.1', 4.1::double precision),
    ('2025-10-01'::date, '4.0', 4.0::double precision),
    ('2025-11-01'::date, '3.9', 3.9::double precision),
    ('2025-12-01'::date, '3.8', 3.8::double precision),
    ('2026-01-01'::date, '3.8', 3.8::double precision)
) as v(obs_date, value_raw, value_num)
on conflict (series_id, obs_date) do update
set value_raw = excluded.value_raw, value_num = excluded.value_num;

with us_gdp as (
  insert into series (
    source_id, series_code, title, geo, frequency, units, is_derived, derivation, license_id, origin_url, raw_locked
  )
  select
    s.source_id,
    'US_GDP_QOQ',
    'US GDP QoQ',
    'US',
    'quarterly',
    '%',
    true,
    '{"method":"bea_qoq"}'::jsonb,
    l.license_id,
    'https://apps.bea.gov/API/docs/index.htm',
    false
  from sources s
  join licenses l on l.code = 'BEA_PUBLIC'
  where s.name = 'BEA'
  on conflict (source_id, series_code, is_derived) do update set title = excluded.title
  returning series_id
)
insert into series_observations (series_id, obs_date, value_raw, value_num)
select s.series_id, v.obs_date, v.value_raw, v.value_num
from us_gdp s
cross join (
  values
    ('2024-10-01'::date, '0.4', 0.4::double precision),
    ('2025-01-01'::date, '0.5', 0.5::double precision),
    ('2025-04-01'::date, '0.6', 0.6::double precision),
    ('2025-07-01'::date, '0.7', 0.7::double precision),
    ('2025-10-01'::date, '0.8', 0.8::double precision),
    ('2026-01-01'::date, '0.6', 0.6::double precision)
) as v(obs_date, value_raw, value_num)
on conflict (series_id, obs_date) do update
set value_raw = excluded.value_raw, value_num = excluded.value_num;

with us_eia as (
  insert into series (
    source_id, series_code, title, geo, frequency, units, is_derived, license_id, origin_url, raw_locked
  )
  select
    s.source_id,
    'US_EIA_CRUDE_STOCKS',
    'US Crude Stocks',
    'US',
    'weekly',
    'million barrels',
    false,
    l.license_id,
    'https://www.eia.gov/opendata/',
    false
  from sources s
  join licenses l on l.code = 'EIA_PUBLIC'
  where s.name = 'EIA'
  on conflict (source_id, series_code, is_derived) do update set title = excluded.title
  returning series_id
)
insert into series_observations (series_id, obs_date, value_raw, value_num)
select s.series_id, v.obs_date, v.value_raw, v.value_num
from us_eia s
cross join (
  values
    ('2025-12-20'::date, '432.8', 432.8::double precision),
    ('2025-12-27'::date, '431.7', 431.7::double precision),
    ('2026-01-03'::date, '431.0', 431.0::double precision),
    ('2026-01-10'::date, '430.8', 430.8::double precision),
    ('2026-01-17'::date, '430.4', 430.4::double precision),
    ('2026-01-24'::date, '429.9', 429.9::double precision)
) as v(obs_date, value_raw, value_num)
on conflict (series_id, obs_date) do update
set value_raw = excluded.value_raw, value_num = excluded.value_num;

with us_fedfunds as (
  insert into series (
    source_id, series_code, title, geo, frequency, units, is_derived, license_id, origin_url, raw_locked
  )
  select
    s.source_id,
    'US_FEDFUNDS',
    'US Effective Fed Funds',
    'US',
    'monthly',
    '%',
    false,
    l.license_id,
    'https://www.federalreserve.gov/data.htm',
    false
  from sources s
  join licenses l on l.code = 'FRB_PUBLIC'
  where s.name = 'Federal Reserve Board'
  on conflict (source_id, series_code, is_derived) do update set title = excluded.title
  returning series_id
)
insert into series_observations (series_id, obs_date, value_raw, value_num)
select s.series_id, v.obs_date, v.value_raw, v.value_num
from us_fedfunds s
cross join (
  values
    ('2025-08-01'::date, '5.40', 5.40::double precision),
    ('2025-09-01'::date, '5.35', 5.35::double precision),
    ('2025-10-01'::date, '5.30', 5.30::double precision),
    ('2025-11-01'::date, '5.25', 5.25::double precision),
    ('2025-12-01'::date, '5.25', 5.25::double precision),
    ('2026-01-01'::date, '5.20', 5.20::double precision)
) as v(obs_date, value_raw, value_num)
on conflict (series_id, obs_date) do update
set value_raw = excluded.value_raw, value_num = excluded.value_num;
