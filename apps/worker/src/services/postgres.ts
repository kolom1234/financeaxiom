import type { CommercialStatus, FeedItemPayload } from "@ofp/shared";
import type {
  AlertRuleRecord,
  Env,
  KeyIndicatorCard,
  NotificationEventRecord,
  PushSubscriptionRecord,
  SeriesObservation
} from "../types";
import { escapeLikePattern, withDb, type PgClient } from "./db";
import type { FeedCursor } from "./cursor";
import { resolveOpenSourceUrl } from "./links";

type AnyRow = Record<string, unknown>;

export type FeedTab = "breaking" | "filings" | "macro" | "newsindex";
export type FeedRegion = "US" | "EU" | "GLOBAL";

function tabFilter(tab: FeedTab): string {
  switch (tab) {
    case "breaking":
      return "ci.is_breaking = true";
    case "filings":
      return "ci.item_type in ('sec_filing','fact_flash')";
    case "macro":
      return "ci.item_type = 'macro_update'";
    case "newsindex":
      return "ci.item_type = 'gdelt_link'";
  }
}

function toIso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asCommercialStatus(value: unknown): CommercialStatus {
  return value === "allowed" || value === "disallowed" ? value : "conditional";
}

async function loadEntitiesForItems(
  client: PgClient,
  itemIds: string[]
): Promise<Map<string, FeedItemPayload["entities"]>> {
  const entityMap = new Map<string, FeedItemPayload["entities"]>();
  if (itemIds.length === 0) {
    return entityMap;
  }
  const rows = await client.query(
    `
      select cie.item_id, e.slug, e.name, e.primary_ticker
      from content_item_entities cie
      join entities e on e.entity_id = cie.entity_id
      where cie.item_id = any($1::uuid[])
      order by e.name asc
    `,
    [itemIds]
  );
  for (const row of rows.rows as AnyRow[]) {
    const itemId = String(row.item_id);
    const current = entityMap.get(itemId) ?? [];
    current.push({
      slug: String(row.slug),
      name: String(row.name),
      primary_ticker: asNullableString(row.primary_ticker) ?? undefined
    });
    entityMap.set(itemId, current);
  }
  return entityMap;
}

function mapFeedRow(row: AnyRow, entities: FeedItemPayload["entities"]): FeedItemPayload {
  const itemType = row.item_type as FeedItemPayload["item_type"];
  const headline = String(row.headline);
  return {
    item_id: String(row.item_id),
    item_type: itemType,
    event_time: toIso(row.event_time),
    headline,
    summary: asNullableString(row.summary),
    meta: (row.meta as Record<string, unknown> | null) ?? undefined,
    external_url: resolveOpenSourceUrl({
      externalUrl: asNullableString(row.external_url),
      itemType,
      headline,
      entities
    }),
    entities,
    source: {
      name: asNullableString(row.source_name) ?? "Unknown",
      policy_url: asNullableString(row.source_policy_url) ?? ""
    },
    license: {
      code: asNullableString(row.license_code) ?? "UNKNOWN",
      commercial_status: asCommercialStatus(row.commercial_status),
      attribution_text: asNullableString(row.attribution_text) ?? "",
      disclaimer_text: asNullableString(row.disclaimer_text) ?? ""
    }
  };
}

const FEED_SELECT = `
  select
    ci.item_id,
    ci.item_type,
    ci.event_time,
    ci.headline_generated as headline,
    ci.summary_generated as summary,
    ci.meta,
    ci.external_url,
    s.name as source_name,
    s.docs_url as source_policy_url,
    l.code as license_code,
    l.commercial_status,
    l.attribution_template as attribution_text,
    l.required_disclaimer as disclaimer_text
  from content_items ci
  left join sources s on s.source_id = ci.source_id
  left join licenses l on l.license_id = ci.license_id
`;

export interface FeedPage {
  items: FeedItemPayload[];
  nextCursor: FeedCursor | null;
}

/**
 * Feed page using keyset pagination on (event_time, item_id) so new items
 * arriving between requests never cause duplicates or skipped rows.
 */
export async function queryFeed(
  env: Env,
  input: { tab: FeedTab; query: string; region: FeedRegion; limit: number; cursor: FeedCursor | null }
): Promise<FeedPage> {
  return withDb(env, async (client) => {
    const pattern = input.query ? `%${escapeLikePattern(input.query)}%` : "";
    const result = await client.query(
      `
      ${FEED_SELECT}
      where ${tabFilter(input.tab)}
        and coalesce(l.commercial_status, 'conditional') = 'allowed'
        and ($2 = 'GLOBAL' or ci.region = $2 or ci.region = 'GLOBAL')
        and (
          $1 = ''
          or ci.headline_generated ilike $1 escape '\\'
          or ci.summary_generated ilike $1 escape '\\'
          or s.name ilike $1 escape '\\'
          or exists (
            select 1
            from content_item_entities cie_match
            join entities e_match on e_match.entity_id = cie_match.entity_id
            where cie_match.item_id = ci.item_id
              and (
                e_match.name ilike $1 escape '\\'
                or e_match.slug ilike $1 escape '\\'
                or e_match.primary_ticker ilike $1 escape '\\'
              )
          )
        )
        and ($3::timestamptz is null or (ci.event_time, ci.item_id) < ($3::timestamptz, $4::uuid))
      order by ci.event_time desc, ci.item_id desc
      limit $5
      `,
      [pattern, input.region, input.cursor?.eventTime ?? null, input.cursor?.itemId ?? null, input.limit + 1]
    );

    const rows = result.rows as AnyRow[];
    const pageRows = rows.slice(0, input.limit);
    const entityMap = await loadEntitiesForItems(
      client,
      pageRows.map((row) => String(row.item_id))
    );
    const items = pageRows.map((row) => mapFeedRow(row, entityMap.get(String(row.item_id)) ?? []));
    const last = items[items.length - 1];
    return {
      items,
      nextCursor: rows.length > input.limit && last ? { eventTime: last.event_time, itemId: last.item_id } : null
    };
  });
}

/** Lightweight poll used by the SSE stream: ids and times of items newer than `sinceIso`. */
export async function queryFeedSince(
  env: Env,
  input: { tab: Exclude<FeedTab, "newsindex">; sinceIso: string; limit: number }
): Promise<Array<{ item_id: string; event_time: string }>> {
  return withDb(env, async (client) => {
    const result = await client.query(
      `
      select ci.item_id, ci.event_time
      from content_items ci
      left join licenses l on l.license_id = ci.license_id
      where ${tabFilter(input.tab)}
        and coalesce(l.commercial_status, 'conditional') = 'allowed'
        and ci.event_time > $1::timestamptz
      order by ci.event_time asc, ci.item_id asc
      limit $2
      `,
      [input.sinceIso, input.limit]
    );
    return (result.rows as AnyRow[]).map((row) => ({ item_id: String(row.item_id), event_time: toIso(row.event_time) }));
  });
}

function toFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value: number, digits: number): number {
  return Number(value.toFixed(digits));
}

/**
 * Key indicator cards.
 * - `change`: latest minus previous observation, in series units ("pp" for % series).
 * - `yoy`: % change versus the observation nearest to exactly one year earlier
 *   (within ±7 days, so weekly/daily series match correctly). Only defined for
 *   level series; series already expressed in % (rates, YoY derivations) get null
 *   because a "% change of a percentage" is not a meaningful YoY figure.
 */
export async function queryIndicators(env: Env): Promise<KeyIndicatorCard[]> {
  return withDb(env, async (client) => {
    const result = await client.query(
      `
      select
        s.series_id,
        s.series_code,
        s.title,
        s.units,
        s.is_derived,
        src.name as source_name,
        src.docs_url as source_policy_url,
        li.code as license_code,
        li.commercial_status,
        li.attribution_template,
        li.required_disclaimer,
        recent.points,
        recent.latest_period,
        year_ago.value_num as year_ago_value
      from series s
      left join sources src on src.source_id = s.source_id
      left join licenses li on li.license_id = s.license_id
      cross join lateral (
        select array_agg(o.value_num order by o.obs_date asc) as points,
               max(o.obs_date) as latest_date,
               (array_agg(o.obs_date::text order by o.obs_date desc))[1] as latest_period
        from (
          select so.obs_date, so.value_num
          from series_observations so
          where so.series_id = s.series_id and so.value_num is not null
          order by so.obs_date desc
          limit 6
        ) o
      ) recent
      left join lateral (
        select so.value_num
        from series_observations so
        where so.series_id = s.series_id
          and so.value_num is not null
          and so.obs_date between (recent.latest_date - interval '1 year' - interval '7 days')::date
                              and (recent.latest_date - interval '1 year' + interval '7 days')::date
        order by abs(so.obs_date - (recent.latest_date - interval '1 year')::date) asc, so.obs_date asc
        limit 1
      ) year_ago on true
      where coalesce(s.raw_locked, false) = false
        and coalesce(li.commercial_status, 'conditional') = 'allowed'
        and recent.points is not null
      order by recent.latest_date desc, s.series_code asc
      limit 10
      `
    );

    return (result.rows as AnyRow[]).map((row) => {
      const points = Array.isArray(row.points)
        ? (row.points as unknown[]).map(toFiniteNumber).filter((value): value is number => value !== null)
        : [];
      const latestValue = points[points.length - 1] ?? 0;
      const previousValue = points.length > 1 ? (points[points.length - 2] ?? null) : null;
      const units = asNullableString(row.units) ?? "";
      const isPercentSeries = units.trim() === "%";
      const yearAgo = toFiniteNumber(row.year_ago_value);
      const yoy =
        !isPercentSeries && yearAgo !== null && Math.abs(yearAgo) > 0.000001
          ? round(((latestValue - yearAgo) / Math.abs(yearAgo)) * 100, 2)
          : null;
      const change = previousValue === null ? null : round(latestValue - previousValue, 4);

      return {
        series_id: String(row.series_id),
        series_code: String(row.series_code),
        title: String(row.title),
        units,
        is_derived: Boolean(row.is_derived),
        latest_value: latestValue,
        period: String(row.latest_period),
        yoy,
        change,
        change_unit: isPercentSeries ? "pp" : units,
        sparkline: points.length > 0 ? points : [latestValue],
        source: {
          name: asNullableString(row.source_name) ?? "Unknown",
          policy_url: asNullableString(row.source_policy_url) ?? ""
        },
        license: {
          code: asNullableString(row.license_code) ?? "UNKNOWN",
          commercial_status: asCommercialStatus(row.commercial_status),
          attribution_text: asNullableString(row.attribution_template) ?? "",
          disclaimer_text: asNullableString(row.required_disclaimer) ?? ""
        }
      } satisfies KeyIndicatorCard;
    });
  });
}

/** Entity with its allowed-license feed items, or null when the entity does not exist. */
export async function queryEntity(
  env: Env,
  slug: string
): Promise<{ entity: { slug: string; name: string; primary_ticker: string | null }; items: FeedItemPayload[] } | null> {
  return withDb(env, async (client) => {
    const entityResult = await client.query(`select slug, name, primary_ticker from entities where slug = $1`, [slug]);
    const entityRow = entityResult.rows[0] as AnyRow | undefined;
    if (!entityRow) {
      return null;
    }

    const itemResult = await client.query(
      `
      ${FEED_SELECT}
      join content_item_entities cie on cie.item_id = ci.item_id
      join entities e on e.entity_id = cie.entity_id
      where e.slug = $1
        and coalesce(l.commercial_status, 'conditional') = 'allowed'
      order by ci.event_time desc, ci.item_id desc
      limit 50
      `,
      [slug]
    );

    const rows = itemResult.rows as AnyRow[];
    const entityMap = await loadEntitiesForItems(
      client,
      rows.map((row) => String(row.item_id))
    );
    return {
      entity: {
        slug: String(entityRow.slug),
        name: String(entityRow.name),
        primary_ticker: asNullableString(entityRow.primary_ticker)
      },
      items: rows.map((row) => mapFeedRow(row, entityMap.get(String(row.item_id)) ?? []))
    };
  });
}

export interface SeriesPayload {
  series_id: string;
  series_code: string;
  title: string;
  mode: "raw" | "derived";
  units: string;
  raw_locked: boolean;
  source: { name: string; policy_url: string };
  license: { code: string; commercial_status: CommercialStatus; attribution_text: string; disclaimer_text?: string };
  observations: SeriesObservation[];
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Series by UUID or public series code (e.g. US_CPI_YOY), restricted to
 * allowed licenses. Returns null when no such public series exists.
 */
export async function querySeries(
  env: Env,
  idOrCode: string,
  mode: "raw" | "derived",
  from: string | null,
  to: string | null
): Promise<SeriesPayload | null> {
  return withDb(env, async (client) => {
    const byId = UUID_PATTERN.test(idOrCode);
    const seriesResult = await client.query(
      `
      select
        s.series_id, s.series_code, s.title, s.units, s.raw_locked,
        src.name as source_name, src.docs_url as source_policy_url,
        li.code as license_code, li.commercial_status, li.attribution_template, li.required_disclaimer
      from series s
      left join sources src on src.source_id = s.source_id
      left join licenses li on li.license_id = s.license_id
      where ${byId ? "s.series_id = $1::uuid" : "s.series_code = $1"}
        and s.is_derived = $2
        and coalesce(li.commercial_status, 'conditional') = 'allowed'
      order by s.updated_at desc
      limit 1
      `,
      [idOrCode, mode === "derived"]
    );
    const row = seriesResult.rows[0] as AnyRow | undefined;
    if (!row) {
      return null;
    }

    const obsResult = await client.query(
      `
      select obs_date::text as obs_date, value_raw, value_num, source_hash
      from series_observations
      where series_id = $1
        and ($2::date is null or obs_date >= $2::date)
        and ($3::date is null or obs_date <= $3::date)
      order by obs_date asc
      limit 5000
      `,
      [row.series_id, from, to]
    );

    return {
      series_id: String(row.series_id),
      series_code: String(row.series_code),
      title: String(row.title),
      mode,
      units: asNullableString(row.units) ?? "",
      raw_locked: Boolean(row.raw_locked),
      source: {
        name: asNullableString(row.source_name) ?? "Unknown",
        policy_url: asNullableString(row.source_policy_url) ?? ""
      },
      license: {
        code: asNullableString(row.license_code) ?? "UNKNOWN",
        commercial_status: asCommercialStatus(row.commercial_status),
        attribution_text: asNullableString(row.attribution_template) ?? "",
        disclaimer_text: asNullableString(row.required_disclaimer) ?? ""
      },
      observations: (obsResult.rows as AnyRow[]).map((obs) => ({
        obs_date: String(obs.obs_date),
        value_raw: String(obs.value_raw),
        value_num: toFiniteNumber(obs.value_num),
        source_hash: asNullableString(obs.source_hash) ?? undefined
      }))
    };
  });
}

export interface FilingPayload {
  accession: string;
  cik: string | null;
  company_name: string | null;
  form_type: string | null;
  filed_at: string | null;
  accepted_at: string | null;
  sec_url: string | null;
  source: { name: string; policy_url: string };
  license: { code: string; commercial_status: CommercialStatus; attribution_text: string; disclaimer_text?: string };
}

/** Filing metadata (explicit columns only) with SEC attribution, or null if unknown. */
export async function queryFiling(env: Env, accession: string): Promise<FilingPayload | null> {
  return withDb(env, async (client) => {
    const result = await client.query(
      `
      select
        f.accession, f.cik, f.company_name, f.form_type, f.filed_at, f.accepted_at, f.sec_url,
        src.name as source_name, src.docs_url as source_policy_url,
        li.code as license_code, li.commercial_status, li.attribution_template, li.required_disclaimer
      from filings f
      left join licenses li on li.code = 'SEC_EDGAR'
      left join sources src on src.name = 'SEC EDGAR'
      where f.accession = $1
      `,
      [accession]
    );
    const row = result.rows[0] as AnyRow | undefined;
    if (!row) {
      return null;
    }
    return {
      accession: String(row.accession),
      cik: asNullableString(row.cik),
      company_name: asNullableString(row.company_name),
      form_type: asNullableString(row.form_type),
      filed_at: row.filed_at ? toIso(row.filed_at) : null,
      accepted_at: row.accepted_at ? toIso(row.accepted_at) : null,
      sec_url: asNullableString(row.sec_url),
      source: {
        name: asNullableString(row.source_name) ?? "SEC EDGAR",
        policy_url: asNullableString(row.source_policy_url) ?? "https://www.sec.gov/"
      },
      license: {
        code: asNullableString(row.license_code) ?? "SEC_EDGAR",
        commercial_status: asCommercialStatus(row.commercial_status),
        attribution_text: asNullableString(row.attribution_template) ?? "Source: SEC EDGAR (official).",
        disclaimer_text: asNullableString(row.required_disclaimer) ?? ""
      }
    };
  });
}

export async function queryLegal(env: Env): Promise<{ sources: AnyRow[]; licenses: AnyRow[] }> {
  return withDb(env, async (client) => {
    const licenses = await client.query(
      `
      select code, name, policy_url, commercial_status, attribution_template, required_disclaimer, last_reviewed_at
      from licenses
      order by code asc
      `
    );
    const sources = await client.query(
      `
      select name, homepage_url, docs_url, updated_at
      from sources
      where active = true
      order by name asc
      `
    );
    return {
      sources: sources.rows as AnyRow[],
      licenses: licenses.rows as AnyRow[]
    };
  });
}

// ---------------------------------------------------------------------------
// User-owned data (push subscriptions, alert rules, notifications)
// ---------------------------------------------------------------------------

function mapAlertRule(row: AnyRow): AlertRuleRecord {
  return {
    rule_id: String(row.rule_id),
    user_id: String(row.user_id),
    enabled: Boolean(row.enabled),
    rule_type: row.rule_type as AlertRuleRecord["rule_type"],
    rule: (row.rule as Record<string, unknown> | null) ?? {},
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at)
  };
}

const ALERT_RULE_COLUMNS = "rule_id, user_id, enabled, rule_type, rule, created_at, updated_at";

export async function listAlertRules(env: Env, userId: string): Promise<AlertRuleRecord[]> {
  return withDb(env, async (client) => {
    const rows = await client.query(
      `select ${ALERT_RULE_COLUMNS} from alert_rules where user_id = $1::uuid order by created_at desc`,
      [userId]
    );
    return (rows.rows as AnyRow[]).map(mapAlertRule);
  });
}

export type SaveAlertRuleResult =
  | { status: "saved"; rule: AlertRuleRecord }
  | { status: "not_found" }
  | { status: "limit_reached" };

/**
 * Inserts a rule (subject to `maxRulesPerUser`) or updates the caller's own
 * rule. Updating a rule that does not exist or belongs to someone else
 * returns not_found.
 */
export async function saveAlertRule(
  env: Env,
  userId: string,
  input: Pick<AlertRuleRecord, "rule_type" | "rule" | "enabled"> & { rule_id?: string },
  maxRulesPerUser: number
): Promise<SaveAlertRuleResult> {
  return withDb(env, async (client) => {
    if (input.rule_id) {
      const updated = await client.query(
        `
        update alert_rules
        set enabled = $3, rule_type = $4, rule = $5::jsonb, updated_at = now()
        where rule_id = $1::uuid and user_id = $2::uuid
        returning ${ALERT_RULE_COLUMNS}
        `,
        [input.rule_id, userId, input.enabled, input.rule_type, JSON.stringify(input.rule)]
      );
      const row = updated.rows[0] as AnyRow | undefined;
      return row ? { status: "saved", rule: mapAlertRule(row) } : { status: "not_found" };
    }

    const inserted = await client.query(
      `
      insert into alert_rules (user_id, enabled, rule_type, rule)
      select $1::uuid, $2, $3, $4::jsonb
      where (select count(*) from alert_rules where user_id = $1::uuid) < $5
      returning ${ALERT_RULE_COLUMNS}
      `,
      [userId, input.enabled, input.rule_type, JSON.stringify(input.rule), maxRulesPerUser]
    );
    const row = inserted.rows[0] as AnyRow | undefined;
    return row ? { status: "saved", rule: mapAlertRule(row) } : { status: "limit_reached" };
  });
}

export async function deleteAlertRule(env: Env, userId: string, ruleId: string): Promise<boolean> {
  return withDb(env, async (client) => {
    const deleted = await client.query(`delete from alert_rules where rule_id = $1::uuid and user_id = $2::uuid`, [
      ruleId,
      userId
    ]);
    return (deleted.rowCount ?? 0) > 0;
  });
}

export interface EncryptedSubscriptionInput {
  userId: string;
  endpointHash: string;
  endpointEnc: string;
  endpointIv: string;
  p256dhEnc: string;
  p256dhIv: string;
  authEnc: string;
  authIv: string;
  filters: Record<string, unknown>;
}

/** Atomic upsert keyed by (user_id, endpoint_hash). */
export async function upsertPushSubscription(env: Env, input: EncryptedSubscriptionInput): Promise<{ subscription_id: string }> {
  return withDb(env, async (client) => {
    const result = await client.query(
      `
      insert into push_subscriptions (
        user_id, endpoint_hash, endpoint_enc, enc_iv, p256dh_enc, p256dh_iv, auth_enc, auth_iv, filters, last_seen_at
      )
      values ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, now())
      on conflict (user_id, endpoint_hash) where endpoint_hash is not null
      do update set
        endpoint_enc = excluded.endpoint_enc,
        enc_iv = excluded.enc_iv,
        p256dh_enc = excluded.p256dh_enc,
        p256dh_iv = excluded.p256dh_iv,
        auth_enc = excluded.auth_enc,
        auth_iv = excluded.auth_iv,
        filters = excluded.filters,
        last_seen_at = now()
      returning subscription_id
      `,
      [
        input.userId,
        input.endpointHash,
        input.endpointEnc,
        input.endpointIv,
        input.p256dhEnc,
        input.p256dhIv,
        input.authEnc,
        input.authIv,
        JSON.stringify(input.filters)
      ]
    );
    return { subscription_id: String((result.rows[0] as AnyRow).subscription_id) };
  });
}

export async function removePushSubscription(env: Env, userId: string, endpointHash: string): Promise<boolean> {
  return withDb(env, async (client) => {
    const deleted = await client.query(
      `delete from push_subscriptions where user_id = $1::uuid and endpoint_hash = $2`,
      [userId, endpointHash]
    );
    return (deleted.rowCount ?? 0) > 0;
  });
}

export async function removePushSubscriptionById(env: Env, subscriptionId: string): Promise<void> {
  await withDb(env, async (client) => {
    await client.query(`delete from push_subscriptions where subscription_id = $1::uuid`, [subscriptionId]);
  });
}

export interface PushTarget {
  userId: string;
  rules: AlertRuleRecord[];
  subscriptions: PushSubscriptionRecord[];
}

/**
 * Users with at least one enabled rule and at least one decryptable
 * subscription, loaded in two queries (no per-user round trips).
 */
export async function listPushTargets(env: Env): Promise<PushTarget[]> {
  return withDb(env, async (client) => {
    const subscriptions = await client.query(
      `
      select subscription_id, user_id, endpoint_hash, endpoint_enc, enc_iv, p256dh_enc, p256dh_iv,
             auth_enc, auth_iv, filters, created_at, last_seen_at
      from push_subscriptions ps
      where ps.p256dh_iv is not null
        and ps.auth_iv is not null
        and exists (select 1 from alert_rules ar where ar.user_id = ps.user_id and ar.enabled = true)
      `
    );
    const subsRows = subscriptions.rows as AnyRow[];
    if (subsRows.length === 0) {
      return [];
    }
    const userIds = [...new Set(subsRows.map((row) => String(row.user_id)))];
    const rules = await client.query(
      `select ${ALERT_RULE_COLUMNS} from alert_rules where enabled = true and user_id = any($1::uuid[])`,
      [userIds]
    );

    const byUser = new Map<string, PushTarget>();
    for (const userId of userIds) {
      byUser.set(userId, { userId, rules: [], subscriptions: [] });
    }
    for (const row of rules.rows as AnyRow[]) {
      byUser.get(String(row.user_id))?.rules.push(mapAlertRule(row));
    }
    for (const row of subsRows) {
      byUser.get(String(row.user_id))?.subscriptions.push({
        subscription_id: String(row.subscription_id),
        user_id: String(row.user_id),
        endpoint_hash: String(row.endpoint_hash ?? ""),
        endpoint_enc: String(row.endpoint_enc),
        endpoint_iv: String(row.enc_iv),
        p256dh_enc: String(row.p256dh_enc),
        p256dh_iv: String(row.p256dh_iv),
        auth_enc: String(row.auth_enc),
        auth_iv: String(row.auth_iv),
        filters: (row.filters as Record<string, unknown> | null) ?? {},
        created_at: toIso(row.created_at),
        last_seen_at: row.last_seen_at ? toIso(row.last_seen_at) : undefined
      });
    }
    return [...byUser.values()].filter((target) => target.rules.length > 0 && target.subscriptions.length > 0);
  });
}

/**
 * Atomically registers a notification: at most one per (user, item) via the
 * unique index, and at most `hourlyCap` per user per rolling hour.
 * Returns null when it is a duplicate or the cap is reached.
 */
export async function registerNotificationEvent(
  env: Env,
  input: { userId: string; itemId: string; payload: Record<string, unknown>; hourlyCap: number }
): Promise<NotificationEventRecord | null> {
  return withDb(env, async (client) => {
    const inserted = await client.query(
      `
      insert into notification_events (user_id, item_id, payload, status)
      select $1::uuid, $2::uuid, $3::jsonb, 'queued'
      where (
        select count(*) from notification_events
        where user_id = $1::uuid and created_at >= now() - interval '1 hour'
      ) < $4
      on conflict (user_id, item_id) do nothing
      returning notification_id, user_id, item_id, created_at, payload, status
      `,
      [input.userId, input.itemId, JSON.stringify(input.payload), input.hourlyCap]
    );
    const row = inserted.rows[0] as AnyRow | undefined;
    if (!row) {
      return null;
    }
    return {
      notification_id: String(row.notification_id),
      user_id: String(row.user_id),
      item_id: String(row.item_id),
      created_at: toIso(row.created_at),
      payload: (row.payload as Record<string, unknown>) ?? {},
      status: row.status as NotificationEventRecord["status"]
    };
  });
}

export async function setNotificationStatus(
  env: Env,
  notificationId: string,
  status: NotificationEventRecord["status"],
  error: string | null = null
): Promise<void> {
  await withDb(env, async (client) => {
    await client.query(`update notification_events set status = $2, error = $3 where notification_id = $1::uuid`, [
      notificationId,
      status,
      error
    ]);
  });
}

/** Removes every app-side record owned by the user (GDPR erasure of app data). */
export async function deleteUserData(
  env: Env,
  userId: string
): Promise<{ push_subscriptions: number; alert_rules: number; notification_events: number }> {
  return withDb(env, async (client) => {
    const subs = await client.query(`delete from push_subscriptions where user_id = $1::uuid`, [userId]);
    const rules = await client.query(`delete from alert_rules where user_id = $1::uuid`, [userId]);
    const events = await client.query(`delete from notification_events where user_id = $1::uuid`, [userId]);
    return {
      push_subscriptions: subs.rowCount ?? 0,
      alert_rules: rules.rowCount ?? 0,
      notification_events: events.rowCount ?? 0
    };
  });
}

/** Retention: deletes ephemeral index items and old notification events. */
export async function applyRetention(
  env: Env,
  input: { gdeltDays: number; notificationDays: number }
): Promise<{ gdelt_items: number; notification_events: number }> {
  return withDb(env, async (client) => {
    const gdelt = await client.query(
      `delete from content_items where item_type = 'gdelt_link' and event_time < now() - make_interval(days => $1)`,
      [input.gdeltDays]
    );
    const events = await client.query(
      `delete from notification_events where created_at < now() - make_interval(days => $1)`,
      [input.notificationDays]
    );
    return { gdelt_items: gdelt.rowCount ?? 0, notification_events: events.rowCount ?? 0 };
  });
}
