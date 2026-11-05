# Full-Project Review and Remediation (2026-11-05)

Scope: every file in `apps/`, `packages/`, `supabase/`, `scripts/` and `docs/` was read; findings were reproduced (temporary tests, live upstream responses, official documentation) before being fixed. Each fix below lists the test that now guards it.

## Verification summary

| Check | Result |
|---|---|
| `npm run typecheck` (worker tests now included) | pass |
| `npm run lint` | pass |
| `npm test` — unit, integration, real-Postgres (PGlite, all migrations applied), compliance | 103 tests pass |
| `npm run test:e2e` (Playwright) | 20 tests pass |
| `npm run build`, `wrangler deploy --dry-run` | pass |
| `npm run test:release-gate` (behavioural) + OSS notice gate | pass (monetization reported as WARN: no sellers configured) |

All of the above run on a clean checkout without a prior `npm run build`, and in CI (`.github/workflows/ci.yml`).

## P0 — broken features and incorrect data

| # | Finding | Evidence | Fix | Guarded by |
|---|---|---|---|---|
| 1 | Web Push never sent anything; notifications were marked `sent` after only writing an R2 audit object. No service worker or subscribe UI existed. | `push/queue.ts` (old) had no delivery code; `decryptField` unused | RFC 8291 (aes128gcm) + RFC 8292 (VAPID) delivery with WebCrypto; `sent` only after a 2xx from the push service; 404/410 subscriptions deleted; nothing recorded when VAPID is not configured; `public/sw.js` + Alerts page controls | `test/unit/webpush.test.ts` (RFC 8291 Appendix A vector reproduced byte-for-byte; VAPID JWT verified), `test/unit/pushQueue.test.ts`, `test/db/api.db.test.ts` |
| 2 | Push keys were undecryptable: three fields were encrypted with three random IVs but only the endpoint IV was stored. | reproduced with a temporary test | per-field IV columns (`0005`), route stores all three; legacy rows are skipped until re-subscribed | `api.db.test.ts` (three distinct IVs, decrypt round trip) |
| 3 | Unknown filing/series/entity and invalid input returned `503 "store unavailable"` in production configuration. | reproduced (`/api/f/<unknown>`, `/api/series/NOPE`, `?from=not-a-date`) | `withDb` distinguishes not-found (null) from database failure; zod validation → 400; top-level handler → 503 only for real DB errors, always with CORS headers and `x-request-id` | `api.db.test.ts` "status codes" |
| 4 | Existing items were re-dated on every poll (`event_time = now()` on dedupe update), so the same SEC filing re-surfaced as new every 2 minutes. | `services/ingestDb.ts` (old) | atomic `INSERT … ON CONFLICT` that never updates `event_time`; SEC items use the EDGAR acceptance time; `0006` restores acceptance times on existing rows | `api.db.test.ts` "never re-dates", `ingest.db.test.ts` SEC |
| 5 | YoY assumed the observation 12 positions earlier was one year earlier. BLS publishes `"-"` for October 2025 CPI (confirmed in a live API response: "Data unavailable due to the 2025 lapse in appropriations"), so every later month was compared with the wrong base. CPI also used the seasonally adjusted index while the headline 12-month change uses the unadjusted index. | live BLS response | date-matched YoY (nearest observation to exactly one year earlier, ±7 days); `CUUR0000SA0`; `0006` drops the old derived values | `ingest.db.test.ts` BLS |
| 6 | "US GDP QoQ" computed the % change of values from BEA NIPA Table 1.1.1, whose title is "Percent Change From Preceding Period in Real Gross Domestic Product" ([Percent] seasonally adjusted at annual rates, per BEA's published table) — i.e. a % change of growth rates. The request also lacked `method=GetData` and used the placeholder key `sample`. | BEA publication | published values stored unchanged as `US_REAL_GDP_GROWTH_SAAR`; skipped explicitly without `BEA_API_KEY`; `0006` deletes the wrong series | `ingest.db.test.ts` BEA |
| 7 | Indicator `yoy` was the change vs. the previous observation, labelled "YoY" in the UI. | `postgres.ts` (old) | `yoy` = date-matched YoY % for level series, `null` for % series; new `change`/`change_unit` (`pp`) | `api.db.test.ts` indicators, e2e "percentage-point change" |
| 8 | `date` columns were returned as `String(Date)` ("Thu Jan 01 2026 …") because `pg` parses `date` into JS `Date`. | `pg-types` parser 1082 | `::text` casts in SQL | `api.db.test.ts` (harness uses the same `pg-types` parsers) |
| 9 | One ECB revision froze the derived EU HICP YoY series permanently (silent `return true`). | `live.ts` (old) | official revisions applied; previous value kept in `series_observation_revisions` | `ingest.db.test.ts` ECB |
| 10 | Ingest failures were masked: placeholder records (e.g. accession `0000000000-26-000000`) were written to an in-memory store in the consumer isolate and the message was acked; queue errors were not logged; no dead-letter queue; `RECOMPUTE_DERIVED` was a no-op; one successful macro source marked the whole run successful. | `ingest/queue.ts`, `index.ts`, `wrangler.toml` (old) | failures throw → `retry({delaySeconds})` with backoff → DLQ (`max_retries`, `dead_letter_queue`); one message per macro source; job retired; structured logs | `ingest.db.test.ts` (retry/ack behaviour, BLS non-success status) |
| 11 | Sample data could reach users: the SSE stream fell back to hard-coded items regardless of policy; the web client replaced every failed request (including 404/429) with hard-coded items, so `/t/apple` showed NVIDIA news. `seed.sql` also inserted sample content. | `stream.ts`, `web/lib/api.ts`, `seed.sql` (old) | stream honours the fallback policy; web shows the last real response (labelled) or an error/not-found state; sample content moved to `sample_data.sql` (local only) | e2e "API failure…", "unknown entity…", release gate seed check |
| 12 | GDELT timeline requests had no `timespan` (default: 3 months, daily resolution per the DOC 2.0 API docs) while headlines said "10-minute"; requests were not paced (the API answers "Please limit requests to one every 5 seconds"); the parser read `timeline[-1].value` although the series data is nested. | GDELT docs + live response | `timespan=24h` (15-minute steps), last in-progress interval dropped, both JSON shapes parsed, 5.5 s pacing, items dated by interval end, `source_count` (capped at 5 by the sample size) removed | `ingest.db.test.ts` GDELT |
| 13 | Password change through the gateway used `PATCH /auth/v1/user`; supabase-js uses `PUT`. | `@supabase/auth-js` source | `PUT`, Authorization header supported, reauthentication `nonce` passthrough | integration tests |

## P1 — security and compliance

| Finding | Fix |
|---|---|
| RLS `0004` granted authenticated users INSERT/UPDATE/DELETE on `push_subscriptions` and `alert_rules`, bypassing worker validation and encryption via PostgREST. | `0005` drops those policies; reads of own rows remain. Guarded by `api.db.test.ts` RLS test and `db-compliance.test.ts`. |
| Auth circuit breaker wrote the same KV key 2+ times per request (KV allows 1 write/s per key); a failure was counted once per retry attempt. | writes only on state transitions; one failure per request. |
| Passwords were trimmed; login enforced a new-password rule (min 8) that differed from Supabase config/UI (min 10 + complexity). | no trimming; login accepts any existing password; signup/change require 10. |
| The gateway's rate limits can be bypassed with the public anon key, while all users share Cloudflare egress IPs towards Supabase's per-IP limits. | documented; CAPTCHA token passthrough added; enable CAPTCHA/rate limits in Supabase (README §10.2). |
| Geo/consent failed open: IS/LI/NO (EEA) missing; MN/MD/KY/RI missing; unknown country → `US`; Tor/unknown → `NON_EU`; web defaulted to `NON_EU` before/when geo failed. | lists completed; unknown → strictest policy; web region starts `PENDING` (no ads) and geo failure → `EU_UK_CH`; stored consent expires after ~13 months. Guarded by e2e "geo lookup failure fails closed". |
| CSP `script-src 'self' https: 'unsafe-inline'` (tokens are in localStorage). | `script-src 'self'`, `worker-src 'self'`, `frame-src 'none'`; release gate checks it. |
| Audit log: browser-posted events were stored as `source: "server"`, with free-form e-mail, via a racy KV read-modify-write. | client events labelled `client`; auth events recorded by the gateway; one KV key per event; no e-mail stored (local copy no longer stores it either). |
| Push endpoint URL not validated (SSRF once sending exists); internal error messages returned as 400. | allowlist of browser push services, key-shape validation; generic errors handled centrally. |
| CORS sent `Access-Control-Allow-Origin: null` for disallowed origins. | header omitted. |
| No account/data deletion. | `POST /api/account/delete`; user rows reference `auth.users ON DELETE CASCADE`. |

## P2 — performance and cost

- Public reads served from the Cache API before the rate-limiter Durable Object; feed KV cache with raw query keys removed.
- Keyset pagination; escaped `ILIKE`; `pg_trgm` indexes; indexes for entity pages, breaking tab, notification cap; unique dedupe/subscription constraints.
- Indicator query uses `LATERAL … LIMIT` instead of a window function over all observations.
- Batched observation upserts (`unnest`) instead of one round trip per row; push fan-out loads targets in two queries.
- BLS series fetched in one POST (optional `BLS_API_KEY`); SEC reconciles the 20 most recent filings per poll.
- SSE stream polls a lightweight id/time query every 5 s instead of the full feed every 1.5 s.
- Daily retention job (GDELT items and notification history, 90 days by default).

## P3/P4 — tooling and maintainability

- CI workflow; tests run without a prior build (vitest/vite resolve workspace sources); worker tests are typechecked.
- PGlite harness applies every migration and uses `pg`'s own type parsers.
- Release gate runs behavioural suites instead of grepping source strings.
- `ingest/live.ts` (1,579 lines) split into per-source modules; `AlertsPage.tsx` split into components.
- Structured JSON logging (`services/log.ts`) and Workers observability enabled.
- Unused vars (`GDELT_MODE`, `ADS_PROVIDER`, `CMP_PROVIDER`) removed; Gate A and Gate F applied on the real write path; mojibake and BOMs removed.

## Corrections to the initial review

- GDELT's rate limit is not stated in the DOC 2.0 API blog post; it is the message returned by the API itself ("Please limit requests to one every 5 seconds…").
- BLS limits per the official FAQ: 25 queries/day unregistered, 500/day with a registration key.

## Not changed (follow-ups)

- `EventHubDO` is still bound but unused; removing a Durable Object class requires a `deleted_classes` migration that permanently deletes its storage, so it is left for an explicit decision.
- `HomePage.tsx` (≈750 lines) was updated but not split.
- Ads/CMP remain placeholders (no seller, no certified CMP); this is a product decision.
- Using a dedicated least-privileged database role for Hyperdrive requires operator action (credentials).
