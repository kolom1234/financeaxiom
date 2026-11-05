-- 0005: data integrity, query indexes, push key IVs, RLS write lockdown.
-- Every step is idempotent and non-destructive except where noted (exact
-- duplicate push subscriptions are collapsed to the most recent row).

-- -------------------------------------------------------------------
-- 1) Content de-duplication: a real column + unique index replaces the
--    racy "insert ... where not exists (meta->>'dedupe_key')" pattern.
-- -------------------------------------------------------------------
alter table public.content_items add column if not exists dedupe_key text;

update public.content_items
set dedupe_key = meta->>'dedupe_key'
where dedupe_key is null
  and meta ? 'dedupe_key';

-- Keep the newest row per (source_id, dedupe_key); older duplicates keep their
-- data but lose the key so the unique index can be created.
with ranked as (
  select
    item_id,
    row_number() over (
      partition by source_id, dedupe_key
      order by event_time desc, created_at desc, item_id desc
    ) as rn
  from public.content_items
  where dedupe_key is not null
)
update public.content_items ci
set dedupe_key = null
from ranked r
where ci.item_id = r.item_id
  and r.rn > 1;

create unique index if not exists uq_content_items_source_dedupe
  on public.content_items (source_id, dedupe_key)
  where dedupe_key is not null;

-- -------------------------------------------------------------------
-- 2) Read-path indexes.
-- -------------------------------------------------------------------
-- Entity pages join content_item_entities by entity_id (PK is item_id-first).
create index if not exists idx_content_item_entities_entity
  on public.content_item_entities (entity_id, item_id);

-- Breaking tab and keyset pagination.
create index if not exists idx_content_items_breaking_time
  on public.content_items (event_time desc, item_id desc)
  where is_breaking = true;
create index if not exists idx_content_items_time_id
  on public.content_items (event_time desc, item_id desc);

-- Series lookup by public code.
create index if not exists idx_series_code on public.series (series_code);

-- Hourly per-user notification cap.
create index if not exists idx_notification_events_user_time
  on public.notification_events (user_id, created_at desc);

-- Trigram indexes for feed search (ILIKE '%term%').
create extension if not exists pg_trgm with schema extensions;
do $$
declare
  trgm_schema text;
begin
  select n.nspname into trgm_schema
  from pg_extension e
  join pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'pg_trgm';

  execute format(
    'create index if not exists idx_content_items_headline_trgm on public.content_items using gin (headline_generated %I.gin_trgm_ops)',
    trgm_schema
  );
  execute format(
    'create index if not exists idx_content_items_summary_trgm on public.content_items using gin (summary_generated %I.gin_trgm_ops)',
    trgm_schema
  );
end
$$;

-- -------------------------------------------------------------------
-- 3) Push subscriptions: dedicated endpoint hash + one IV per encrypted field.
--    Rows created before this migration stored only the endpoint IV, so their
--    p256dh/auth ciphertexts cannot be decrypted. They remain (p256dh_iv/auth_iv
--    null) and are skipped by the sender until the browser re-subscribes, which
--    upserts the same endpoint hash with fresh ciphertexts and IVs.
-- -------------------------------------------------------------------
alter table public.push_subscriptions add column if not exists endpoint_hash text;
alter table public.push_subscriptions add column if not exists p256dh_iv text;
alter table public.push_subscriptions add column if not exists auth_iv text;

update public.push_subscriptions
set endpoint_hash = filters->>'endpoint_hash'
where endpoint_hash is null
  and filters ? 'endpoint_hash';

-- Collapse exact duplicates (same user + same endpoint) to the newest row.
delete from public.push_subscriptions ps
using (
  select
    subscription_id,
    row_number() over (
      partition by user_id, endpoint_hash
      order by coalesce(last_seen_at, created_at) desc, created_at desc, subscription_id desc
    ) as rn
  from public.push_subscriptions
  where endpoint_hash is not null
) dup
where ps.subscription_id = dup.subscription_id
  and dup.rn > 1;

create unique index if not exists uq_push_subscriptions_user_endpoint
  on public.push_subscriptions (user_id, endpoint_hash)
  where endpoint_hash is not null;
create index if not exists idx_push_subscriptions_user
  on public.push_subscriptions (user_id);

-- -------------------------------------------------------------------
-- 4) Tie user-owned rows to auth.users so deleting an account removes its
--    data (GDPR erasure). NOT VALID: enforced for new rows and cascades on
--    delete without failing on pre-existing orphans.
-- -------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'fk_push_subscriptions_user') then
    alter table public.push_subscriptions
      add constraint fk_push_subscriptions_user
      foreign key (user_id) references auth.users(id) on delete cascade not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'fk_alert_rules_user') then
    alter table public.alert_rules
      add constraint fk_alert_rules_user
      foreign key (user_id) references auth.users(id) on delete cascade not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'fk_notification_events_user') then
    alter table public.notification_events
      add constraint fk_notification_events_user
      foreign key (user_id) references auth.users(id) on delete cascade not valid;
  end if;
end
$$;

-- -------------------------------------------------------------------
-- 5) RLS: user-owned tables are written only by the worker (which validates,
--    encrypts and rate-limits). Direct PostgREST writes with the public anon
--    key + a user JWT bypassed all of that, so the write policies are removed.
--    Users keep read access to their own rows.
-- -------------------------------------------------------------------
drop policy if exists push_subscriptions_insert_own on public.push_subscriptions;
drop policy if exists push_subscriptions_update_own on public.push_subscriptions;
drop policy if exists push_subscriptions_delete_own on public.push_subscriptions;
drop policy if exists alert_rules_insert_own on public.alert_rules;
drop policy if exists alert_rules_update_own on public.alert_rules;
drop policy if exists alert_rules_delete_own on public.alert_rules;

-- -------------------------------------------------------------------
-- 6) content_provenance: its primary key contained nullable foreign keys,
--    which forced every row to reference a source, dataset AND series.
-- -------------------------------------------------------------------
alter table public.content_provenance drop constraint if exists content_provenance_pkey;
alter table public.content_provenance alter column source_id drop not null;
alter table public.content_provenance alter column dataset_id drop not null;
alter table public.content_provenance alter column series_id drop not null;
alter table public.content_provenance add column if not exists provenance_id uuid not null default gen_random_uuid();
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'content_provenance_pkey') then
    alter table public.content_provenance add constraint content_provenance_pkey primary key (provenance_id);
  end if;
end
$$;
create unique index if not exists uq_content_provenance_refs
  on public.content_provenance (item_id, source_id, dataset_id, series_id) nulls not distinct;

-- -------------------------------------------------------------------
-- 7) Official revisions of raw (locked) series are applied, and the previous
--    value is kept here for audit instead of freezing the series forever.
-- -------------------------------------------------------------------
create table if not exists public.series_observation_revisions (
  revision_id uuid primary key default gen_random_uuid(),
  series_id uuid not null references public.series(series_id) on delete cascade,
  obs_date date not null,
  previous_value_raw text not null,
  new_value_raw text not null,
  previous_source_hash text,
  new_source_hash text,
  detected_at timestamptz not null default now()
);
create index if not exists idx_series_obs_revisions_series
  on public.series_observation_revisions (series_id, obs_date);
alter table public.series_observation_revisions enable row level security;
drop policy if exists series_observation_revisions_service_role_all on public.series_observation_revisions;
create policy series_observation_revisions_service_role_all
on public.series_observation_revisions
for all
to service_role
using (true)
with check (true);
