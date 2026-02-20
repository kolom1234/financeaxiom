# Open Finance Pulse — SPEC (AI‑Executable) v1.2 (Option A: Cloudflare + Supabase + Hyperdrive)

> **Purpose**: Single source of truth to build a **license‑safe, ad‑monetizable** financial information product for **US/EU markets**.  
> **Audience**: AI agents + developers implementing the project.  
> **Date**: 2026‑02‑16 (KST)  
> **Core Stack**: Vite + React + Cloudflare Pages + Cloudflare Workers + Cloudflare Queues/KV/R2 + (Optional Durable Objects) + **Supabase Auth + Supabase Postgres via Cloudflare Hyperdrive**  
> **Legal posture**: **Index/metadata + link‑out** for publisher content; **official/public/open‑license data** for indicators; **fact‑only, self‑generated headlines** for filings & official releases.
>
> ⚠️ **Not legal advice.** This spec is an engineering/compliance design to minimize risk. You should still have counsel review before scaling.

---

## Table of Contents

- [0. Executive Feasibility & Cost Reality](#0-executive-feasibility--cost-reality)
- [1. Hard Constraints (Non‑Negotiable)](#1-hard-constraints-nonnegotiable)
- [2. Product Scope](#2-product-scope)
- [3. Data Sources & Compliance Matrix (Ads‑Safe)](#3-data-sources--compliance-matrix-ads-safe)
- [4. System Architecture (Option A)](#4-system-architecture-option-a)
- [5. Infrastructure Setup Checklist (Cloudflare + Supabase + Hyperdrive)](#5-infrastructure-setup-checklist-cloudflare--supabase--hyperdrive)
- [6. Repo Layout](#6-repo-layout)
- [7. Work Packages (AI‑Assignable Modules)](#7-work-packages-ai-assignable-modules)
- [8. Canonical Data Model (Postgres SQL, License Metadata Included)](#8-canonical-data-model-postgres-sql-license-metadata-included)
- [9. API Contract](#9-api-contract)
- [10. Ingestion (Cron → Queue → Worker Consumers)](#10-ingestion-cron--queue--worker-consumers)
- [11. Compliance Gates (Automated Enforcement)](#11-compliance-gates-automated-enforcement)
- [12. Ads + Consent (EU/UK/CH)](#12-ads--consent-euukch)
- [13. Security, Privacy, Abuse Prevention](#13-security-privacy-abuse-prevention)
- [14. Testing Plan](#14-testing-plan)
- [15. Release Criteria (Definition of Done)](#15-release-criteria-definition-of-done)
- [Appendix A — UI/Alert Copy Templates (License‑Safe)](#appendix-a--uialert-copy-templates-license-safe)
- [Appendix B — Known Risks & Mitigations](#appendix-b--known-risks--mitigations)
- [Appendix C — Source Policy URLs (Review Targets)](#appendix-c--source-policy-urls-review-targets)

---

## 0. Executive Feasibility & Cost Reality

### 0.1 “Data license fee 없이 + 광고 수익화” 가능 여부 (정확한 결론)

**가능**합니다 — 단, 아래 전제를 지킬 때만입니다.

1) **뉴스는 “메타/링크 인덱스”만** (GDELT)
    - 퍼블리셔의 **기사 본문/이미지/원문 헤드라인**을 저장·재배포하지 않습니다.
    - 우리는 **자체 생성 헤드라인(팩트 기반)**만 표시하고, 원문은 외부 링크로 이동합니다.

2) **지표는 공공/오픈 라이선스/공식 데이터 + 자체 해설**
    - BLS/BEA/EIA/Fed Board 등은 “대체로 공공영역(단, 제3자 자료 제외)” 성격으로 재사용 가능.
    - ECB는 “출처 표기 + 원자료/메타데이터 수정 금지”가 핵심 조건.
    - Eurostat/OECD/World Bank는 “예외/제3자/추가 제한”이 존재하므로 **조건부 게이트(conditional) 처리**가 필수.

3) **공시/발표 기반 속보는 “팩트”만 + 자체 생성 헤드라인**
    - SEC EDGAR는 **10 rps 제한 + User‑Agent 선언** 준수.
    - 원문 문서 재배포(대량) 대신 링크아웃.

4) **FRED는 “데이터 제공원에서 제외”**
    - 상업적 사용 및 저장/캐시/아카이브 금지 조항이 강하므로, 본 프로젝트는 FRED 데이터를 표시/저장/캐시하지 않습니다.
    - 허용: “View on FRED” 외부 링크(데이터 호출/렌더링 없이).

### 0.2 “비용 없이”의 현실적인 해석

- **데이터 라이선스 비용(license fee)은 0**으로 설계합니다.
- 그러나 **인프라 비용은 0이 아닙니다**(Cloudflare/Supabase).
    - Hyperdrive는 Workers Free/Paid 모두 포함이지만 Free는 일일 쿼리 제한이 있고(Paid는 Unlimited), 트래픽이 커지면 Paid가 사실상 필요합니다(광고 수익화 목적이면 더더욱).
    - Supabase도 Free tier가 있지만, DB 크기/트래픽/백업/리드레플리카 요구가 커지면 유료가 될 수 있습니다.

> 즉, “데이터 라이선스 비용 없이(=외부 데이터에 돈 안 내고)” 운영/광고 수익화는 가능.  
> “클라우드 인프라 비용까지 0”은 불가능하므로, **비용은 ‘최소화 + 수익화로 상쇄’**로 설계합니다.

---

## 1. Hard Constraints (Non‑Negotiable)

These rules override everything else.

### 1.1 FRED hard block (production)

- **FRED data MUST NOT be displayed, stored, cached, redistributed, or served** in production.
- **No ingestion pipeline** for FRED.
- Allowed: external link `View on FRED` only (no API fetch/render).

> FRED legal includes strong restrictions such as “Store/cache/archive prohibited” and commercial use limitations without written consent.  
> See: https://fred.stlouisfed.org/legal/ (see prohibitions including store/cache/archive and commercial use restrictions)

### 1.2 News: no republication of publisher content (ever)

**DO NOT store or render**:
- full article text
- publisher images
- publisher headlines “as‑is”
- long excerpts/quotes
- any “reconstructed” text that substitutes for the original article

**News feature = index metadata + link‑out only** via GDELT.

### 1.3 GDELT attribution + link is mandatory

- If using GDELT datasets, any use/redistribution **must include citation + link**.
- Terms: unlimited/unrestricted use (incl. commercial) without fee, but citation+link required.
- See: https://www.gdeltproject.org/about.html

### 1.4 SEC EDGAR fair access policy (strict)

- Global outbound request rate to SEC endpoints MUST be **<= 10 requests/second**.
- MUST declare **User‑Agent** in request headers, including company name + contact email.
- See: https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data

### 1.5 Workers runtime connection constraint (design impact)

- Per Worker invocation: **max 6 simultaneous open connections**, counting `fetch`, KV, Cache, R2, Queues, TCP sockets.
- SSE endpoints must not hold multiple outbound connections concurrently.
- See: https://developers.cloudflare.com/workers/platform/limits/

### 1.6 Hyperdrive + Supabase Postgres connection rules

- Use Hyperdrive with Supabase: **use “Direct connection” string**, not Supabase pooled strings (Hyperdrive does pooling).
- Worker must enable `nodejs_compat`.
- If using `pg`, minimum required version is `8.16.3`.
- See: https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-database-providers/supabase/

### 1.7 ECB: unmodified statistics + metadata

- ECB policy: reuse is free of charge if source is quoted and **statistics (incl. metadata) are not modified**.
- Practical: ECB raw series are **raw‑locked**; derived metrics are separate series with `is_derived=true`.
- See: https://www.ecb.europa.eu/stats/ecb_statistics/governance_and_quality_framework/html/usage_policy.en.html

### 1.8 Eurostat: exceptions + commercial reuse risk filter

- Eurostat allows broad reuse **except** where otherwise stated, including **third‑party rights** and specific exceptions.
- Practical: We will only use Eurostat rows in allowed geo scope (EU/EA/EFTA/candidate where safe).  
  Any non‑EU/EFTA/candidate country rows (e.g., US) are excluded at ingestion by default.
- References:
    - https://ec.europa.eu/eurostat/help/copyright-notice
    - (Supporting legal analysis often cited for non‑EU country data commercial restriction, implement conservative filter.)

### 1.9 OECD + World Bank: third‑party / license gating is mandatory

- OECD and World Bank may include third‑party material or dataset‑specific restrictions.
- Any unclear or restricted dataset MUST be `commercial_status=conditional` and **blocked from production** until cleared.
- References:
    - OECD terms: https://www.oecd.org/en/about/terms-conditions.html
    - OECD open policy: https://www.oecd.org/en/about/oecd-open-by-default-policy.html
    - World Bank data licenses overview: https://datacatalog.worldbank.org/public-licenses
    - World Bank dataset terms: https://www.worldbank.org/en/about/legal/terms-of-use-for-datasets

### 1.10 Ads + consent requirements (EU/UK/CH)

- EU/UK/CH: consent required for cookies/local storage where legally required and for personalized ads.
- If using Google ads: in EEA/UK, certified CMP integrated with TCF is required for personalized ads; Switzerland similarly requires certified CMP/TCF for personalized ads.
- References:
    - EU user consent policy: https://support.google.com/adsense/answer/7670013
    - CMP requirements: https://support.google.com/adsense/answer/13554116
    - Google consent help: https://www.google.com/intl/en_uk/about/company/user-consent-policy-help/
### 1.11 UI/UX Design System Constraints (Global, Non-Negotiable)

The following design system rules are mandatory across all frontend surfaces
(Home, Entity, Indicator, Filing, Alerts, Legal, etc).

#### 1.11.1 Design DNA (Brand Core)

- Dark mode baseline using **deep matte charcoal** background.
- Premium glassmorphism:
    - Translucent panels
    - Frosted blur
    - Subtle glossy edge highlights
    - Deep layered shadows
- Neon accent palette:
    - Sky blue + cyan glow highlights
- Non-flat dimensionality:
    - Multi-layer gradients
    - Light source illusion
    - Clear foreground / midground / background separation
- Premium fintech tone:
    - Minimal but cold, precise, high-end mood
    - No generic enterprise dashboard feel

This visual identity is required. Default template aesthetics are not acceptable.

---

#### 1.11.2 Motion & Interaction Policy

- Motion must be smooth and premium. Overly playful or bouncy animations are prohibited.
- Allowed interaction patterns:
    - Pointer-reactive parallax (subtle)
    - Hover depth illusion
    - Glow transitions
    - Staggered reveal for lists
- Animations must rely primarily on:
    - `transform`
    - `opacity`
- Avoid layout thrashing or repaint-heavy animations.
- Must fully support `prefers-reduced-motion`.

If `prefers-reduced-motion: reduce` is detected:
- Disable parallax
- Disable stagger
- Reduce glow intensity
- Use instant transitions or subtle fades only

---

#### 1.11.3 UX Hierarchy & Readability Rules

- Information hierarchy must be immediately readable.
- Typography, spacing, and luminance contrast must prioritize clarity over decoration.
- Data (numbers, percentages, charts) must feel precise and calm.
- Desktop, tablet, and mobile must preserve identical premium perception.
- Avoid visual clutter even in glass-heavy UI.

---

#### 1.11.4 Accessibility (Mandatory)

- WCAG contrast compliance (minimum AA level).
- Visible focus states for keyboard navigation.
- Fully keyboard navigable.
- Motion-reduction support required.
- Do not rely solely on color to convey meaning.

---

#### 1.11.5 Implementation Discipline

- All colors, motion intensities, blur strengths, glow levels, typography scales
  must be defined via design tokens (CSS variables).
- Tokens must be centralized.
- No hard-coded color values in components.
- File structure must remain maintainable and modular.
- High-end but restrained execution is mandatory.

Failure to comply with this section is considered a SPEC violation.

---

## 2. Product Scope

### 2.1 Goals

Deliver:
1) **Headline feed** (metadata‑based; self‑generated headlines)
2) **Ticker/entity filtering** (best‑effort; dictionary + SEC mapping; no inference that implies advice)
3) **Breaking alerts** (Web Push)
4) **Right panel key indicator charts** (6–10)
5) **SEC filing fact alerts** (self‑generated headline, link to SEC)
6) **Legal/Sources page** auto‑generated from DB license metadata
7) **Ads monetization** compliant with consent rules

### 2.2 Non‑Goals (v1)

- Real‑time equity quotes/prices
- Republishing/translation/summarization of publisher article content
- Investment advice / trading signals
- User‑generated content/community

### 2.3 Primary Pages

- `/` Home
    - Main: feed tabs
    - Right: Key Indicators charts (6–10)
- `/t/:slug` Entity page (company/agency)
- `/i/:seriesId` Indicator detail
- `/f/:accession` Filing detail (SEC metadata only)
- `/alerts` Alerts settings (Web Push)
- `/legal` Sources & licenses (auto)
- `/privacy` Privacy policy (mandatory: push + ads)
- `/terms` Terms of service (recommended)

---

## 3. Data Sources & Compliance Matrix (Ads‑Safe)

> “Commercial/Ads” = data can be used on pages that carry ads, **subject to gating and required attribution**.

### 3.1 Allowed (Production‑Safe by Default)

| Source | Use | Commercial/Ads | Storage | Mandatory | Special Rules |
|---|---|---:|---:|---|---|
| **GDELT** | news index metadata | ✅ | ✅ (metadata only) | cite+link | No publisher text/images/headlines as-is; self‑generated headline only |
| **SEC EDGAR** | filings metadata + official links | ✅ | ✅ | <=10 rps; declared UA | fact‑only headline; no filing text rehost |
| **BLS** | US labor stats | ✅ | ✅ | cite source requested | Avoid previously copyrighted photos/illustrations |
| **BEA** | US national accounts | ✅ | ✅ | cite requested | Don’t use BEA logo except linking identity; avoid endorsement confusion |
| **EIA** | US energy stats | ✅ | ✅ | cite with date recommended | Avoid third‑party/copyrighted exceptions |
| **Federal Reserve Board** | FRB stats | ✅ | ✅ | cite requested | Avoid non‑Board third‑party assets |
| **ECB (ESCB Stats)** | euro area stats | ✅ (with constraints) | ✅ (raw) | `Source: ECB statistics` | Do not modify stats/metadata; derived separate |

### 3.2 Conditional (Must Pass Gating Before Production)

| Source | Why conditional | Production rule |
|---|---|---|
| **Eurostat** | exceptions/third‑party and commercial‑reuse caveats | Only EU/EA/EFTA/candidate scope; exclude US rows; block any third‑party flagged dataset |
| **OECD** | mix of licenses; third‑party content possible | Only dataset explicitly under permissive license; block unclear/third‑party |
| **World Bank** | many datasets CC BY 4.0, but some third‑party restrictions | Only CC BY 4.0 datasets with no additional restrictions; block restricted/unclear |

### 3.3 Disallowed (Production)

| Source | Rule |
|---|---|
| **FRED** | No display/storage/caching/serving. External link only. |

---

## 4. System Architecture (Option A)

### 4.1 High‑Level Components

- **Cloudflare Pages**: React SPA hosting (global CDN)
- **Cloudflare Workers**: REST API + ingestion orchestrator + push sender + (optional) SSE gateway
- **Cloudflare Queues**: ingestion jobs + alert fanout
- **Cloudflare KV**: hot JSON caches (feed snapshots, key indicator cards, license page cache)
- **Cloudflare R2**: audit-only storage (SEC raw JSON, policy snapshots).
    - **Never store publisher news content**.
- **Supabase Auth**: user authentication (JWT)
- **Supabase Postgres**: canonical datastore
- **Cloudflare Hyperdrive**: Workers ↔ Supabase Postgres connection pooling/caching

**Optional (recommended for v1 stability):**
- **Durable Objects**
    - `SEC_LIMITER_DO`: global rate limiter (<=10 rps)
    - `EVENT_HUB_DO`: SSE/WebSocket broadcast hub (push new item IDs only)

### 4.2 Request/Flow Design

#### Public read (Home feed, indicators)
- Browser → **Workers API** (`/api/feed`, `/api/indicators/key`, `/api/series/:id`)
- Workers → KV (cache hit) OR Hyperdrive → Postgres
- Response includes **license badge payload** (attribution text from DB)

#### News
- Only GDELT-derived metadata + link‑out.

#### Filings
- Postgres stores filing metadata; UI links to SEC official pages.

#### Alerts
- Web Push subscription stored (encrypted); notifications are **self-generated copy + official link**.

#### Ads
- Ads are rendered in the browser, but scripts are loaded only after consent (EU/UK/CH rules).

### 4.3 Why this architecture is “enterprise grade”
- Canonical Postgres store (auditable, queryable, scalable)
- Edge delivery + caching (Workers/KV/Cache)
- Connection pooling at edge via Hyperdrive
- Strict compliance gates in code + DB metadata
- Separates “production display” from “quarantine/preview”

---

## 5. Infrastructure Setup Checklist (Cloudflare + Supabase + Hyperdrive)

### 5.1 Supabase setup (DB + Auth)

1) Create Supabase project
2) Enable Auth providers as desired (email, OAuth)
3) Create DB roles for Hyperdrive (least privilege recommended)

**Example SQL (run in Supabase SQL editor):**
```sql
-- create login role for Hyperdrive/Workers
create role hyperdrive_app login password 'REPLACE_WITH_STRONG_PASSWORD';

-- schema privileges
grant usage on schema public to hyperdrive_app;

-- table privileges (tighten later; start explicit)
grant select, insert, update, delete on all tables in schema public to hyperdrive_app;
grant usage, select on all sequences in schema public to hyperdrive_app;

-- optional: default privileges for future tables
alter default privileges in schema public
grant select, insert, update, delete on tables to hyperdrive_app;

alter default privileges in schema public
grant usage, select on sequences to hyperdrive_app;
```

> NOTE: Supabase + Hyperdrive guidance: use **Direct connection** string (not pooled).  
> https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-database-providers/supabase/

### 5.2 Hyperdrive configuration

Create Hyperdrive config with the **direct** Postgres connection string:

```bash
npx wrangler hyperdrive create ofp-prod \
  --connection-string="postgres://hyperdrive_app:<PASSWORD>@<SUPABASE_HOST>:5432/postgres"
```

Then bind it in `apps/worker/wrangler.toml`:

```toml
compatibility_date = "2026-02-16"
compatibility_flags = ["nodejs_compat"]

[[hyperdrive]]
binding = "HYPERDRIVE"
id = "<HYPERDRIVE_CONFIG_ID>"
```

### 5.3 Cloudflare resources

Provision:
- Pages project (apps/web)
- Worker (apps/worker)
- KV namespace: `OFP_KV`
- R2 bucket: `ofp-audit`
- Queues: `ofp-ingest`, `ofp-push`
- (Optional) Durable Objects:
    - `SEC_LIMITER_DO`
    - `EVENT_HUB_DO`

### 5.4 Worker DB driver requirement

If using `pg` driver in Workers+Hyperdrive:
- minimum `pg` version `>= 8.16.3`
- `nodejs_compat` enabled
- Create new `Client` per request (Hyperdrive manages pool)

Reference: https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-database-providers/supabase/

### 5.5 Secrets & config

Worker secrets (Cloudflare):
- `SEC_USER_AGENT` = `YourCompanyName contact@yourdomain.com`
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (`mailto:...`)
- `PUSH_DATA_ENC_KEY` (32 bytes base64 for AES‑GCM)
- `GDELT_MODE` (e.g. `GKG` or `2.1`)
- `ALLOWED_ORIGINS` (web origins)
- `ADS_PROVIDER` (e.g. `google`)
- `CMP_PROVIDER` (e.g. `didomi|sourcepoint|onetrust`)
- Any API keys needed for macro sources (most are open; prefer no keys)

Web (Pages) public env:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY` (public)
- `VITE_API_BASE_URL` (worker route)
- `VITE_VAPID_PUBLIC_KEY`
- `VITE_AD_CLIENT_ID` etc (public ad config)

---

## 6. Repo Layout

```text
/
├─ SPEC.md
├─ README.md
├─ apps/
│  ├─ web/                       # Vite + React (Cloudflare Pages)
│  │  ├─ src/
│  │  ├─ public/
│  │  └─ package.json
│  └─ worker/                    # Cloudflare Workers (API + ingestion + push)
│     ├─ src/
│     ├─ wrangler.toml
│     └─ package.json
├─ packages/
│  ├─ shared/                    # shared types, zod validators, utils
│  └─ policy/                    # license gating engine, attribution templates
├─ supabase/
│  ├─ migrations/                # Postgres migrations (SQL)
│  └─ seed.sql                   # initial sources/licenses config
├─ config/
│  ├─ key_indicators.json
│  ├─ sources.json
│  └─ licenses.json
├─ scripts/
│  ├─ lint/
│  ├─ test/
│  └─ ops/
└─ docs/
   ├─ PRIVACY.md
   ├─ TERMS.md
   └─ LEGAL_NOTICES.md
```

---

## 7. Work Packages (AI‑Assignable Modules)

Each module includes deliverables + constraints + acceptance tests.

### M1 — Frontend Layout + Routing (Pages)

**Deliverables**
- routes: `/`, `/t/:slug`, `/i/:seriesId`, `/f/:accession`, `/alerts`, `/legal`, `/privacy`, `/terms`
- components:
    - `SourceBadge`, `LicenseBadge`, `DisclaimerBlock`
    - `ConsentBanner` (CMP integration hook)
    - `AdSlot` (gated loader; no pre-consent scripts in EU/UK/CH)
    - `RightPanelIndicators` (sparkline charts)

**Constraints**
- Never render publisher headline/body/images.
- Feed items show self-generated headline only + external link.

**Acceptance**
- LCP <= 2.5s on broadband (Pages caching on)
- Lighthouse: no ad scripts loaded before consent in EU/UK/CH simulation
#### M1.1 Design System Implementation

Frontend must implement a centralized token system:

Required files:
- `src/styles/tokens.css`
- `src/styles/theme.css`
- `src/styles/motion.css`

Minimum token categories:

Color tokens:
- --bg-primary
- --panel-glass
- --accent-neon
- --glow-cyan
- --text-primary
- --text-muted

Motion tokens:
- --motion-fast
- --motion-medium
- --motion-slow
- --glow-intensity

Depth tokens:
- --shadow-deep
- --shadow-layered
- --blur-glass
- --radius-xl

Components must not define color or motion values inline.

---

#### M1.2 Glass & Depth Rules

- Glass panels must use backdrop blur.
- Shadows must create vertical depth hierarchy.
- Foreground cards must visually float above background layers.
- Glow effects must be subtle and controlled.

Flat, shadowless UI is prohibited.

---

#### M1.3 Motion Acceptance Criteria

The following must be implemented:

- Hover depth effect on feed cards.
- Subtle neon glow transition on interactive elements.
- Staggered reveal for feed list.
- Reduced-motion mode fallback.

Performance constraints:
- No frame drops on mid-range devices.
- Lighthouse performance score must not degrade due to animation.

---

#### M1.4 Visual Quality Acceptance

A build fails visual acceptance if:

- It resembles a generic admin template.
- Colors are default framework palette.
- UI appears flat and two-dimensional.
- Motion is abrupt or overly dramatic.
- Tokens are not centralized.

All major surfaces must visually express the defined Design DNA.

---

### M2 — Public API (Workers) + Caching

**Endpoints**
- `GET /api/feed`
- `GET /api/entity/:slug`
- `GET /api/indicators/key`
- `GET /api/series/:seriesId`
- `GET /api/f/:accession`
- `GET /api/legal`
- `GET /api/geo` (returns `country`, `region_policy`)

**Logic**
- KV snapshot cache (TTL 30–120s) for feed & key indicators
- Hyperdrive → Postgres for cache miss
- Response includes `license` payload (attribution text, disclaimers)

**Acceptance**
- p95 < 200ms cache hit
- p95 < 700ms cache miss (excluding upstream outages)

---

### M3 — Auth Integration (Supabase Auth + Worker JWT)

**Deliverables**
- Web: Supabase login/logout UI
- Worker: verify JWT and extract claims (cache JWKS)
- Protected endpoints:
    - `POST /api/push/subscribe`
    - `POST /api/push/unsubscribe`
    - `GET/POST /api/alerts/rules`

**Constraints**
- Never store Supabase service secrets in client.
- JWT verification uses JWKS endpoint:
    - `https://<project>.supabase.co/auth/v1/.well-known/jwks.json`

Reference: https://supabase.com/docs/reference/javascript/auth-getclaims

**Acceptance**
- Invalid token → 401
- User can only read/write their own alert rules

---

### M4 — GDELT Ingestion (Metadata‑Only)

**Rules**
- Store metadata only; never store publisher headline/body/images
- Generate headline from metadata (entity + spike + window)
- Mandatory GDELT citation+link visible in UI/legal

**Outputs**
- `content_items` with `item_type='gdelt_link'`
- `content_item_entities` (best-effort)

**Acceptance**
- DB has no columns that can store article body; ingestion strips all publisher content.

---

### M5 — SEC EDGAR Ingestion + Filings (Fact‑Only)

**Rules**
- Global <= 10 rps
- Declared User‑Agent string includes company+email
- Use DO global limiter or equivalent to guarantee

**Outputs**
- `filings` table (metadata)
- `content_items` with `item_type='sec_filing'` or `fact_flash`
- R2 stores raw SEC JSON only (audit)

**Acceptance**
- Load test confirms limiter never exceeds 10 rps
- Filing page shows metadata + link to SEC.gov, no rehosted text.

---

### M6 — Macro Ingestion (BLS/BEA/EIA/Fed/ECB/Eurostat/OECD/WB)

**Rules**
- License snapshot mandatory per dataset/series
- Gate third‑party/restricted as conditional (blocked from prod)
- ECB raw locked; derived separate
- Eurostat filter: exclude non‑EU/EFTA/candidate geos

**Outputs**
- `datasets`, `series`, `series_observations`
- Derived series stored as separate series (`is_derived=true`)

**Acceptance**
- Each series has effective license + attribution template
- “raw vs derived” separation unit test passes

---

### M7 — Alerts (Web Push)

**Endpoints**
- `POST /api/push/subscribe`
- `POST /api/push/unsubscribe`

**Rules**
- De‑dup: 1 notification per item per user
- Per-user rate limit: default 10/hour
- Push payload uses self-generated copy + official link
- Store subscription fields encrypted at rest

**Acceptance**
- Notifications include attribution footer when required
- Rate limit test passes

---

### M8 — Ads + Consent (CMP)

**Rules**
- EU/UK/CH: consent before loading non‑essential scripts/storage for ads personalization
- If using Google: certified CMP + TCF required for personalized ads in EEA/UK; also Switzerland
- Pre‑consent: either no ads or strictly compliant non‑personalized path (implementation must be CMP‑driven)

References:
- https://support.google.com/adsense/answer/7670013
- https://support.google.com/adsense/answer/13554116

**Acceptance**
- Pre‑consent in EU/UK/CH: no ad scripts loaded, no tracking storage written

---

### M9 — Legal / Sources Page (Auto)

**Must render from DB**
- sources, licenses, policy URLs, last reviewed dates
- GDELT citation+link, SEC fair access statement, ECB/Eurostat/OECD/WB attributions

**Acceptance**
- `/legal` content matches DB metadata; never stale beyond TTL

---

## 8. Canonical Data Model (Postgres SQL, License Metadata Included)

> Copy into `supabase/migrations/0001_init.sql` and apply with Supabase CLI.

```sql
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
  raw_locked boolean not null default false, -- e.g., ECB raw
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
  raw_ref text,              -- e.g., R2 key or SEC accession pointer
  meta jsonb                 -- safe metadata only (no publisher text)
);

create index if not exists idx_content_items_time on content_items(event_time desc);
create index if not exists idx_content_items_type_time on content_items(item_type, event_time desc);

create table if not exists content_item_entities (
  item_id uuid not null references content_items(item_id) on delete cascade,
  entity_id uuid not null references entities(entity_id) on delete cascade,
  role text, -- 'mentioned' | 'issuer' | 'authority' etc.
  primary key (item_id, entity_id)
);

-- provenance links content to datasets/series when applicable
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
  user_id uuid not null, -- references auth.users(id) but keep loose to avoid dependency in migration order
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
  r2_object_key text,     -- where full HTML/PDF stored in R2 (private)
  note text
);
```

> RLS/Privileges policy:
> - Public content MUST be served via Workers (license gating enforced centrally).
> - Do NOT grant `anon`/`authenticated` roles direct SELECT on `content_items`/`series_observations` unless you are 100% sure license gating cannot be bypassed.
> - Prefer: **Workers-only access** to data tables, Supabase Auth only for identity.

---

## 9. API Contract

### 9.1 Response Envelope (All endpoints)

```json
{
  "ok": true,
  "data": {},
  "meta": {
    "generated_at": "2026-02-16T00:00:00Z",
    "cursor": null,
    "cache": { "hit": false, "ttl": 0 }
  }
}
```

### 9.2 `GET /api/feed`

**Query**
- `tab`: `breaking|filings|macro|newsindex`
- `query`: string
- `region`: `US|EU|GLOBAL`
- `since`: ISO datetime
- `cursor`: opaque

**Item shape**
```json
{
  "item_id": "uuid",
  "item_type": "gdelt_link",
  "event_time": "2026-02-16T00:00:00Z",
  "headline": "Generated headline...",
  "summary": "Generated summary...",
  "external_url": "https://example.com/...",
  "entities": [{ "slug": "nvidia", "name": "NVIDIA", "primary_ticker": "NVDA" }],
  "source": { "name": "GDELT", "policy_url": "https://www.gdeltproject.org/about.html" },
  "license": {
    "code": "GDELT",
    "commercial_status": "allowed",
    "attribution_text": "Index data: GDELT (citation + link).",
    "disclaimer_text": "Publisher content is not hosted on this site."
  }
}
```

### 9.3 `GET /api/indicators/key`

Returns 6–10 key series cards (right panel).

### 9.4 `GET /api/series/:seriesId`

**Query**
- `from`, `to`
- `mode=raw|derived`

### 9.5 `GET /api/f/:accession`

Returns SEC filing metadata + SEC link; **no filing text extraction**.

### 9.6 Web Push
- `POST /api/push/subscribe`
- `POST /api/push/unsubscribe`

### 9.7 (Optional) SSE Stream
- `GET /api/stream?tab=breaking|macro|filings`
- Emits events containing only:
    - `item_id`, `event_time`, `tab`
- Client must fetch `/api/feed` to render actual cards (keeps SSE lightweight and within Workers connection constraints).

---

## 10. Ingestion (Cron → Queue → Worker Consumers)

### 10.1 Cron Frequencies (suggested)
- GDELT: every 5 minutes
- SEC: every 2–5 minutes
- Macro: every 1–6 hours (source-specific)
- Derived recompute: daily + after macro updates

### 10.2 Queue Message Shape
```json
{
  "job": "INGEST_SEC",
  "run_id": "uuid",
  "params": { "cursor": "..." }
}
```

### 10.3 Ingestion principles (critical)
- All upstream calls set explicit timeouts + retries with backoff
- All ingestion writes are idempotent (natural keys)
- Any dataset/series with unclear license is quarantined (`conditional`)
- Store audit blobs in R2 only for:
    - SEC JSON
    - policy snapshot HTML/PDF
- Never store publisher article content anywhere.

---

## 11. Compliance Gates (Automated Enforcement)

### Gate A — License snapshot mandatory
- If a dataset/series has no license:
    - may be stored as quarantined
    - **must not display in production** (any page with ads)

### Gate B — News metadata only
- Enforce schema + ingestion stripping:
    - no body/headline fields from publishers
    - only `external_url`, safe metadata, and generated headline

### Gate C — Eurostat geo filter
- During ingestion:
    - allow only EU/EA/EFTA/candidate geos (config-driven allowlist)
    - drop US/other rows by default

### Gate D — ECB raw immutability
- Mark ECB raw series as `raw_locked=true`
- Store hash on ingestion; validate hash unchanged
- Derived values stored in separate series (`is_derived=true`)

### Gate E — OECD/WB restricted data
- If metadata indicates third-party/restricted/unclear:
    - set `commercial_status=conditional`
    - hide from production until explicitly cleared

### Gate F — FRED hard block
- No jobs/endpoints for FRED
- Only allow external link text in UI

### Gate G — SEC global rate limit
- All SEC requests pass global limiter <=10 rps
- Must include declared User‑Agent (company + email)

---

## 12. Ads + Consent (EU/UK/CH)

### 12.1 Consent states (minimum)
- `essential` (always on)
- `analytics` (opt-in)
- `ads_nonpersonalized` (opt-in depending on region/provider policy)
- `ads_personalized` (opt-in; EU/UK/CH requires explicit consent)

### 12.2 Load policy (non-negotiable)
- EU/UK/CH (detected via `/api/geo` + CMP):
    - Before consent: **do not load ad scripts**
    - After consent:
        - if personalized consent: load personalized ads
        - else: optionally load non-personalized ads if policy permits and CMP signals configured
- Non‑EU:
    - follow local law; still offer privacy controls

### 12.3 CMP requirement (if Google ads)
- In EEA/UK: certified CMP integrated with TCF required for personalized ads
- Switzerland: certified CMP integrated with TCF required for personalized ads  
  References:
- https://support.google.com/adsense/answer/13554116
- https://support.google.com/adsense/answer/7670013

---

## 13. Security, Privacy, Abuse Prevention

### 13.1 Push subscription data protection
- Store endpoints and keys encrypted (AES‑GCM with `PUSH_DATA_ENC_KEY`)
- Rotate keys with re-encryption job (future)

### 13.2 JWT verification
- Worker verifies Supabase JWT using JWKS endpoint and caches keys
- Reference: https://supabase.com/docs/reference/javascript/auth-getclaims

### 13.3 API abuse control
- Cloudflare WAF / Rate Limiting (inbound) on `/api/*`
- Bot mitigation optional (Turnstile) for `/alerts` actions

### 13.4 “Not investment advice” disclaimer
- Show global disclaimer in footer and on `/legal`:
    - informational purposes only; no financial advice; verify with official sources.

---

## 14. Testing Plan

### 14.1 Compliance unit tests (must pass)
- `gdelt_metadata_only`: confirms no publisher text stored
- `eurostat_geo_filter`: confirms non‑allowed geos dropped
- `ecb_raw_immutable`: confirms raw values hash unchanged
- `sec_rate_limit`: ensures <=10 rps under load
- `fred_blocked`: confirms no FRED jobs/endpoints + no FRED tables/series

### 14.2 E2E tests
- Home renders feed + right panel charts
- EU simulation: ad scripts not loaded prior to consent
- External links open new tab with safe `rel="noopener noreferrer"`

---

## 15. Release Criteria (Definition of Done)

- [ ] No FRED data in DB/API/UI (link‑out only) — https://fred.stlouisfed.org/legal/
- [ ] GDELT citation + link visible — https://www.gdeltproject.org/about.html
- [ ] SEC global rate <=10 rps + declared UA — https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data
- [ ] ECB raw unmodified + derived separated — https://www.ecb.europa.eu/stats/ecb_statistics/governance_and_quality_framework/html/usage_policy.en.html
- [ ] Eurostat geo filter enforced; third-party exceptions gated — https://ec.europa.eu/eurostat/help/copyright-notice
- [ ] OECD/WB restricted gated — https://www.oecd.org/en/about/terms-conditions.html / https://datacatalog.worldbank.org/public-licenses
- [ ] EU/UK/CH consent prevents ad/tracking pre-consent — https://support.google.com/adsense/answer/7670013

---

## Appendix A — UI/Alert Copy Templates (License‑Safe)

### A.1 GDELT index card
- Title: `{Entity} index activity ({window})`
- Body: `Detected via index metadata. Open original sources for full coverage.`
- Footer: `Index data: GDELT. Source link in Legal.`

### A.2 Indicator card (right panel)
- Title: `{Indicator Name}`
- Value: `Latest: {value} ({period})`
- Delta: `YoY: {value}% (Derived by Open Finance Pulse)`
- Footer: `Source: {Agency}. {License/attribution snippet}`

### A.3 SEC filing fact alert (Push)
- Title: `[Filing] {Company} {FormType} filed`
- Body: `Filed {time}. Open SEC.gov for the official document.`
- CTA: `Open on SEC.gov`
- Footer (optional): `Source: SEC EDGAR (official).`

### A.4 Global disclaimer
- `This site is not endorsed by any data provider. Information only; not investment advice.`

---

## Appendix B — Known Risks & Mitigations

1) **Accidental publisher content replication**
- Mitigation: no DB columns for body/original headline; ingestion strips; code review + tests.

2) **Eurostat/OECD/WB exception missed**
- Mitigation: default to conditional + block; explicit allowlist; license snapshots; manual review workflow.

3) **SEC blocked due to rate violation**
- Mitigation: global DO limiter; circuit breaker; UA compliance; backoff.

4) **EU consent non-compliance**
- Mitigation: CMP-first loading; strict “no scripts pre-consent”; E2E tests.

5) **License policy changed**
- Mitigation: policy snapshot table + monthly review job; `/legal` shows last reviewed date.

---

## Appendix C — Source Policy URLs (Review Targets)

- FRED Legal: https://fred.stlouisfed.org/legal/
- GDELT Terms: https://www.gdeltproject.org/about.html
- SEC EDGAR access: https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data
- ECB reuse policy: https://www.ecb.europa.eu/stats/ecb_statistics/governance_and_quality_framework/html/usage_policy.en.html
- Eurostat copyright: https://ec.europa.eu/eurostat/help/copyright-notice
- OECD terms: https://www.oecd.org/en/about/terms-conditions.html
- OECD open policy: https://www.oecd.org/en/about/oecd-open-by-default-policy.html
- World Bank licenses: https://datacatalog.worldbank.org/public-licenses
- World Bank dataset terms: https://www.worldbank.org/en/about/legal/terms-of-use-for-datasets
- Google EU user consent policy: https://support.google.com/adsense/answer/7670013
- Google CMP requirements: https://support.google.com/adsense/answer/13554116
