# FinanceAxiom — Open Finance Pulse

[English](./README.md) | [한국어](./README.ko.md)

**[FinanceAxiom](https://financeaxiom.com)** is a financial intelligence platform deployed at `financeaxiom.com`. This repository contains **Open Finance Pulse** — the core data engine and web application that powers FinanceAxiom, built on a Cloudflare-first architecture with explicit legal/compliance controls for data-source usage, ad-consent gating, and release-time audit checks.

<img width="984" height="1284" alt="image" src="https://github.com/user-attachments/assets/44c21eb4-1f08-42e9-aa5c-1c12448b197e" />

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Key Capabilities](#2-key-capabilities)
3. [System Architecture](#3-system-architecture)
4. [Repository Layout](#4-repository-layout)
5. [API Surface](#5-api-surface)
6. [Compliance and Security Controls](#6-compliance-and-security-controls)
7. [Quality Gates and Test Strategy](#7-quality-gates-and-test-strategy)
8. [Local Development](#8-local-development)
9. [Environment Configuration](#9-environment-configuration)
10. [Deployment Playbook](#10-deployment-playbook)
11. [Operational Documentation](#11-operational-documentation)
12. [Known Constraints](#12-known-constraints)
13. [License](#13-license)

## 1. Executive Summary

**FinanceAxiom** (`financeaxiom.com`) is the public-facing financial intelligence product. **Open Finance Pulse** is the monorepo that powers it, combining:

- A React/Vite frontend (`apps/web`) deployed to Cloudflare Pages
- A Cloudflare Worker backend (`apps/worker`) serving `/api/*` routes
- Shared contract/type and policy packages (`packages/shared`, `packages/policy`)
- Supabase/Postgres data persistence via Hyperdrive
- Compliance artifacts and operational audits in `docs/`

The project emphasizes:

- Deterministic release gates (`test:release-gate`, `test:oss-notice-gate`, `test:cmp-deploy`)
- Source-license and attribution-aware data exposure
- Security controls (rate limiting, auth gateway hardening, encrypted push subscription storage)

## 2. Key Capabilities

- Multi-tab market feed (`breaking`, `filings`, `macro`, `newsindex`)
- Entity and series drilldown APIs
- SEC filing retrieval and macro/derived series ingestion
- Auth flows (signup/login/reset/change/logout) through Supabase Auth gateway
- Alert rules and push subscription management
- Region-aware ad-consent enforcement with CMP signal bridging (`TCF/GPP/USP`)
- Legal notice, privacy, and terms surfaces backed by API + docs

## 3. System Architecture

### 3.1 Runtime Topology

```mermaid
flowchart LR
  U[End User Browser] --> P[Cloudflare Pages<br/>apps/web]
  P -->|/api/*| W[Cloudflare Worker<br/>apps/worker]

  W --> KV[Cloudflare KV<br/>OFP_KV]
  W --> R2[Cloudflare R2<br/>AUDIT_R2]
  W --> H[Cloudflare Hyperdrive]
  H --> DB[(Supabase Postgres)]

  W --> RLDO[RateLimiterDO]
  W --> SEC[SecLimiterDO]
  W --> EH[EventHubDO]

  SCH[Worker Cron Scheduler] --> IQ[Queue: ofp-ingest]
  SCH --> PQ[Queue: ofp-push]
  IQ --> W
  PQ --> W
```

### 3.2 Data and Control Flow

```mermaid
sequenceDiagram
  participant C as Client
  participant Pages as Pages (web)
  participant Worker as Worker API
  participant Queue as CF Queues
  participant DB as Supabase Postgres

  C->>Pages: Navigate /, /alerts, /legal...
  Pages->>Worker: GET /api/feed, /api/indicators/key, /api/legal
  Worker->>DB: Query with allow-only license filters
  DB-->>Worker: Source + license metadata
  Worker-->>Pages: Envelope JSON (data + meta)
  Pages-->>C: UI + attribution + consent-aware ads

  Note over Worker,Queue: Scheduled ingest jobs (cron)
  Worker->>Queue: INGEST_GDELT / INGEST_SEC / INGEST_MACRO / RECOMPUTE_DERIVED
  Queue->>Worker: Queue consumer callback
  Worker->>DB: Upsert content, series, filings
```

## 4. Repository Layout

### 4.1 Structure Diagram

```mermaid
graph TD
  R[FinanceAxiom / open-finance-pulse]
  R --> A[apps/web]
  R --> B[apps/worker]
  R --> C[packages/shared]
  R --> D[packages/policy]
  R --> E[supabase]
  R --> F[config]
  R --> G[scripts]
  R --> H[docs]

  A --> A1[src]
  A --> A2[e2e]
  A --> A3[public]

  B --> B1[src]
  B --> B2[test]
  B --> B3[wrangler.toml]
```

### 4.2 Directory Responsibilities

| Path | Responsibility |
|---|---|
| `apps/web` | React app, routing, consent UI, e2e tests, Pages static assets |
| `apps/worker` | API router, ingestion jobs, queue consumers, rate limiting, auth gateway |
| `packages/shared` | Shared payload types and envelope helpers |
| `packages/policy` | License/compliance gates (FRED block, metadata-only restrictions, etc.) |
| `supabase` | SQL migrations and seed data |
| `config` | Source, license, and indicator metadata |
| `scripts` | Release/compliance/deploy smoke scripts |
| `docs` | Audit logs, legal notices, privacy/terms, handoff and verification docs |

## 5. API Surface

### 5.1 Public Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/feed` | Feed by tab/query/region with cursor pagination |
| `GET` | `/api/indicators/key` | Key indicator cards and sparkline payloads |
| `GET` | `/api/legal` | Source/license statements and legal payload |
| `GET` | `/api/geo` | Region policy classification (`EU_UK_CH`, `US_STATE_PRIVACY`, `NON_EU`) |
| `GET` | `/api/entity/:slug` | Entity-related feed items (allowed-license only); 404 if unknown |
| `GET` | `/api/series/:id` | Raw/derived series by UUID or code, e.g. `US_CPI_YOY` (allowed-license only); `from`/`to` = `YYYY-MM-DD` |
| `GET` | `/api/f/:accession` | Filing metadata with SEC attribution; 404 if unknown |
| `GET` | `/api/push/config` | Whether Web Push is enabled and the public VAPID key |

Status codes: `400` invalid input, `404` not found, `429` rate limited (`retry-after`), `503` persistent store unavailable (`x-request-id` for log correlation). `/api/feed` uses an opaque keyset `cursor` (`next_cursor`). Indicator cards expose `yoy` (date-matched year-over-year %, `null` for series already in %) and `change`/`change_unit` (`pp` for % series).

### 5.2 Authenticated Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET`,`POST` | `/api/account/audit` | User account activity audit trail |
| `GET`,`POST` | `/api/alerts/rules` | Alert rule management (validated per rule type, max 50 per account) |
| `DELETE` | `/api/alerts/rules/:id` | Delete one of your rules |
| `POST` | `/api/account/delete` | Erase your app data (`{"confirm":"DELETE"}`); also deletes the login account when `SUPABASE_SERVICE_ROLE_KEY` is set |
| `POST` | `/api/push/subscribe` | Push subscription upsert (encrypted at rest) |
| `POST` | `/api/push/unsubscribe` | Push subscription removal |
| `GET` | `/api/stream` | Authenticated event stream |

### 5.3 Auth Gateway Endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/auth/login` | Login proxy with guardrails |
| `POST` | `/api/auth/signup` | Signup proxy with redirect validation |
| `POST` | `/api/auth/password-reset` | Password reset request |
| `POST` | `/api/auth/password-change` | Password change |
| `POST` | `/api/auth/logout` | Logout |

## 6. Compliance and Security Controls

| Control Area | Implementation |
|---|---|
| License exposure policy | Feed/entity/series APIs enforce allow-only commercial status |
| Metadata-only publisher handling | Policy gates prevent publisher body/headline/image ingestion |
| Source-specific restrictions | FRED hard block, Eurostat geo filter, OECD/WB restricted gating |
| Attribution visibility | UI surfaces include `license.attribution_text` where required |
| Public route abuse controls | Edge Cache API for public reads, then per-scope rate limiting via `RateLimiterDO` on cache misses |
| SEC fair-access | Declared user-agent and request rate limiting (`SecLimiterDO`) |
| Auth hardening | Input size limits, zod validation, redirect allowlist, retry/circuit breaker (KV written only on state transitions), CAPTCHA token passthrough. Authoritative brute-force protection must be enabled in Supabase (rate limits + CAPTCHA), because the anon key also allows calling Supabase Auth directly |
| Push privacy & delivery | Endpoint/keys encrypted with AES-GCM (one IV per field); RFC 8291/8292 delivery; endpoints limited to browser push services |
| Consent compliance | EEA+UK+CH and US privacy-law states classified server-side; unknown/failed geo fails closed; TCF/GPP/USP bridge before ad script load |
| Data integrity | Unique dedupe keys, items never re-dated, date-matched YoY, official ECB revisions applied with an audit trail |
| Direct DB access | RLS: no anon access to user tables; authenticated users can read but not write their own rows (all writes go through the worker) |
| OSS license readiness | Generated `THIRD_PARTY_NOTICES.txt` + stale-lockfile gate |

## 7. Quality Gates and Test Strategy

| Command | Scope |
|---|---|
| `npm run typecheck` | Type integrity across all workspaces (worker tests included) |
| `npm test` | Unit + integration + real-Postgres + compliance suites |
| `npm run test:unit` | Policy + worker unit tests (incl. RFC 8291 Web Push test vector) |
| `npm run test:integration` | Worker integration route tests |
| `npm run test:db` | API and ingestion against real PostgreSQL (PGlite) with every migration applied |
| `npm run test:compliance` | Compliance gates, incl. behavioural checks against the real schema |
| `npm run test:e2e` | Frontend flows and consent behavior via Playwright |
| `npm run test:release-gate` | Runs the compliance + real-Postgres suites and configuration checks (CSP, dead-letter queues, seed content) + OSS notice gate |
| `npm run test:cmp-deploy` | Production smoke check for CMP markers and ad metadata files |
| `npm run gen:oss-notices` | Regenerate `THIRD_PARTY_NOTICES.txt` from lockfile |
| `npm run gen:vapid-keys` | Generate a VAPID key pair for Web Push |

CI (`.github/workflows/ci.yml`) runs typecheck, lint, all test suites, build, a Workers bundle dry-run, the release gate and Playwright e2e on every pull request. No prior `npm run build` is required for tests or the dev server (workspace packages resolve from source).

## 8. Local Development

### 8.1 Prerequisites

- Node.js 22+
- npm 10+
- Cloudflare Wrangler CLI (`npx wrangler ...`)
- Supabase local stack (optional for full local DB flow)

### 8.2 Bootstrap

```bash
npm install
npm run typecheck
npm run build
```

### 8.3 Run Services

```bash
# Worker (local)
npm run -w apps/worker dev

# Web (local)
npm run -w apps/web dev -- --host 127.0.0.1 --port 4173
```

### 8.4 Database Assets

- Migrations: `supabase/migrations/` (applied in order; all are idempotent)
- Reference data (licenses, sources, entities): `supabase/seed.sql` — safe for every environment
- Sample content for local development only: `supabase/sample_data.sql` (loaded by the local Supabase stack; never apply to production)
- Helper commands (require the Supabase CLI, linked to the project):
  - `npm run db:migrate` (`supabase db push`)
  - `npm run db:seed` (`supabase db push --include-seed`)

## 9. Environment Configuration

### 9.1 Web (`apps/web/.env.local.example`)

| Variable | Description |
|---|---|
| `VITE_SUPABASE_URL` | Supabase URL for frontend auth client |
| `VITE_SUPABASE_ANON_KEY` | Public anon key for frontend SDK |
| `VITE_API_BASE_URL` | API base override |
| `VITE_AD_CLIENT_ID` | Ad client identifier |

### 9.2 Worker (`apps/worker/.dev.vars.example`)

| Variable | Description |
|---|---|
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_JWKS_URL` | Auth integration |
| `DATABASE_URL` | Postgres connection string |
| `SEC_USER_AGENT` | SEC access policy user-agent |
| `PUSH_DATA_ENC_KEY` | Encryption key for push payload storage |
| `EVENT_HUB_INTERNAL_TOKEN` | Internal auth token for event hub calls |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | Web Push credentials (`npm run gen:vapid-keys`; subject `mailto:` or `https:`). Push is disabled until all are set |
| `SUPABASE_SERVICE_ROLE_KEY` | Optional secret: lets `/api/account/delete` remove the Supabase Auth user |
| `BLS_API_KEY` / `BEA_API_KEY` / `EIA_API_KEY` | Upstream API keys (BLS optional; BEA ingestion is skipped without a key) |
| `GDELT_RETENTION_DAYS` / `NOTIFICATION_RETENTION_DAYS` | Retention windows (default 90 days) |
| `ALLOWED_ORIGINS` / `AUTH_ALLOWED_REDIRECT_ORIGINS` | CORS and redirect allowlists |

Security note: never commit real secret values. `.gitignore` blocks `.env*`, `.dev.vars*`, `.wrangler/`, and key/certificate patterns.

## 10. Deployment Playbook

### 10.1 Web (Cloudflare Pages)

```bash
npm run -w apps/web build
npx wrangler pages deploy apps/web/dist --project-name open-finance-pulse --branch main
```

### 10.2 Worker (Cloudflare Workers)

```bash
npx wrangler deploy --config apps/worker/wrangler.toml
```

Before the first deploy of this version:

1. Apply migrations `0005` and `0006` (`npm run db:migrate`). `0006` corrects previously ingested data (see `docs/REMEDIATION_2026-11-05.md`).
2. Set secrets: `PUSH_DATA_ENC_KEY`, `VAPID_PRIVATE_KEY` (and optionally `SUPABASE_SERVICE_ROLE_KEY`, `BLS_API_KEY`, `BEA_API_KEY`) with `npx wrangler secret put <NAME> --config apps/worker/wrangler.toml`; set `VAPID_PUBLIC_KEY` and `VAPID_SUBJECT` as vars.
3. Dead-letter queues `ofp-ingest-dlq` / `ofp-push-dlq` are referenced by `wrangler.toml`; create them if your account does not create them automatically (`npx wrangler queues create <name>`).
4. In Supabase: enable CAPTCHA and review Auth rate limits (the gateway forwards `captcha_token`). Optionally point Hyperdrive at a dedicated least-privileged database role instead of `postgres`.

### 10.3 Post-Deploy Validation

```bash
npm run test:release-gate
npm run test:cmp-deploy
```

Recommended production smoke checks:

- `https://financeaxiom.com`
- `https://api.financeaxiom.com/api/feed?tab=breaking`
- `https://api.financeaxiom.com/api/indicators/key`
- `https://api.financeaxiom.com/api/legal`

## 11. Operational Documentation

| Document | Purpose |
|---|---|
| `SPEC.md` | Primary product and compliance specification |
| `docs/HANDOFF.md` | Operational handoff and continuation guide |
| `docs/REMEDIATION_2026-11-05.md` | Full-project review findings, fixes and verification evidence |
| `docs/LEGAL_AUDIT_2026-02-20.md` | Legal/compliance audit log and remediation status |
| `docs/OSS_NOTICES_PROCESS.md` | OSS notice generation and release process |
| `docs/LEGAL_NOTICES.md` | Data-source legal references |
| `docs/PRIVACY.md`, `docs/TERMS.md` | Public policy text |

## 12. Known Constraints

- `apps/web/public/ads.txt` and `apps/web/public/sellers.json` contain no sellers yet; the ad SDK URL in `AdSlot.tsx` is a placeholder and no certified CMP is loaded. When monetization is enabled, add the vendor's script/frame origins to the CSP in `apps/web/public/_headers`.
- Existing push subscriptions created before migration `0005` cannot be decrypted (their key IVs were never stored); they are skipped until the browser re-subscribes from the Alerts page.
- Certified CMP operation is an external runtime dependency and must be validated per production deploy (`npm run test:cmp-deploy`).
- Some docs are date-stamped snapshots; always verify the latest release state before external reporting.

## 13. License

Licensed under Apache License 2.0. See `LICENSE`.
