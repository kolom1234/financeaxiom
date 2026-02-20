import { Client } from "pg";
import type { FeedItemPayload } from "@ofp/shared";
import type { AlertRuleRecord, Env, NotificationEventRecord, PushSubscriptionRecord, KeyIndicatorCard, SeriesObservation } from "../types";

type PgClient = InstanceType<typeof Client>;
type AnyRow = Record<string, unknown>;

const GDELT_SEARCH_BASE_URL = "https://api.gdeltproject.org/api/v2/doc/doc";
const GDELT_MAX_RECORDS = 5;
const GDELT_DOC_PATH = "/api/v2/doc/doc";

interface EntityInfo {
  name: string;
  slug?: string;
}

export interface MappedFeedItemInput {
  externalUrl: string | null;
  itemType: FeedItemPayload["item_type"];
  headline: string;
  entities: EntityInfo[];
}

function safeTrim(value: string | null | undefined): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function normalizeHttpUrl(value: string | null | undefined): string | null {
  const trimmed = safeTrim(value);
  if (!trimmed || trimmed.toLowerCase() === "about:blank") {
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return null;
    }
    const isLegacyGdeltHome =
      parsed.hostname.toLowerCase() === "www.gdeltproject.org" &&
      (parsed.pathname === "/" || parsed.pathname === "" || !parsed.pathname.toLowerCase().includes("/api/"));
    if (isLegacyGdeltHome) {
      return null;
    }
    return normalizeGdeltSearchUrl(parsed.toString());
  } catch {
    return null;
  }
}

function normalizeGdeltSearchUrl(value: string): string {
  try {
    const parsed = new URL(value);
    if (parsed.hostname.toLowerCase() !== "api.gdeltproject.org") {
      return value;
    }
    if (!parsed.pathname.startsWith(`${GDELT_DOC_PATH}/`) && parsed.pathname !== GDELT_DOC_PATH) {
      return value;
    }
    parsed.pathname = GDELT_DOC_PATH;

    parsed.searchParams.set("maxrecords", String(GDELT_MAX_RECORDS));
    return parsed.toString();
  } catch {
    return value;
  }
}

function buildGdeltSearchUrl(entity: string): string {
  return `${GDELT_SEARCH_BASE_URL}?query=${encodeURIComponent(entity.trim())}&mode=artlist&format=html&sort=datedesc&maxrecords=${GDELT_MAX_RECORDS}`;
}

function extractGdeltQueryFromHeadline(headline: string): string | null {
  const match = headline.match(/^(.*?)\s+(?:index\s+activity|mentions\s+spike)\b/i);
  return match?.[1]?.trim() ?? null;
}

export function resolveOpenSourceUrl(input: MappedFeedItemInput): string | null {
  const direct = normalizeHttpUrl(input.externalUrl);
  if (direct) {
    return direct;
  }

  if (input.itemType !== "gdelt_link") {
    return null;
  }

  const fromHeadline = extractGdeltQueryFromHeadline(input.headline);
  const fromEntity =
    input.entities.find((entity) => entity.name.trim().length > 0)?.name.trim() ||
    input.entities.find((entity) => entity.slug && entity.slug.trim().length > 0)?.slug?.trim() ||
    "";

  const query = fromHeadline || fromEntity;
  if (!query) {
    return null;
  }

  return buildGdeltSearchUrl(query);
}

function getConnectionString(env: Env): string | null {
  const fromHyperdrive = (env.HYPERDRIVE as { connectionString?: string } | undefined)?.connectionString;
  const fromEnv = env.DATABASE_URL;
  return fromHyperdrive ?? fromEnv ?? null;
}

async function withClient<T>(env: Env, fn: (client: PgClient) => Promise<T>): Promise<T | null> {
  const connectionString = getConnectionString(env);
  if (!connectionString) {
    return null;
  }
  const client = new Client({ connectionString });
  await client.connect();
  try {
    return await fn(client);
  } catch {
    return null;
  } finally {
    await client.end();
  }
}

function tabFilter(tab: "breaking" | "filings" | "macro" | "newsindex"): string {
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

function parseNumericArray(value: unknown): number[] {
  if (Array.isArray(value)) {
    return value.map((entry) => Number(entry)).filter((entry) => Number.isFinite(entry));
  }

  if (typeof value === "string") {
    const trimmed = value.replace(/^\{/, "").replace(/\}$/, "");
    if (!trimmed) {
      return [];
    }
    return trimmed
      .split(",")
      .map((entry) => Number(entry))
      .filter((entry) => Number.isFinite(entry));
  }

  return [];
}

export async function fetchFeedFromDb(
  env: Env,
  input: {
    tab: "breaking" | "filings" | "macro" | "newsindex";
    query: string;
    region: string;
    limit: number;
    offset: number;
  }
): Promise<FeedItemPayload[] | null> {
  return withClient(env, async (client) => {
    const sql = `
      select
        ci.item_id,
        ci.item_type,
        ci.event_time,
        ci.headline_generated as headline,
        ci.summary_generated as summary,
        ci.meta as meta,
        ci.external_url,
        coalesce(s.name, 'Unknown') as source_name,
        coalesce(s.docs_url, '') as source_policy_url,
        coalesce(l.code, 'UNKNOWN') as license_code,
        coalesce(l.commercial_status, 'conditional') as commercial_status,
        coalesce(l.attribution_template, '') as attribution_text,
        coalesce(l.required_disclaimer, '') as disclaimer_text
      from content_items ci
      left join sources s on s.source_id = ci.source_id
      left join licenses l on l.license_id = ci.license_id
      where ${tabFilter(input.tab)}
        and (
          $1 = ''
          or ci.headline_generated ilike '%' || $1 || '%'
          or coalesce(ci.summary_generated, '') ilike '%' || $1 || '%'
          or coalesce(s.name, '') ilike '%' || $1 || '%'
          or exists (
            select 1
            from content_item_entities cie_match
            join entities e_match on e_match.entity_id = cie_match.entity_id
            where cie_match.item_id = ci.item_id
              and (
                e_match.name ilike '%' || $1 || '%'
                or e_match.slug ilike '%' || $1 || '%'
                or coalesce(e_match.primary_ticker, '') ilike '%' || $1 || '%'
              )
          )
        )
        and ($2 = 'GLOBAL' or ci.region = $2 or ci.region = 'GLOBAL')
        and coalesce(l.commercial_status, 'conditional') = 'allowed'
      order by ci.event_time desc
      limit $3 offset $4
    `;

    const result = await client.query(sql, [input.query, input.region, input.limit, input.offset]);
    const itemIds = result.rows.map((row: AnyRow) => row.item_id as string);

    const entityMap = new Map<string, FeedItemPayload["entities"]>();
    if (itemIds.length > 0) {
      const entityRows = await client.query(
        `
          select
            cie.item_id,
            e.slug,
            e.name,
            e.primary_ticker
          from content_item_entities cie
          join entities e on e.entity_id = cie.entity_id
          where cie.item_id = any($1::uuid[])
        `,
        [itemIds]
      );
      for (const row of entityRows.rows) {
        const current = entityMap.get(row.item_id) ?? [];
        current.push({
          slug: row.slug as string,
          name: row.name as string,
          primary_ticker: (row.primary_ticker as string | null) ?? undefined
        });
        entityMap.set(row.item_id as string, current);
      }
    }

    return result.rows.map((row: AnyRow) => ({
      item_id: row.item_id as string,
      item_type: row.item_type as FeedItemPayload["item_type"],
      event_time: new Date(row.event_time as string).toISOString(),
      headline: row.headline as string,
      summary: (row.summary as string | null) ?? null,
      meta: (row.meta as Record<string, unknown> | null) ?? undefined,
      external_url: resolveOpenSourceUrl({
        externalUrl: (row.external_url as string | null) ?? null,
        itemType: row.item_type as FeedItemPayload["item_type"],
        headline: row.headline as string,
        entities: entityMap.get(row.item_id as string) ?? []
      }),
      entities: entityMap.get(row.item_id as string) ?? [],
      source: {
        name: row.source_name as string,
        policy_url: row.source_policy_url as string
      },
      license: {
        code: row.license_code as string,
        commercial_status: row.commercial_status as "allowed" | "conditional" | "disallowed",
        attribution_text: row.attribution_text as string,
        disclaimer_text: row.disclaimer_text as string
      }
    }));
  });
}

export async function fetchIndicatorsFromDb(env: Env): Promise<KeyIndicatorCard[] | null> {
  return withClient(env, async (client) => {
    const result = await client.query(
      `
      with observed as (
        select
          s.series_id,
          s.title,
          s.source_id,
          s.license_id,
          so.obs_date,
          so.value_num,
          row_number() over (partition by s.series_id order by so.obs_date desc) as rn
        from series s
        join series_observations so on so.series_id = s.series_id
        where so.value_num is not null
          and coalesce(s.raw_locked, false) = false
      ),
      aggregated as (
        select
          o.series_id,
          (array_agg(o.title order by o.obs_date desc))[1] as title,
          (array_agg(o.source_id order by o.obs_date desc))[1] as source_id,
          (array_agg(o.license_id order by o.obs_date desc))[1] as license_id,
          max(o.obs_date) filter (where o.rn = 1) as latest_period,
          max(o.value_num) filter (where o.rn = 1) as latest_value,
          max(o.value_num) filter (where o.rn = 2) as previous_value,
          array_agg(o.value_num order by o.obs_date asc) filter (where o.rn <= 6) as sparkline_values
        from observed o
        group by o.series_id
      )
      select
        a.series_id,
        a.title,
        a.latest_period as obs_date,
        a.latest_value as value_num,
        a.previous_value,
        a.sparkline_values,
        src.name as source_name,
        src.docs_url as source_policy_url,
        li.code as license_code,
        li.commercial_status,
        li.attribution_template
      from aggregated a
      left join sources src on src.source_id = a.source_id
      left join licenses li on li.license_id = a.license_id
      where coalesce(li.commercial_status, 'conditional') = 'allowed'
      order by a.latest_period desc
      limit 10
    `
    );

    return result.rows.map((row: AnyRow) => {
      const latestValue = Number(row.value_num ?? 0);
      const previousValueRaw = row.previous_value;
      const previousValue =
        previousValueRaw === null || previousValueRaw === undefined ? null : Number(previousValueRaw);
      const sparkline = parseNumericArray(row.sparkline_values);
      const yoy =
        previousValue === null || Math.abs(previousValue) < 0.000001
          ? 0
          : Number((((latestValue - previousValue) / Math.abs(previousValue)) * 100).toFixed(1));

      return {
        series_id: row.series_id as string,
        title: row.title as string,
        latest_value: latestValue,
        period: String(row.obs_date),
        yoy,
        sparkline: sparkline.length > 0 ? sparkline : [latestValue],
        source: {
          name: (row.source_name as string) ?? "Unknown",
          policy_url: (row.source_policy_url as string) ?? ""
        },
        license: {
          code: (row.license_code as string) ?? "UNKNOWN",
          commercial_status: (row.commercial_status as "allowed" | "conditional" | "disallowed") ?? "conditional",
          attribution_text: (row.attribution_template as string) ?? ""
        }
      };
    });
  });
}

export async function fetchEntityFromDb(
  env: Env,
  slug: string
): Promise<{ entity: { slug: string; name: string }; items: FeedItemPayload[] } | null> {
  return withClient(env, async (client) => {
    const entityResult = await client.query(`select slug, name from entities where slug = $1`, [slug]);
    if (entityResult.rowCount === 0) {
      return { entity: { slug, name: slug }, items: [] };
    }

    const itemResult = await client.query(
      `
      select
        ci.item_id,
        ci.item_type,
        ci.event_time,
        ci.headline_generated as headline,
        ci.summary_generated as summary,
        ci.meta as meta,
        ci.external_url,
        src.name as source_name,
        src.docs_url as source_policy_url,
        li.code as license_code,
        li.commercial_status,
        li.attribution_template
      from content_item_entities cie
      join entities e on e.entity_id = cie.entity_id
      join content_items ci on ci.item_id = cie.item_id
      left join sources src on src.source_id = ci.source_id
      left join licenses li on li.license_id = ci.license_id
      where e.slug = $1
        and coalesce(li.commercial_status, 'conditional') = 'allowed'
      order by ci.event_time desc
      limit 50
    `,
      [slug]
    );

    const entityName = String(entityResult.rows[0].name);
    const entitySlug = String(entityResult.rows[0].slug);

    return {
      entity: {
        slug: entityResult.rows[0].slug as string,
        name: entityResult.rows[0].name as string
      },
      items: itemResult.rows.map((row: AnyRow) => ({
        item_id: row.item_id as string,
        item_type: row.item_type as FeedItemPayload["item_type"],
        event_time: new Date(row.event_time as string).toISOString(),
        headline: row.headline as string,
        summary: (row.summary as string | null) ?? null,
        meta: (row.meta as Record<string, unknown> | null) ?? undefined,
        external_url: resolveOpenSourceUrl({
          externalUrl: (row.external_url as string | null) ?? null,
          itemType: row.item_type as FeedItemPayload["item_type"],
          headline: row.headline as string,
          entities: [{ slug: entitySlug, name: entityName }]
        }),
        entities: [{ slug: slug, name: entityName }],
        source: {
          name: (row.source_name as string) ?? "Unknown",
          policy_url: (row.source_policy_url as string) ?? ""
        },
        license: {
          code: (row.license_code as string) ?? "UNKNOWN",
          commercial_status: (row.commercial_status as "allowed" | "conditional" | "disallowed") ?? "conditional",
          attribution_text: (row.attribution_template as string) ?? ""
        }
      }))
    };
  });
}

export async function fetchSeriesFromDb(
  env: Env,
  seriesId: string,
  mode: "raw" | "derived",
  from?: string | null,
  to?: string | null
): Promise<
  | {
      series_id: string;
      title: string;
      mode: "raw" | "derived";
      units: string;
      raw_locked: boolean;
      source: { name: string; policy_url: string };
      license: { code: string; commercial_status: "allowed" | "conditional" | "disallowed"; attribution_text: string };
      observations: SeriesObservation[];
    }
  | null
> {
  return withClient(env, async (client) => {
    const seriesResult = await client.query(
      `
      select
        s.series_id,
        s.title,
        s.units,
        s.raw_locked,
        src.name as source_name,
        src.docs_url as source_policy_url,
        li.code as license_code,
        li.commercial_status,
        li.attribution_template
      from series s
      left join sources src on src.source_id = s.source_id
      left join licenses li on li.license_id = s.license_id
      where s.series_id = $1
        and s.is_derived = $2
        and coalesce(li.commercial_status, 'conditional') = 'allowed'
    `,
      [seriesId, mode === "derived"]
    );

    if (seriesResult.rowCount === 0) {
      return null;
    }

    const obsResult = await client.query(
      `
      select obs_date, value_raw, value_num, source_hash
      from series_observations
      where series_id = $1
        and ($2::date is null or obs_date >= $2::date)
        and ($3::date is null or obs_date <= $3::date)
      order by obs_date asc
    `,
      [seriesId, from ?? null, to ?? null]
    );

    const row = seriesResult.rows[0];
    return {
      series_id: row.series_id as string,
      title: row.title as string,
      mode,
      units: (row.units as string) ?? "",
      raw_locked: Boolean(row.raw_locked),
      source: {
        name: (row.source_name as string) ?? "Unknown",
        policy_url: (row.source_policy_url as string) ?? ""
      },
      license: {
        code: (row.license_code as string) ?? "UNKNOWN",
        commercial_status: (row.commercial_status as "allowed" | "conditional" | "disallowed") ?? "conditional",
        attribution_text: (row.attribution_template as string) ?? ""
      },
      observations: obsResult.rows.map((obs: AnyRow) => ({
        obs_date: String(obs.obs_date),
        value_raw: String(obs.value_raw),
        value_num: (obs.value_num as number | null) ?? null,
        source_hash: (obs.source_hash as string | null) ?? undefined
      }))
    };
  });
}

export async function fetchFilingFromDb(env: Env, accession: string): Promise<Record<string, unknown> | null> {
  return withClient(env, async (client) => {
    const result = await client.query(`select * from filings where accession = $1`, [accession]);
    if (result.rowCount === 0) {
      return null;
    }
    return result.rows[0] as Record<string, unknown>;
  });
}

export async function fetchLegalFromDb(env: Env): Promise<Record<string, unknown> | null> {
  return withClient(env, async (client) => {
    const [licenses, sources] = await Promise.all([
      client.query(
        `
        select
          code,
          name,
          policy_url,
          commercial_status,
          attribution_template,
          required_disclaimer,
          last_reviewed_at
        from licenses
        order by code asc
      `
      ),
      client.query(
        `
        select
          name,
          homepage_url,
          docs_url,
          updated_at
        from sources
        where active = true
        order by name asc
      `
      )
    ]);

    return {
      sources: sources.rows,
      licenses: licenses.rows
    };
  });
}

export async function upsertPushSubscriptionInDb(
  env: Env,
  input: {
    userId: string;
    endpointHash: string;
    endpointEnc: string;
    p256dhEnc: string;
    authEnc: string;
    encIv: string;
    filters: Record<string, unknown>;
  }
): Promise<{ subscription_id: string } | undefined> {
  if (!getConnectionString(env)) {
    return undefined;
  }

  const result = await withClient(env, async (client) => {
    const mergedFilters = {
      ...input.filters,
      endpoint_hash: input.endpointHash
    };
    const serializedFilters = JSON.stringify(mergedFilters);

    const updated = await client.query(
      `
      update push_subscriptions
      set
        endpoint_enc = $3,
        p256dh_enc = $4,
        auth_enc = $5,
        enc_iv = $6,
        filters = $7::jsonb,
        last_seen_at = now()
      where user_id = $1::uuid
        and coalesce(filters->>'endpoint_hash', '') = $2
      returning subscription_id
    `,
      [input.userId, input.endpointHash, input.endpointEnc, input.p256dhEnc, input.authEnc, input.encIv, serializedFilters]
    );

    if (updated.rowCount && updated.rowCount > 0) {
      return { subscription_id: String(updated.rows[0].subscription_id) };
    }

    const inserted = await client.query(
      `
      insert into push_subscriptions (
        user_id,
        endpoint_enc,
        p256dh_enc,
        auth_enc,
        enc_iv,
        filters
      )
      values ($1::uuid, $2, $3, $4, $5, $6::jsonb)
      returning subscription_id
    `,
      [input.userId, input.endpointEnc, input.p256dhEnc, input.authEnc, input.encIv, serializedFilters]
    );

    return { subscription_id: String(inserted.rows[0].subscription_id) };
  });

  return result ?? undefined;
}

export async function removePushSubscriptionInDb(
  env: Env,
  userId: string,
  endpointHash: string
): Promise<boolean | undefined> {
  if (!getConnectionString(env)) {
    return undefined;
  }

  const result = await withClient(env, async (client) => {
    const deleted = await client.query(
      `
      delete from push_subscriptions
      where user_id = $1::uuid
        and coalesce(filters->>'endpoint_hash', '') = $2
    `,
      [userId, endpointHash]
    );
    return (deleted.rowCount ?? 0) > 0;
  });

  return result ?? undefined;
}

export async function listAlertRulesFromDb(env: Env, userId: string): Promise<AlertRuleRecord[] | undefined> {
  if (!getConnectionString(env)) {
    return undefined;
  }

  const result = await withClient(env, async (client) => {
    const rows = await client.query(
      `
      select
        rule_id,
        user_id,
        enabled,
        rule_type,
        rule,
        created_at,
        updated_at
      from alert_rules
      where user_id = $1::uuid
      order by created_at desc
    `,
      [userId]
    );

    return rows.rows.map((row: AnyRow) => ({
      rule_id: String(row.rule_id),
      user_id: String(row.user_id),
      enabled: Boolean(row.enabled),
      rule_type: row.rule_type as AlertRuleRecord["rule_type"],
      rule: (row.rule as Record<string, unknown>) ?? {},
      created_at: new Date(String(row.created_at)).toISOString(),
      updated_at: new Date(String(row.updated_at)).toISOString()
    }));
  });

  return result ?? undefined;
}

export async function saveAlertRuleInDb(
  env: Env,
  userId: string,
  input: Pick<AlertRuleRecord, "rule_type" | "rule" | "enabled"> & { rule_id?: string }
): Promise<AlertRuleRecord | undefined> {
  if (!getConnectionString(env)) {
    return undefined;
  }

  const result = await withClient(env, async (client) => {
    if (input.rule_id) {
      const updated = await client.query(
        `
        update alert_rules
        set
          enabled = $3,
          rule_type = $4,
          rule = $5::jsonb,
          updated_at = now()
        where rule_id = $1::uuid
          and user_id = $2::uuid
        returning rule_id, user_id, enabled, rule_type, rule, created_at, updated_at
      `,
        [input.rule_id, userId, input.enabled, input.rule_type, JSON.stringify(input.rule ?? {})]
      );

      if (!updated.rowCount) {
        return null;
      }

      const row = updated.rows[0];
      return {
        rule_id: String(row.rule_id),
        user_id: String(row.user_id),
        enabled: Boolean(row.enabled),
        rule_type: row.rule_type as AlertRuleRecord["rule_type"],
        rule: (row.rule as Record<string, unknown>) ?? {},
        created_at: new Date(String(row.created_at)).toISOString(),
        updated_at: new Date(String(row.updated_at)).toISOString()
      };
    }

    const inserted = await client.query(
      `
      insert into alert_rules (user_id, enabled, rule_type, rule)
      values ($1::uuid, $2, $3, $4::jsonb)
      returning rule_id, user_id, enabled, rule_type, rule, created_at, updated_at
    `,
      [userId, input.enabled, input.rule_type, JSON.stringify(input.rule ?? {})]
    );

    const row = inserted.rows[0];
    return {
      rule_id: String(row.rule_id),
      user_id: String(row.user_id),
      enabled: Boolean(row.enabled),
      rule_type: row.rule_type as AlertRuleRecord["rule_type"],
      rule: (row.rule as Record<string, unknown>) ?? {},
      created_at: new Date(String(row.created_at)).toISOString(),
      updated_at: new Date(String(row.updated_at)).toISOString()
    };
  });

  return result ?? undefined;
}

export async function listPushUsersFromDb(env: Env): Promise<string[] | undefined> {
  if (!getConnectionString(env)) {
    return undefined;
  }

  const result = await withClient(env, async (client) => {
    const rows = await client.query(
      `
      select distinct ps.user_id
      from push_subscriptions ps
      where exists (
        select 1
        from alert_rules ar
        where ar.user_id = ps.user_id
          and ar.enabled = true
      )
    `
    );
    return rows.rows.map((row: AnyRow) => String(row.user_id));
  });

  return result ?? undefined;
}

export async function listPushSubscriptionsForUserFromDb(
  env: Env,
  userId: string
): Promise<PushSubscriptionRecord[] | undefined> {
  if (!getConnectionString(env)) {
    return undefined;
  }

  const result = await withClient(env, async (client) => {
    const rows = await client.query(
      `
      select
        subscription_id,
        user_id,
        endpoint_enc,
        p256dh_enc,
        auth_enc,
        enc_iv,
        filters,
        created_at,
        last_seen_at
      from push_subscriptions
      where user_id = $1::uuid
      order by created_at desc
    `,
      [userId]
    );

    return rows.rows.map((row: AnyRow) => ({
      subscription_id: String(row.subscription_id),
      user_id: String(row.user_id),
      endpoint_hash: String((row.filters as Record<string, unknown> | null)?.endpoint_hash ?? ""),
      endpoint_enc: String(row.endpoint_enc),
      p256dh_enc: String(row.p256dh_enc),
      auth_enc: String(row.auth_enc),
      enc_iv: String(row.enc_iv),
      filters: (row.filters as Record<string, unknown>) ?? {},
      created_at: new Date(String(row.created_at)).toISOString(),
      last_seen_at: row.last_seen_at ? new Date(String(row.last_seen_at)).toISOString() : undefined
    }));
  });

  return result ?? undefined;
}

export async function registerNotificationEventInDb(
  env: Env,
  input: {
    userId: string;
    itemId: string;
    payload: Record<string, unknown>;
  }
): Promise<NotificationEventRecord | null | undefined> {
  if (!getConnectionString(env)) {
    return undefined;
  }

  const result = await withClient(env, async (client) => {
    const duplicate = await client.query(
      `
      select notification_id
      from notification_events
      where user_id = $1::uuid
        and item_id = $2::uuid
      limit 1
    `,
      [input.userId, input.itemId]
    );
    if ((duplicate.rowCount ?? 0) > 0) {
      return { blocked: true as const };
    }

    const recentCount = await client.query(
      `
      select count(*)::int as count
      from notification_events
      where user_id = $1::uuid
        and created_at >= now() - interval '1 hour'
    `,
      [input.userId]
    );
    const count = Number(recentCount.rows[0]?.count ?? 0);
    if (count >= 10) {
      return { blocked: true as const };
    }

    const inserted = await client.query(
      `
      insert into notification_events (user_id, item_id, payload, status)
      values ($1::uuid, $2::uuid, $3::jsonb, 'queued')
      returning notification_id, user_id, item_id, created_at, payload, status
    `,
      [input.userId, input.itemId, JSON.stringify(input.payload)]
    );
    const row = inserted.rows[0] as AnyRow;
    return {
      blocked: false as const,
      event: {
        notification_id: String(row.notification_id),
        user_id: String(row.user_id),
        item_id: String(row.item_id),
        created_at: new Date(String(row.created_at)).toISOString(),
        payload: (row.payload as Record<string, unknown>) ?? {},
        status: row.status as NotificationEventRecord["status"]
      }
    };
  });

  if (result === null) {
    return undefined;
  }
  if (result.blocked) {
    return null;
  }
  return result.event;
}

export async function setNotificationStatusInDb(
  env: Env,
  notificationId: string,
  status: NotificationEventRecord["status"]
): Promise<boolean | undefined> {
  if (!getConnectionString(env)) {
    return undefined;
  }

  const result = await withClient(env, async (client) => {
    const updated = await client.query(
      `
      update notification_events
      set status = $2
      where notification_id = $1::uuid
    `,
      [notificationId, status]
    );
    return (updated.rowCount ?? 0) > 0;
  });

  return result ?? undefined;
}
