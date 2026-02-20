# Security Audit Tracker (2026-02-19)

Goal: run a full-project security review without repeated scans.

## Rules

- Review each module once, record evidence files/lines immediately.
- Track status transitions: `todo -> in_progress -> done`.
- Keep findings severity-ranked (`High`, `Medium`, `Low`).

## Execution Log

- 2026-02-19: Baseline full-scope scan completed for M01~M11 and initial findings ledger recorded.
- 2026-02-19: High findings F-01~F-03 remediated and regression tests added.
- 2026-02-19: Medium findings F-04~F-07 remediated (bounded body parser, bounded memory fallback, production debug toggle hardening, direct-auth fallback gating).
- 2026-02-19: Low finding F-09 remediated by adding stream abuse/fail-closed test coverage; stream route hardened against closed-controller enqueue errors.
- 2026-02-19: Low finding F-08 remediated with internal token auth + payload/tab validation for EventHub DO, plus unit tests.

## Module Checklist

| ID | Module | Scope | Status | Evidence |
|---|---|---|---|---|
| M01 | API entry and routing | Auth boundaries, public endpoints, method handling | done | `apps/worker/src/index.ts:49`, `apps/worker/src/index.ts:67`, `apps/worker/src/routes/stream.ts:145` |
| M02 | Auth and session validation | JWT verify, bypass risk, token flows | done | `apps/worker/src/services/auth.ts:65`, `apps/worker/src/services/auth.ts:104`, `apps/worker/src/routes/auth.ts:649` |
| M03 | Rate limiting and abuse controls | KV/DO dependency, fail-open behavior | done | `apps/worker/src/services/rateLimit.ts:44`, `apps/worker/src/services/sec.ts:16`, `apps/worker/src/do/secLimiter.ts:4` |
| M04 | Input validation and request parsing | Body size, schema checks, unsafe parsing | done | `apps/worker/src/routes/utils.ts:109`, `apps/worker/src/routes/auth.ts:624`, `apps/worker/src/routes/push.ts:29` |
| M05 | Data access and storage fallbacks | DB error behavior, memory fallback impact | done | `apps/worker/src/services/postgres.ts:111`, `apps/worker/src/services/store.ts:33`, `apps/worker/src/routes/feed.ts:66` |
| M06 | Stream/SSE behavior | Connection lifetime, auth, resource controls | done | `apps/worker/src/index.ts:67`, `apps/worker/src/routes/stream.ts:145`, `apps/worker/src/routes/stream.ts:158` |
| M07 | Ingestion and upstream resilience | Timeout/retry/circuit breaker coverage | done | `apps/worker/src/ingest/live.ts:226`, `apps/worker/src/ingest/live.ts:258`, `apps/worker/src/routes/auth.ts:505` |
| M08 | Crypto and push notification handling | Secret handling, endpoint encryption/hash | done | `apps/worker/src/services/crypto.ts:15`, `apps/worker/src/routes/push.ts:25`, `apps/worker/src/routes/push.ts:35` |
| M09 | Frontend auth/token handling | Token exposure, local storage, debug tooling | done | `apps/web/src/routes/AlertsPage.tsx:837`, `apps/web/src/routes/AlertsPage.tsx:856`, `apps/web/src/lib/authGateway.ts:223` |
| M10 | Infra/config/secrets | wrangler vars, origin policy, runtime safety | done | `apps/worker/wrangler.toml:13`, `apps/worker/src/routes/utils.ts:36`, `apps/worker/src/types.ts:13` |
| M11 | Tests and verification coverage | Security regression coverage and blind spots | done | `apps/worker/test/integration/api-routes.test.ts:481`, `apps/worker/test/integration/api-routes.test.ts:492`, `apps/worker/test/unit/store.test.ts:13` |

## Findings Ledger

| ID | Severity | Title | Status | Evidence |
|---|---|---|---|---|
| F-01 | High | Public stream endpoint is unauthenticated and unthrottled | fixed | `apps/worker/src/routes/stream.ts:145`, `apps/worker/src/routes/stream.ts:158`, `apps/worker/test/integration/api-routes.test.ts:477` |
| F-02 | High | Route-level rate limits fail open when KV is unavailable | fixed | `apps/worker/src/routes/auth.ts:436`, `apps/worker/src/routes/alerts.ts:26`, `apps/worker/test/integration/api-routes.test.ts:327` |
| F-03 | High | SEC 10 rps control fails open when limiter DO binding is missing | fixed | `apps/worker/src/services/sec.ts:15`, `apps/worker/src/do/secLimiter.ts:4`, `apps/worker/wrangler.toml:45` |
| F-04 | Medium | Generic JSON parser has no payload size limit on several routes | fixed | `apps/worker/src/routes/utils.ts:125`, `apps/worker/src/routes/alerts.ts:12`, `apps/worker/src/routes/push.ts:22`, `apps/worker/test/integration/api-routes.test.ts:777` |
| F-05 | Medium | DB failure path overuses in-memory fallback with unbounded collections | fixed | `apps/worker/src/services/store.ts:23`, `apps/worker/src/services/store.ts:537`, `apps/worker/test/unit/store.test.ts:13`, `apps/worker/src/push/queue.ts:17` |
| F-06 | Medium | Production UI exposes session-token debug/copy tooling | fixed | `apps/web/src/routes/AlertsPage.tsx:61`, `apps/web/src/routes/AlertsPage.tsx:831`, `apps/web/.env.local.example:7` |
| F-07 | Medium | Frontend auth falls back to direct Supabase when gateway fails | fixed | `apps/web/src/lib/authGateway.ts:47`, `apps/web/src/lib/authGateway.ts:224`, `apps/web/.env.local.example:6` |
| F-08 | Low | EventHub DO lacks auth/validation if mapped externally in future | fixed | `apps/worker/src/do/eventHub.ts:59`, `apps/worker/src/do/eventHub.ts:70`, `apps/worker/test/unit/eventHub.test.ts:18`, `apps/worker/src/types.ts:13` |
| F-09 | Low | Security tests do not cover stream abuse and fail-open config modes | fixed | `apps/worker/test/integration/api-routes.test.ts:476`, `apps/worker/test/integration/api-routes.test.ts:481`, `apps/worker/test/integration/api-routes.test.ts:492` |
