# Security Remediation Log (2026-02-20)

## Scope
- Apply security hardening fixes identified in the latest full audit.
- Include code and configuration changes.
- Keep a step-by-step execution record to avoid repeated/forgotten work.

## Execution Record
1. Initialized remediation session and captured baseline project state.
2. Created this log before edits.
3. Added `RateLimiterDO` and wired atomic rate-limit checks through `checkRateLimit(..., RATE_LIMITER_DO)`.
4. Hardened auth rate-limit keying to hash key seeds (no raw access token/email seed in rate-limit keys).
5. Replaced JSON body parsing path with byte-limited stream reads + `content-length` precheck.
6. Added per-user/IP rate limits for push subscribe/unsubscribe.
7. Added public read rate limits for feed/entity/series/filing/indicators/legal/geo in API router.
8. Added redirect allowlist validation for password reset (`AUTH_ALLOWED_REDIRECT_ORIGINS`).
9. Added fail-closed policy for DB read fallback unless `ALLOW_MEMORY_READ_FALLBACK=1` or test bypass mode.
10. Added URL sanitization for filing external links on both worker response and web rendering.
11. Added decode guard for dynamic path extraction (`decodeURIComponent` try/catch).
12. Added frontend `_headers` baseline (CSP + security headers) and strengthened Supabase auth policy defaults.
13. Upgraded lint/test/build tooling (`eslint@10`, `vite@7`, `vitest@4`, plugin updates) and regenerated lockfile.
14. Updated worker integration test mocks to include `RATE_LIMITER_DO` and new fail-closed conditions.
15. Added new unit coverage for `RateLimiterDO`.
16. Verification run:
   - `npm run lint` ✅
   - `npm run build` ✅
   - `npm run test:unit` ✅
   - `npm run test:integration` ✅
   - `npm run test:compliance` ✅
   - `npm run test:release-gate` ✅
17. Security audit result:
   - `npm audit --omit=dev` => 0 vulnerabilities.
   - `npm audit` => dev-only advisories remain in eslint/typescript-eslint chain (no direct fix available in current ecosystem path).
18. Deployment status:
   - Completed in-session.
   - Removed `SUPABASE_ANON_KEY` placeholder var from `apps/worker/wrangler.toml`.
   - Registered `SUPABASE_ANON_KEY` as Worker secret using `wrangler secret put`.
   - Deployed Worker: `open-finance-pulse-worker` (latest version active).
   - Built web app with production Supabase/API env values and deployed to Pages project `open-finance-pulse`.
   - Confirmed live `financeaxiom.com` bundle references production API/Supabase endpoints and no explicit loopback URLs.
