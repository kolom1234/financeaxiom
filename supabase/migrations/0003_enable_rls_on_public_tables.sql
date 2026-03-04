-- Enable row-level security on PostgREST-exposed tables in public schema.
-- Data access in this project is handled by the worker via direct SQL, so we
-- intentionally keep PostgREST table access fail-closed (no anon/auth policies).

alter table if exists public.licenses enable row level security;
alter table if exists public.sources enable row level security;
alter table if exists public.datasets enable row level security;
alter table if exists public.series enable row level security;
alter table if exists public.series_observations enable row level security;
alter table if exists public.content_items enable row level security;
alter table if exists public.content_item_entities enable row level security;
alter table if exists public.entities enable row level security;
alter table if exists public.content_provenance enable row level security;
alter table if exists public.filings enable row level security;
alter table if exists public.push_subscriptions enable row level security;
alter table if exists public.alert_rules enable row level security;
alter table if exists public.notification_events enable row level security;
alter table if exists public.policy_snapshots enable row level security;
