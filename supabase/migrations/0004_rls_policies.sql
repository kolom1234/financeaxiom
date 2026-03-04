-- RLS policy design for public schema tables.
-- 1) Public reference/content tables: read-only for anon/authenticated, filtered to allowed licenses.
-- 2) User-owned tables: access scoped to auth.uid().
-- 3) Internal audit/provenance tables: service_role only.

-- -------------------------------------------------------------------
-- 1) Public reference/content tables
-- -------------------------------------------------------------------
drop policy if exists licenses_select_allowed_public on public.licenses;
create policy licenses_select_allowed_public
on public.licenses
for select
to anon, authenticated
using (commercial_status = 'allowed');

drop policy if exists licenses_service_role_all on public.licenses;
create policy licenses_service_role_all
on public.licenses
for all
to service_role
using (true)
with check (true);

drop policy if exists sources_select_allowed_public on public.sources;
create policy sources_select_allowed_public
on public.sources
for select
to anon, authenticated
using (
  active = true
  and exists (
    select 1
    from public.licenses l
    where l.license_id = sources.default_license_id
      and l.commercial_status = 'allowed'
  )
);

drop policy if exists sources_service_role_all on public.sources;
create policy sources_service_role_all
on public.sources
for all
to service_role
using (true)
with check (true);

drop policy if exists datasets_select_allowed_public on public.datasets;
create policy datasets_select_allowed_public
on public.datasets
for select
to anon, authenticated
using (
  exists (
    select 1
    from public.sources s
    join public.licenses l_default on l_default.license_id = s.default_license_id
    left join public.licenses l_dataset on l_dataset.license_id = datasets.license_id
    where s.source_id = datasets.source_id
      and s.active = true
      and coalesce(l_dataset.commercial_status, l_default.commercial_status, 'conditional') = 'allowed'
  )
);

drop policy if exists datasets_service_role_all on public.datasets;
create policy datasets_service_role_all
on public.datasets
for all
to service_role
using (true)
with check (true);

drop policy if exists series_select_allowed_public on public.series;
create policy series_select_allowed_public
on public.series
for select
to anon, authenticated
using (
  exists (
    select 1
    from public.sources s
    join public.licenses l_default on l_default.license_id = s.default_license_id
    left join public.licenses l_series on l_series.license_id = series.license_id
    where s.source_id = series.source_id
      and s.active = true
      and coalesce(l_series.commercial_status, l_default.commercial_status, 'conditional') = 'allowed'
  )
);

drop policy if exists series_service_role_all on public.series;
create policy series_service_role_all
on public.series
for all
to service_role
using (true)
with check (true);

drop policy if exists series_observations_select_allowed_public on public.series_observations;
create policy series_observations_select_allowed_public
on public.series_observations
for select
to anon, authenticated
using (
  exists (
    select 1
    from public.series s
    where s.series_id = series_observations.series_id
  )
);

drop policy if exists series_observations_service_role_all on public.series_observations;
create policy series_observations_service_role_all
on public.series_observations
for all
to service_role
using (true)
with check (true);

drop policy if exists content_items_select_allowed_public on public.content_items;
create policy content_items_select_allowed_public
on public.content_items
for select
to anon, authenticated
using (
  exists (
    select 1
    from public.sources s
    join public.licenses l_default on l_default.license_id = s.default_license_id
    left join public.licenses l_item on l_item.license_id = content_items.license_id
    where s.source_id = content_items.source_id
      and s.active = true
      and coalesce(l_item.commercial_status, l_default.commercial_status, 'conditional') = 'allowed'
  )
);

drop policy if exists content_items_service_role_all on public.content_items;
create policy content_items_service_role_all
on public.content_items
for all
to service_role
using (true)
with check (true);

drop policy if exists content_item_entities_select_allowed_public on public.content_item_entities;
create policy content_item_entities_select_allowed_public
on public.content_item_entities
for select
to anon, authenticated
using (
  exists (
    select 1
    from public.content_items ci
    where ci.item_id = content_item_entities.item_id
  )
);

drop policy if exists content_item_entities_service_role_all on public.content_item_entities;
create policy content_item_entities_service_role_all
on public.content_item_entities
for all
to service_role
using (true)
with check (true);

drop policy if exists entities_select_allowed_public on public.entities;
create policy entities_select_allowed_public
on public.entities
for select
to anon, authenticated
using (
  exists (
    select 1
    from public.content_item_entities cie
    where cie.entity_id = entities.entity_id
  )
);

drop policy if exists entities_service_role_all on public.entities;
create policy entities_service_role_all
on public.entities
for all
to service_role
using (true)
with check (true);

drop policy if exists filings_select_public on public.filings;
create policy filings_select_public
on public.filings
for select
to anon, authenticated
using (true);

drop policy if exists filings_service_role_all on public.filings;
create policy filings_service_role_all
on public.filings
for all
to service_role
using (true)
with check (true);

-- -------------------------------------------------------------------
-- 2) User-owned tables
-- -------------------------------------------------------------------
drop policy if exists push_subscriptions_select_own on public.push_subscriptions;
create policy push_subscriptions_select_own
on public.push_subscriptions
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists push_subscriptions_insert_own on public.push_subscriptions;
create policy push_subscriptions_insert_own
on public.push_subscriptions
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists push_subscriptions_update_own on public.push_subscriptions;
create policy push_subscriptions_update_own
on public.push_subscriptions
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists push_subscriptions_delete_own on public.push_subscriptions;
create policy push_subscriptions_delete_own
on public.push_subscriptions
for delete
to authenticated
using (auth.uid() = user_id);

drop policy if exists push_subscriptions_service_role_all on public.push_subscriptions;
create policy push_subscriptions_service_role_all
on public.push_subscriptions
for all
to service_role
using (true)
with check (true);

drop policy if exists alert_rules_select_own on public.alert_rules;
create policy alert_rules_select_own
on public.alert_rules
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists alert_rules_insert_own on public.alert_rules;
create policy alert_rules_insert_own
on public.alert_rules
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists alert_rules_update_own on public.alert_rules;
create policy alert_rules_update_own
on public.alert_rules
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists alert_rules_delete_own on public.alert_rules;
create policy alert_rules_delete_own
on public.alert_rules
for delete
to authenticated
using (auth.uid() = user_id);

drop policy if exists alert_rules_service_role_all on public.alert_rules;
create policy alert_rules_service_role_all
on public.alert_rules
for all
to service_role
using (true)
with check (true);

drop policy if exists notification_events_select_own on public.notification_events;
create policy notification_events_select_own
on public.notification_events
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists notification_events_service_role_all on public.notification_events;
create policy notification_events_service_role_all
on public.notification_events
for all
to service_role
using (true)
with check (true);

-- -------------------------------------------------------------------
-- 3) Internal-only tables
-- -------------------------------------------------------------------
drop policy if exists content_provenance_service_role_all on public.content_provenance;
create policy content_provenance_service_role_all
on public.content_provenance
for all
to service_role
using (true)
with check (true);

drop policy if exists policy_snapshots_service_role_all on public.policy_snapshots;
create policy policy_snapshots_service_role_all
on public.policy_snapshots
for all
to service_role
using (true)
with check (true);
