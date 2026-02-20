# SPEC Progress Ledger

Last updated: 2026-02-18 (local session)

## Status Legend

- `DONE`: implemented and verified locally.
- `PARTIAL`: implemented, but runtime-only validation is pending.
- `TODO`: not implemented yet.

## Completion Score

- Scope basis: critical requirements from `SPEC.md` Sections 5, 7 (M1/M4/M5/M6/M7/M8/M9), 9, 10, 11, 12, 15.
- Formula: `(DONE + 0.5 * PARTIAL) / TOTAL`.
- Current: `25 DONE`, `0 PARTIAL`, `0 TODO` out of `25`.
- Score: `100.0%`.

## Requirement Checklist

| ID | SPEC Reference | Evidence Location | Verification Method | Status |
|---|---|---|---|---|
| INF-01 | `SPEC.md:381-399`, `SPEC.md:413-419` | `apps/worker/wrangler.toml:1`, `apps/worker/wrangler.toml:39` | `npm run -w apps/worker build` | DONE |
| INF-02 | `SPEC.md:401-412` | `apps/worker/wrangler.toml:17`, `apps/worker/wrangler.toml:35`, `apps/worker/wrangler.toml:44` | config review | DONE |
| INF-03 | `SPEC.md:422-439` | `apps/worker/wrangler.toml:9`, `apps/web/src/lib/apiBase.ts:6` | `npm run typecheck` + config review | DONE |
| INF-04 | `SPEC.md:1019-1024` | `apps/worker/wrangler.toml:6`, `apps/worker/src/index.ts:111` | scheduler unit tests (`test/unit/scheduler.test.ts`) | DONE |
| WEB-01 | `SPEC.md:487` | `apps/web/src/App.tsx:42` | `npm run test:e2e` | DONE |
| WEB-02 | `SPEC.md:488-493`, `SPEC.md:505-533` | `apps/web/src/components/RightPanelIndicators.tsx:132`, `apps/web/src/styles/tokens.css`, `apps/web/src/styles/theme.css`, `apps/web/src/styles/motion.css` | `npm run -w apps/web build` | DONE |
| WEB-03 | `SPEC.md:1140` | `apps/web/src/routes/HomePage.tsx:95`, `apps/web/src/routes/EntityPage.tsx:41`, `apps/web/src/routes/FilingPage.tsx:33` | `npm run test:e2e` | DONE |
| WEB-04 | `SPEC.md:694-704`, `SPEC.md:1091-1096` | `apps/web/src/components/AdSlot.tsx:11`, `apps/web/src/components/ConsentBanner.tsx:13`, `apps/web/src/state/consent.tsx:29` | `npm run test:e2e` | DONE |
| M4-01 | `SPEC.md:621-634` | `apps/worker/src/ingest/live.ts:187`, `supabase/migrations/0001_init.sql:102`, `apps/worker/src/compliance/gates.ts:14` | `npm run test:compliance` | DONE |
| M5-01 | `SPEC.md:640-651`, `SPEC.md:1076-1079` | `apps/worker/src/services/rateLimiter.ts:4`, `apps/worker/src/services/sec.ts:4`, `apps/worker/src/do/secLimiter.ts:1` | `npm run test:load:sec` (`accepted=10`) | DONE |
| M5-02 | `SPEC.md:645-652`, `SPEC.md:1003` | `apps/worker/src/ingest/live.ts:299`, `apps/worker/src/routes/filing.ts:7`, `supabase/migrations/0001_init.sql:149` | `npm run test:integration` | DONE |
| M6-01 | `SPEC.md:655-665` | `apps/worker/src/ingest/live.ts:1271`, `apps/worker/src/ingest/live.ts:1278` | `npm run test:unit` + `npm run test:integration` | DONE |
| M6-02 | `SPEC.md:660`, `SPEC.md:1062-1066` | `apps/worker/src/compliance/gates.ts:22`, `apps/worker/src/ingest/live.ts:706`, `apps/worker/src/services/postgres.ts:165` | `npm run test:compliance` | DONE |
| M6-03 | `SPEC.md:661`, `SPEC.md:1057-1061` | `apps/worker/src/compliance/gates.ts:18`, `packages/policy/src/index.ts:45`, `apps/worker/src/ingest/live.ts:945` | `npm run test:compliance` | DONE |
| M6-04 | `SPEC.md:659`, `SPEC.md:1067-1071` | `apps/worker/src/compliance/gates.ts:28`, `apps/worker/src/ingest/live.ts:1033`, `apps/worker/src/ingest/live.ts:1176` | `npm run test:compliance` | DONE |
| M6-05 | `SPEC.md:668-670` | `apps/worker/src/services/postgres.ts:149`, `apps/worker/src/services/postgres.ts:195` | `npm run test:integration` | DONE |
| API-01 | `SPEC.md:991-1013` | `apps/worker/src/index.ts:33`, `apps/worker/src/index.ts:36`, `apps/worker/src/index.ts:39`, `apps/worker/src/index.ts:45` | `npm run test:integration` | DONE |
| ING-01 | `SPEC.md:1025-1032` | `apps/worker/src/types.ts:128`, `apps/worker/src/index.ts:98`, `apps/worker/src/ingest/queue.ts:20` | `npm run test:unit` | DONE |
| ING-02 | `SPEC.md:1035-1041` | `apps/worker/src/ingest/live.ts:145`, `apps/worker/src/services/ingestDb.ts:238`, `apps/worker/src/services/ingestDb.ts:301` | `npm run test:integration` + code review | DONE |
| GATE-F | `SPEC.md:1072-1075`, `SPEC.md:1146` | `apps/worker/src/compliance/gates.ts:36`, `packages/policy/src/index.ts:28`, `apps/worker/src/ingest/types.ts:3` | `npm run test:release-gate` | DONE |
| M8-01 | `SPEC.md:691-704`, `SPEC.md:1152` | `apps/web/src/components/AdSlot.tsx:11`, `apps/web/src/components/ConsentBanner.tsx:13` | `npm run test:e2e` | DONE |
| M9-01 | `SPEC.md:707-715` | `apps/worker/src/routes/legal.ts:1`, `apps/web/src/routes/LegalPage.tsx:10` | `npm run test:integration` + legal cache path review | DONE |
| M7-01 | `SPEC.md:675-688` | `apps/worker/src/routes/push.ts:21`, `apps/worker/src/services/crypto.ts:23`, `supabase/migrations/0001_init.sql:166`, `apps/worker/src/services/postgres.ts:426` | `npm run test:integration` | DONE |
| M7-02 | `SPEC.md:680-687` | `apps/worker/src/push/queue.ts:113`, `apps/worker/src/services/store.ts:529`, `apps/worker/src/services/postgres.ts:663`, `apps/worker/src/index.ts:140` | `npm run -w apps/worker test:unit` + `npm run -w apps/worker test:integration` | DONE |
| REL-ALL | `SPEC.md:1146-1153` | `scripts/test/release-gate.js:8` | `npm run test:release-gate` (all PASS) | DONE |

## Local Verification Snapshot (This Session)

Executed successfully:

- `npm run typecheck`
- `npm run lint`
- `npm run build`
- `npm run test:unit`
- `npm run test:integration`
- `npm run test:compliance`
- `npm run test:e2e`
- `npm run test:load:sec`
- `npm run test:release-gate`

Detailed evidence is archived in:

- `docs/VERIFICATION_2026-02-17.md`
- `docs/SPEC_AUDIT_2026-02-18.md`
