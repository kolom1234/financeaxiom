-- Extensions (Supabase typically supports pgcrypto)
create extension if not exists pgcrypto;

-- -------------------------------------------------------------------
-- 8.1 License metadata (compliance engine)
-- -------------------------------------------------------------------
create table if not exists licenses (
  license_id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  policy_url text not null,
  commercial_status text not null check (commercial_status in ('allowed','conditional','disallowed')),
  attribution_required boolean not null default false,
  attribution_template text,
  must_indicate_changes boolean not null default false,
  modification_allowed boolean not null default true,
  redistribution_allowed boolean not null default true,
  no_cache boolean not null default false,
  no_archive boolean not null default false,
  required_disclaimer text,
  country_exclusion jsonb,
  notes text,
  last_reviewed_at timestamptz not null
);

create table if not exists sources (
  source_id uuid primary key default gen_random_uuid(),
  name text not null unique,
  homepage_url text,
  docs_url text,
  default_license_id uuid not null references licenses(license_id),
  ingestion_rules jsonb,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists datasets (
  dataset_id uuid primary key default gen_random_uuid(),
  source_id uuid not null references sources(source_id),
  dataset_code text,
  dataset_name text,
  dataset_url text,
  license_id uuid references licenses(license_id),
  third_party_flag boolean not null default false,
  restriction_notes text,
  meta jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists series (
  series_id uuid primary key default gen_random_uuid(),
  source_id uuid not null references sources(source_id),
  dataset_id uuid references datasets(dataset_id),
  series_code text not null,
  title text not null,
  geo text,
  frequency text,
  units text,
  seasonal_adj text,
  is_derived boolean not null default false,
  derivation jsonb,
  license_id uuid references licenses(license_id),
  origin_url text,
  raw_locked boolean not null default false,
  updated_at timestamptz not null default now(),
  unique(source_id, series_code, is_derived)
);

create table if not exists series_observations (
  series_id uuid not null references series(series_id) on delete cascade,
  obs_date date not null,
  value_raw text not null,
  value_num double precision,
  revision_tag text,
  fetched_at timestamptz not null default now(),
  source_hash text,
  primary key (series_id, obs_date)
);

create index if not exists idx_obs_series_date on series_observations(series_id, obs_date);

-- -------------------------------------------------------------------
-- 8.2 Entities (tickers, agencies) for filtering
-- -------------------------------------------------------------------
create table if not exists entities (
  entity_id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  entity_type text not null check (entity_type in ('company','agency','country','index','topic')),
  name text not null,
  cik text,
  lei text,
  primary_ticker text,
  tickers text[],
  exchanges text[],
  meta jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists idx_entities_ticker on entities(primary_ticker);

-- -------------------------------------------------------------------
-- 8.3 Content items (NO publisher content fields)
-- -------------------------------------------------------------------
create table if not exists content_items (
  item_id uuid primary key default gen_random_uuid(),
  item_type text not null check (item_type in ('gdelt_link','sec_filing','macro_update','fact_flash','analysis')),
  event_time timestamptz not null,
  created_at timestamptz not null default now(),

  -- ALWAYS self-generated
  headline_generated text not null,
  summary_generated text,

  -- link-out only
  external_url text,

  -- provenance + compliance
  source_id uuid references sources(source_id),
  license_id uuid references licenses(license_id),

  is_breaking boolean not null default false,
  region text,
  raw_ref text,
  meta jsonb
);

create index if not exists idx_content_items_time on content_items(event_time desc);
create index if not exists idx_content_items_type_time on content_items(item_type, event_time desc);

create table if not exists content_item_entities (
  item_id uuid not null references content_items(item_id) on delete cascade,
  entity_id uuid not null references entities(entity_id) on delete cascade,
  role text,
  primary key (item_id, entity_id)
);

create table if not exists content_provenance (
  item_id uuid not null references content_items(item_id) on delete cascade,
  source_id uuid references sources(source_id),
  dataset_id uuid references datasets(dataset_id),
  series_id uuid references series(series_id),
  note text,
  primary key (item_id, source_id, dataset_id, series_id)
);

-- -------------------------------------------------------------------
-- 8.4 Filings (SEC)
-- -------------------------------------------------------------------
create table if not exists filings (
  accession text primary key,
  cik text,
  company_name text,
  form_type text,
  filed_at timestamptz,
  accepted_at timestamptz,
  sec_url text,
  meta jsonb,
  fetched_at timestamptz not null default now()
);

create index if not exists idx_filings_cik_time on filings(cik, filed_at desc);

-- -------------------------------------------------------------------
-- 8.5 Alerts / Push (store encrypted)
-- -------------------------------------------------------------------
create table if not exists push_subscriptions (
  subscription_id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  endpoint_enc text not null,
  p256dh_enc text not null,
  auth_enc text not null,
  enc_iv text not null,
  filters jsonb,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz
);

create table if not exists alert_rules (
  rule_id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  enabled boolean not null default true,
  rule_type text not null check (rule_type in ('breaking','entity','ticker','macro','filing_form')),
  rule jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_alert_rules_user on alert_rules(user_id);

create table if not exists notification_events (
  notification_id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  item_id uuid not null references content_items(item_id) on delete cascade,
  created_at timestamptz not null default now(),
  payload jsonb not null,
  status text not null check (status in ('queued','sent','failed')),
  error text
);

create unique index if not exists uq_user_item_dedup on notification_events(user_id, item_id);

-- -------------------------------------------------------------------
-- 8.6 Policy snapshots (audit only; not displayed)
-- -------------------------------------------------------------------
create table if not exists policy_snapshots (
  snapshot_id uuid primary key default gen_random_uuid(),
  license_id uuid not null references licenses(license_id),
  retrieved_at timestamptz not null default now(),
  policy_url text not null,
  sha256 text not null,
  r2_object_key text,
  note text
);

