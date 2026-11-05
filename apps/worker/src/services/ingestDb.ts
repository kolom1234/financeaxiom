import type { CommercialStatus } from "@ofp/shared";
import type { PgClient } from "./db";

export interface SourceContext {
  sourceId: string;
  sourceName: string;
  docsUrl: string | null;
  defaultLicenseId: string;
  defaultLicenseCode: string;
  defaultCommercialStatus: CommercialStatus;
  defaultAttribution: string | null;
  defaultDisclaimer: string | null;
}

export interface LicenseContext {
  licenseId: string;
  code: string;
  commercialStatus: CommercialStatus;
  attributionTemplate: string | null;
  requiredDisclaimer: string | null;
}

export interface SeriesObservationInput {
  obsDate: string;
  valueRaw: string;
  valueNum: number | null;
  sourceHash?: string | null;
}

export interface UpsertSeriesInput {
  sourceId: string;
  seriesCode: string;
  title: string;
  geo?: string | null;
  frequency?: string | null;
  units?: string | null;
  isDerived: boolean;
  derivation?: Record<string, unknown> | null;
  licenseId: string;
  originUrl?: string | null;
  rawLocked: boolean;
}

export interface UpsertContentItemInput {
  itemType: "gdelt_link" | "sec_filing" | "macro_update" | "fact_flash" | "analysis";
  eventTime: string;
  headline: string;
  summary?: string | null;
  externalUrl?: string | null;
  sourceId: string;
  licenseId: string;
  isBreaking: boolean;
  region: "US" | "EU" | "GLOBAL";
  meta: Record<string, unknown>;
  dedupeKey: string;
}

export interface UpsertEntityInput {
  slug: string;
  name: string;
  entityType: "company" | "agency" | "country" | "index" | "topic";
  primaryTicker?: string | null;
  cik?: string | null;
  tickers?: string[] | null;
  exchanges?: string[] | null;
  meta?: Record<string, unknown>;
}

export async function resolveSourceContext(client: PgClient, sourceName: string): Promise<SourceContext | null> {
  const result = await client.query(
    `
    select
      s.source_id,
      s.name as source_name,
      s.docs_url,
      l.license_id as default_license_id,
      l.code as default_license_code,
      l.commercial_status as default_commercial_status,
      l.attribution_template as default_attribution,
      l.required_disclaimer as default_disclaimer
    from sources s
    join licenses l on l.license_id = s.default_license_id
    where s.name = $1
    limit 1
  `,
    [sourceName]
  );

  if (result.rowCount === 0) {
    return null;
  }

  const row = result.rows[0] as Record<string, unknown>;
  return {
    sourceId: row.source_id as string,
    sourceName: row.source_name as string,
    docsUrl: (row.docs_url as string | null) ?? null,
    defaultLicenseId: row.default_license_id as string,
    defaultLicenseCode: row.default_license_code as string,
    defaultCommercialStatus: row.default_commercial_status as CommercialStatus,
    defaultAttribution: (row.default_attribution as string | null) ?? null,
    defaultDisclaimer: (row.default_disclaimer as string | null) ?? null
  };
}

export async function resolveLicenseContext(client: PgClient, code: string): Promise<LicenseContext | null> {
  const result = await client.query(
    `
    select
      license_id,
      code,
      commercial_status,
      attribution_template,
      required_disclaimer
    from licenses
    where code = $1
    limit 1
  `,
    [code]
  );

  if (result.rowCount === 0) {
    return null;
  }

  const row = result.rows[0] as Record<string, unknown>;
  return {
    licenseId: row.license_id as string,
    code: row.code as string,
    commercialStatus: row.commercial_status as CommercialStatus,
    attributionTemplate: (row.attribution_template as string | null) ?? null,
    requiredDisclaimer: (row.required_disclaimer as string | null) ?? null
  };
}

export async function upsertEntity(client: PgClient, input: UpsertEntityInput): Promise<string> {
  const result = await client.query(
    `
    insert into entities (
      slug, entity_type, name, primary_ticker, tickers, exchanges, meta, cik, updated_at
    )
    values (
      $1, $2, $3, $4, $5, $6, $7::jsonb, $8, now()
    )
    on conflict (slug) do update
    set
      entity_type = excluded.entity_type,
      name = excluded.name,
      primary_ticker = coalesce(excluded.primary_ticker, entities.primary_ticker),
      tickers = coalesce(excluded.tickers, entities.tickers),
      exchanges = coalesce(excluded.exchanges, entities.exchanges),
      meta = coalesce(excluded.meta, entities.meta),
      cik = coalesce(excluded.cik, entities.cik),
      updated_at = now()
    returning entity_id
  `,
    [
      input.slug,
      input.entityType,
      input.name,
      input.primaryTicker ?? null,
      input.tickers ?? null,
      input.exchanges ?? null,
      JSON.stringify(input.meta ?? {}),
      input.cik ?? null
    ]
  );
  return result.rows[0].entity_id as string;
}

export async function upsertSeries(client: PgClient, input: UpsertSeriesInput): Promise<string> {
  const result = await client.query(
    `
    insert into series (
      source_id, series_code, title, geo, frequency, units,
      is_derived, derivation, license_id, origin_url, raw_locked, updated_at
    )
    values (
      $1, $2, $3, $4, $5, $6,
      $7, $8::jsonb, $9, $10, $11, now()
    )
    on conflict (source_id, series_code, is_derived) do update
    set
      title = excluded.title,
      geo = excluded.geo,
      frequency = excluded.frequency,
      units = excluded.units,
      derivation = excluded.derivation,
      license_id = excluded.license_id,
      origin_url = excluded.origin_url,
      raw_locked = excluded.raw_locked,
      updated_at = now()
    returning series_id
  `,
    [
      input.sourceId,
      input.seriesCode,
      input.title,
      input.geo ?? null,
      input.frequency ?? null,
      input.units ?? null,
      input.isDerived,
      JSON.stringify(input.derivation ?? null),
      input.licenseId,
      input.originUrl ?? null,
      input.rawLocked
    ]
  );

  return result.rows[0].series_id as string;
}

/** Existing raw values for the given dates, keyed by YYYY-MM-DD. */
export async function getExistingObservations(
  client: PgClient,
  seriesId: string,
  obsDates: string[]
): Promise<Map<string, { valueRaw: string; sourceHash: string | null }>> {
  const existing = new Map<string, { valueRaw: string; sourceHash: string | null }>();
  if (obsDates.length === 0) {
    return existing;
  }
  const result = await client.query(
    `
    select obs_date::text as obs_date, value_raw, source_hash
    from series_observations
    where series_id = $1 and obs_date = any($2::date[])
  `,
    [seriesId, obsDates]
  );
  for (const row of result.rows as Record<string, unknown>[]) {
    existing.set(String(row.obs_date), {
      valueRaw: String(row.value_raw),
      sourceHash: (row.source_hash as string | null) ?? null
    });
  }
  return existing;
}

/** Upserts all observations of a series in one statement. */
export async function upsertSeriesObservations(
  client: PgClient,
  seriesId: string,
  observations: SeriesObservationInput[]
): Promise<number> {
  if (observations.length === 0) {
    return 0;
  }
  const result = await client.query(
    `
    insert into series_observations (series_id, obs_date, value_raw, value_num, source_hash, fetched_at)
    select $1::uuid, t.obs_date::date, t.value_raw, t.value_num, t.source_hash, now()
    from unnest($2::text[], $3::text[], $4::float8[], $5::text[]) as t(obs_date, value_raw, value_num, source_hash)
    on conflict (series_id, obs_date) do update
    set
      value_raw = excluded.value_raw,
      value_num = excluded.value_num,
      source_hash = coalesce(excluded.source_hash, series_observations.source_hash),
      fetched_at = now()
  `,
    [
      seriesId,
      observations.map((obs) => obs.obsDate),
      observations.map((obs) => obs.valueRaw),
      observations.map((obs) => obs.valueNum),
      observations.map((obs) => obs.sourceHash ?? null)
    ]
  );
  return result.rowCount ?? 0;
}

export interface ObservationRevision {
  obsDate: string;
  previousValueRaw: string;
  newValueRaw: string;
  previousSourceHash: string | null;
  newSourceHash: string | null;
}

export async function recordObservationRevisions(
  client: PgClient,
  seriesId: string,
  revisions: ObservationRevision[]
): Promise<void> {
  if (revisions.length === 0) {
    return;
  }
  await client.query(
    `
    insert into series_observation_revisions (
      series_id, obs_date, previous_value_raw, new_value_raw, previous_source_hash, new_source_hash
    )
    select $1::uuid, t.obs_date::date, t.prev_raw, t.new_raw, t.prev_hash, t.new_hash
    from unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::text[]) as t(obs_date, prev_raw, new_raw, prev_hash, new_hash)
  `,
    [
      seriesId,
      revisions.map((rev) => rev.obsDate),
      revisions.map((rev) => rev.previousValueRaw),
      revisions.map((rev) => rev.newValueRaw),
      revisions.map((rev) => rev.previousSourceHash),
      revisions.map((rev) => rev.newSourceHash)
    ]
  );
}

/**
 * Atomic upsert keyed by (source_id, dedupe_key). On conflict the descriptive
 * fields are refreshed but `event_time` is NEVER changed, so an already-known
 * item cannot be re-dated and resurface as "new".
 */
export async function upsertContentItem(
  client: PgClient,
  input: UpsertContentItemInput
): Promise<{ itemId: string; inserted: boolean }> {
  const meta = { ...input.meta, dedupe_key: input.dedupeKey };
  const result = await client.query(
    `
    insert into content_items (
      item_type, event_time, headline_generated, summary_generated, external_url,
      source_id, license_id, is_breaking, region, meta, dedupe_key
    )
    values ($1, $2::timestamptz, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11)
    on conflict (source_id, dedupe_key) where dedupe_key is not null
    do update set
      item_type = excluded.item_type,
      headline_generated = excluded.headline_generated,
      summary_generated = excluded.summary_generated,
      external_url = excluded.external_url,
      license_id = excluded.license_id,
      is_breaking = excluded.is_breaking,
      region = excluded.region,
      meta = excluded.meta
    returning item_id, (xmax = 0) as inserted
  `,
    [
      input.itemType,
      input.eventTime,
      input.headline,
      input.summary ?? null,
      input.externalUrl ?? null,
      input.sourceId,
      input.licenseId,
      input.isBreaking,
      input.region,
      JSON.stringify(meta),
      input.dedupeKey
    ]
  );
  const row = result.rows[0] as Record<string, unknown>;
  return { itemId: String(row.item_id), inserted: Boolean(row.inserted) };
}

export async function upsertFiling(
  client: PgClient,
  input: {
    accession: string;
    cik: string;
    companyName: string;
    formType: string;
    filedAt?: string | null;
    acceptedAt?: string | null;
    secUrl: string;
    meta: Record<string, unknown>;
  }
): Promise<void> {
  await client.query(
    `
    insert into filings (
      accession, cik, company_name, form_type, filed_at, accepted_at, sec_url, meta, fetched_at
    )
    values (
      $1, $2, $3, $4, $5::timestamptz, $6::timestamptz, $7, $8::jsonb, now()
    )
    on conflict (accession) do update
    set
      cik = excluded.cik,
      company_name = excluded.company_name,
      form_type = excluded.form_type,
      filed_at = excluded.filed_at,
      accepted_at = excluded.accepted_at,
      sec_url = excluded.sec_url,
      meta = excluded.meta,
      fetched_at = now()
  `,
    [
      input.accession,
      input.cik,
      input.companyName,
      input.formType,
      input.filedAt ?? null,
      input.acceptedAt ?? null,
      input.secUrl,
      JSON.stringify(input.meta)
    ]
  );
}

export async function linkItemEntity(
  client: PgClient,
  itemId: string,
  entitySlug: string,
  role: string
): Promise<void> {
  await client.query(
    `
    insert into content_item_entities (item_id, entity_id, role)
    select $1, e.entity_id, $3
    from entities e
    where e.slug = $2
    on conflict (item_id, entity_id) do nothing
  `,
    [itemId, entitySlug, role]
  );
}

/** Links an item to the entity registered with the given SEC CIK, if any. */
export async function linkItemEntityByCik(client: PgClient, itemId: string, cik: string, role: string): Promise<void> {
  await client.query(
    `
    insert into content_item_entities (item_id, entity_id, role)
    select $1, e.entity_id, $3
    from entities e
    where e.cik = $2
    on conflict (item_id, entity_id) do nothing
  `,
    [itemId, cik, role]
  );
}
