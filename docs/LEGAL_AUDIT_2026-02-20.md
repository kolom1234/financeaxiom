# Legal & Copyright Audit (2026-02-20)

This is an engineering compliance audit log for repository-level legal/copyright risk.
It is not legal advice.

## 1) Progress Log

- 2026-02-20: Started full repository audit scope (copyright, license gating, terms/privacy/consent, source attribution).
- 2026-02-20: Indexed legal/compliance artifacts and routes:
  - `SPEC.md`
  - `docs/LEGAL_NOTICES.md`
  - `docs/PRIVACY.md`
  - `docs/TERMS.md`
  - `config/licenses.json`
  - `apps/worker/src/routes/legal.ts`
  - `apps/web/src/routes/LegalPage.tsx`
- 2026-02-20: Traced ingestion -> storage -> API flow for license gating:
  - ingestion: `apps/worker/src/ingest/live.ts`
  - queries: `apps/worker/src/services/postgres.ts`
  - public routes: `apps/worker/src/index.ts`, `apps/worker/src/routes/series.ts`, `apps/worker/src/routes/entity.ts`
- 2026-02-20: Reviewed privacy/consent implementation:
  - `apps/web/src/state/consent.tsx`
  - `apps/web/src/components/ConsentBanner.tsx`
  - `apps/web/src/routes/PrivacyPage.tsx`
  - `apps/worker/src/routes/accountAudit.ts`
  - `apps/web/src/routes/AlertsPage.tsx`
- 2026-02-20: Verified current compliance test status:
  - `npm run test:compliance` -> PASS
  - `npm run test:release-gate` -> PASS
- 2026-02-20: Applied remediation patch set for top-priority legal findings:
  - Added allow-only filters for entity/series DB reads.
  - Added route-level deny guard for non-allowed series payloads.
  - Added entity feed attribution text rendering.
  - Added integration tests for blocked series/entity outputs.
  - Verified with `npm run test:integration`, `npm run test:compliance`, `npm run -w apps/web typecheck`.
- 2026-02-20: Applied additional documentation/UX remediation:
  - Expanded privacy disclosures and retention descriptions.
  - Added user-facing consent reset/update controls on `/privacy`.
  - Added OSS notices process documentation and linked from legal notices.
- 2026-02-20: Upgraded public legal text surface (`/privacy`, `/terms`) with:
  - effective date
  - rights-request contact and workflow language
  - acceptable-use and availability clauses
  - governing-law baseline clause
- 2026-02-20: Implemented ad-consent compliance hardening for deployment:
  - Added TCF/GPP/USP signal bridge in ad runtime (`apps/web/src/components/AdSlot.tsx`).
  - Added US state privacy geo classification from `cf-region-code` (`apps/worker/src/routes/geo.ts`).
  - Added script removal on consent withdrawal/reset (`apps/web/src/state/consent.tsx`).
  - Added e2e coverage for EU/US-state signal-gated ad loading and reset behavior (`apps/web/e2e/app.spec.ts`).
- 2026-02-20: Added deployment compliance automation:
  - Added OSS notice generator and gate scripts:
    - `scripts/compliance/generate-third-party-notices.js`
    - `scripts/test/oss-notice-gate.js`
    - generated `THIRD_PARTY_NOTICES.txt`
  - Added production CMP smoke checker:
    - `scripts/test/cmp-deploy-smoke.js`
  - Added deploy-time ad metadata files:
    - `apps/web/public/ads.txt`
    - `apps/web/public/sellers.json`
  - Verification results:
    - `npm run test:oss-notice-gate` -> PASS
    - `npm run test:release-gate` -> PASS (includes OSS notice gate)
    - `npm run test:cmp-deploy` -> FAIL (current production bundle missing CMP markers; `ads.txt`/`sellers.json` return HTML shell)
- 2026-02-20: Deployed latest web build to Cloudflare Pages and re-verified production:
  - Deploy command:
    - `npx wrangler pages deploy apps/web/dist --project-name open-finance-pulse --branch main --commit-hash local-cmp-gate-20260220 --commit-message "cmp gate + oss notices + ad metadata files" --commit-dirty=true`
  - Deployment URL:
    - `https://38fa3d87.open-finance-pulse.pages.dev`
  - Post-deploy verification:
    - `npm run test:cmp-deploy` -> PASS

## 2) Findings (Severity-Ordered)

## High

### F-01: Public series API can expose conditional-license datasets (license gate bypass)

Evidence:
- Public route exposure:
  - `apps/worker/src/index.ts:172`
  - `apps/worker/src/index.ts:178`
- Series query lacks allow-only filter:
  - `apps/worker/src/services/postgres.ts:426`
  - `apps/worker/src/services/postgres.ts:461`
- Conditional datasets are ingested and stored as series:
  - `apps/worker/src/ingest/live.ts:1277` (`EU_UNEMPLOYMENT`)
  - `apps/worker/src/ingest/live.ts:1422` (`OECD_EA20_UNEMPLOYMENT`)
  - `apps/worker/src/ingest/live.ts:1504` (`WB_GLOBAL_GDP_USD`)

Risk:
- Even if feed/indicator pages filter to allowed licenses, direct calls to `/api/series/:id` can return conditional datasets by known/guessable series IDs.
- This conflicts with the project's "conditional/disallowed blocked in production" posture.

Recommendation:
- Enforce `commercial_status = 'allowed'` in series query path (or fail closed for non-allowed in route layer).
- Add integration tests that assert non-allowed series are rejected (403/404 policy response).

## Medium

### F-02: Public entity API lacks explicit license allow-only filter

Evidence:
- Public route exposure:
  - `apps/worker/src/index.ts:163`
  - `apps/worker/src/index.ts:169`
- Entity query by slug has no commercial-status filter:
  - `apps/worker/src/services/postgres.ts:353`
  - `apps/worker/src/services/postgres.ts:383`

Risk:
- If future content items with non-allowed licenses are linked to entities, `/api/entity/:slug` can disclose them.
- Current behavior depends on ingest conventions, not enforced query policy.

Recommendation:
- Apply allow-only license filtering in entity query (same as feed/indicators).
- Add regression tests for conditional/disallowed entity-linked items.

### F-03: Entity page omits full attribution text for displayed licensed content

Evidence:
- Entity page shows only badge, no attribution footer:
  - `apps/web/src/routes/EntityPage.tsx:40`
- Home page does render attribution text:
  - `apps/web/src/routes/HomePage.tsx:637`

Risk:
- Attribution-required sources (example: GDELT) may not have sufficient visible attribution in all content surfaces.

Recommendation:
- Render `item.license.attribution_text` on entity cards, matching home behavior.

### F-04: Privacy disclosure does not fully reflect implemented data handling

Evidence:
- Privacy page is very brief:
  - `apps/web/src/routes/PrivacyPage.tsx:1`
  - `apps/web/src/routes/PrivacyPage.tsx:6`
  - `apps/web/src/routes/PrivacyPage.tsx:7`
- Policy doc is also minimal:
  - `docs/PRIVACY.md:1`
  - `docs/PRIVACY.md:3`
  - `docs/PRIVACY.md:9`
- Account-audit flow stores email + details and persists for 30 days in KV:
  - `apps/worker/src/routes/accountAudit.ts:37`
  - `apps/worker/src/routes/accountAudit.ts:100`
  - `apps/worker/src/routes/accountAudit.ts:178`
- Local storage of audit events includes email:
  - `apps/web/src/routes/AlertsPage.tsx:75`
  - `apps/web/src/routes/AlertsPage.tsx:213`
  - `apps/web/src/routes/AlertsPage.tsx:339`
  - `apps/web/src/routes/AlertsPage.tsx:397`

Risk:
- Under-disclosure of what is stored, retention periods, and user rights can create policy/regulatory exposure.

Recommendation:
- Expand privacy and terms content to include data categories, retention, purpose/legal basis, user rights workflow, and contact/controller details.
- Explicitly disclose local storage keys and account-audit storage behavior.

### F-05: Consent can be given, but no in-product way to later change/revoke

Evidence:
- Banner is hidden once `hasDecision` is true:
  - `apps/web/src/components/ConsentBanner.tsx:6`
- Consent is persisted without a reset/reopen pathway:
  - `apps/web/src/state/consent.tsx:38`
  - `apps/web/src/state/consent.tsx:68`
  - `apps/web/src/state/consent.tsx:71`

Risk:
- In stricter jurisdictions, withdrawal/change controls should be continuously accessible.

Recommendation:
- Add persistent privacy controls (for example account/settings/footer modal) to modify consent anytime.

## Low

### F-06: Compliance tests pass but do not cover key legal bypass paths

Evidence:
- Compliance suite currently focuses on source-level gates and metadata-only logic:
  - `apps/worker/test/compliance/spec-compliance.test.ts:1`
- Integration tests check feed license payload but not series/entity allow-only enforcement:
  - `apps/worker/test/integration/api-routes.test.ts:499`
  - `apps/worker/test/integration/api-routes.test.ts:504`

Risk:
- Legal regressions in public endpoints can pass CI undetected.

Recommendation:
- Add endpoint-level legal tests for `/api/series/:id` and `/api/entity/:slug` with conditional/disallowed fixtures.

### F-07: OSS notice process is not documented; lockfile includes LGPL components

Evidence:
- LGPL licenses in lockfile:
  - `package-lock.json:1206`
  - `package-lock.json:1223`
  - `package-lock.json:1560`
- Existing legal notices focus on data-source policies:
  - `docs/LEGAL_NOTICES.md:1`
  - `docs/LEGAL_NOTICES.md:3`

Risk:
- If artifacts distributing linked binaries/third-party code are shipped, notice obligations may be missed.

Recommendation:
- Define OSS notice workflow (at least build-time report + shipped notices when distribution model requires it).

## 3) Positive Controls Confirmed

- GDELT metadata-only content transformation + blocked publisher fields:
  - `apps/worker/src/ingest/gdelt.ts:47`
  - `packages/policy/src/index.ts:73`
- FRED hard block gate exists:
  - `apps/worker/src/compliance/gates.ts:35`
- Feed and key indicators enforce allow-only filtering:
  - `apps/worker/src/services/postgres.ts:207`
  - `apps/worker/src/services/postgres.ts:315`
- SEC fair-access controls (declared User-Agent + 10 rps limiter) are implemented:
  - `apps/worker/src/services/sec.ts:4`
  - `apps/worker/src/do/secLimiter.ts:4`

## 4) Verification Snapshot

- `npm run test:compliance`: PASS (5 tests)
- `npm run test:release-gate`: PASS (all gates)

## 5) Priority Fix Order

1. Fix `/api/series` license gate (High).
2. Fix `/api/entity` license gate (Medium, defense-in-depth).
3. Ensure attribution text appears on entity cards.
4. Expand privacy/terms and consent management UX.
5. Add endpoint-level legal regression tests.

## 6) Remediation Status (After Patch)

Closed:
- F-01 (`/api/series` gate bypass) mitigated by:
  - DB filter: `apps/worker/src/services/postgres.ts:464`
  - Route fail-closed check: `apps/worker/src/routes/series.ts:22`
  - Regression test: `apps/worker/test/integration/api-routes.test.ts:524`
- F-02 (`/api/entity` allow-only missing) mitigated by:
  - DB filter: `apps/worker/src/services/postgres.ts:384`
  - Route-level allowed-only filtering: `apps/worker/src/routes/entity.ts:23`
  - Regression test: `apps/worker/test/integration/api-routes.test.ts:565`
- F-03 (entity attribution visibility) mitigated by:
  - UI attribution footer: `apps/web/src/routes/EntityPage.tsx:63`
- F-06 (missing endpoint-level legal regression tests) partially mitigated by new integration tests above.

Open:
- F-04 now partially mitigated by expanded disclosures:
  - `docs/PRIVACY.md:1`
  - `apps/web/src/routes/PrivacyPage.tsx:1`
- F-05 now mitigated by in-product consent reset/update controls:
  - `apps/web/src/state/consent.tsx:17`
  - `apps/web/src/routes/PrivacyPage.tsx:22`
- F-07 now mitigated by formal process documentation:
  - `docs/OSS_NOTICES_PROCESS.md:1`
  - `docs/LEGAL_NOTICES.md:19`

Residual:
- Final legal text should still be validated by counsel before broad commercial rollout.

## 7) Final Gate Check: Ads + Deployment (2026-02-20)

Decision:
- Core product deployment: acceptable.
- Monetized ad activation: hold until certified CMP vendor activation and real ad seller metadata are finalized.

Implemented mitigations:

1. CMP signal bridge added (TCF/GPP/USP).
   - `apps/web/src/components/AdSlot.tsx:42`
   - `apps/web/src/components/AdSlot.tsx:76`
   - `apps/web/src/components/AdSlot.tsx:110`
   - `apps/web/src/components/AdSlot.tsx:147`
   - `apps/web/src/components/AdSlot.tsx:176`

2. US-state privacy geo policy added.
   - `apps/worker/src/routes/geo.ts:34`
   - `apps/worker/src/routes/geo.ts:57`
   - `apps/worker/src/routes/geo.ts:59`

3. Consent withdrawal now removes loaded ad SDK scripts.
   - `apps/web/src/state/consent.tsx:87`
   - `apps/web/src/components/AdSlot.tsx:198`

4. E2E regression coverage for ad-policy scenarios added.
   - `apps/web/e2e/app.spec.ts:117`
   - `apps/web/e2e/app.spec.ts:160`
   - `apps/web/e2e/app.spec.ts:203`
   - `apps/web/e2e/app.spec.ts:229`

Residual blockers for ad launch:

1. Certified CMP operation is still an external runtime dependency.
   - Code now consumes standard CMP APIs, but this repository alone cannot prove a certified CMP is live in production pages.

2. OSS notice process exists, but release artifact generation is still operationally required.
   - `docs/OSS_NOTICES_PROCESS.md:31`
   - repository now includes `THIRD_PARTY_NOTICES.txt`; release packaging step must keep shipping it.

Live production verification (2026-02-20, post-redeploy):
- URL: `https://financeaxiom.com`
- Home status: `200`
- Bundle path observed: `/assets/index-BNg9Bp8F.js`
- CMP markers in bundle (`__tcfapi`, `__gpp`, `__uspapi`, `US_STATE_PRIVACY`, `ofpCmp*`): all present
- `https://financeaxiom.com/ads.txt` -> `200`, `content-type: text/plain`
- `https://financeaxiom.com/sellers.json` -> `200`, `content-type: application/json`
- Script run: `npm run test:cmp-deploy` (PASS)
- Note: repository now stages static replacements for these files at:
  - `apps/web/public/ads.txt`
  - `apps/web/public/sellers.json`

Non-blocking positives for copyright/data-source compliance:
- Public feed/entity/series endpoints now fail closed to allowed licenses:
  - `apps/worker/src/services/postgres.ts:207`
  - `apps/worker/src/services/postgres.ts:384`
  - `apps/worker/src/services/postgres.ts:464`
- Attribution text is rendered on Home and Entity feed cards:
  - `apps/web/src/routes/HomePage.tsx:637`
  - `apps/web/src/routes/EntityPage.tsx:63`
- Metadata-only safeguards for news content remain in place:
  - `packages/policy/src/index.ts:74`
  - `apps/worker/src/ingest/gdelt.ts:50`

Recommended release gate for ad launch:
1. Verify a certified CMP is live in production pages and emitting valid TCF/GPP/USP signals.
2. Bind CMP vendor configuration to deployment checks (preflight smoke test in CI/CD).
3. Generate and ship `THIRD_PARTY_NOTICES.txt` (or equivalent) per release artifact.
4. Re-run legal review after production validation and obtain counsel sign-off by launch jurisdiction.
