# Verification Report (2026-02-18)

This report captures additional verification after UI/UX and indicator-detail upgrades.

## Commands and Results

1. `npm run -w apps/web typecheck`
- Result: PASS.

2. `npm run -w apps/web lint`
- Result: PASS.

3. `npm run -w apps/web build`
- Result: PASS.
- Output bundle: `apps/web/dist/assets/index-DALlVEOU.js`.

4. `npm run test:release-gate`
- Result: PASS.
- Checks passed:
  - No FRED data path
  - GDELT citation visible
  - SEC 10 rps + declared UA
  - ECB raw vs derived separation
  - Eurostat geo filter enforced
  - OECD/WB restricted gated
  - EU pre-consent ad block

5. Pages deploy
- Command: `npx wrangler pages deploy apps/web/dist --project-name open-finance-pulse --branch main --commit-hash local-ux-final --commit-message "final ux polish + indicator text fix" --commit-dirty=true`
- Result: PASS.
- Deployment URL: `https://a82496d0.open-finance-pulse.pages.dev`.

6. Production probes
- `GET https://api.financeaxiom.com/api/feed?tab=breaking` -> `200`, `17` items.
- `GET https://api.financeaxiom.com/api/feed?tab=filings` -> `200`, `6` items.
- `GET https://api.financeaxiom.com/api/feed?tab=macro` -> `200`, `6` items.
- `GET https://api.financeaxiom.com/api/feed?tab=newsindex` -> `200`, `8` items.
- `GET https://api.financeaxiom.com/api/indicators/key` -> `200`, `9` cards.
- `GET https://financeaxiom.com` -> `200`, active script `/assets/index-DALlVEOU.js`.
- Bundle string checks: `Realtime Integrity Surface`, `Live Indicator Matrix`, `Latest Observations` found.

7. Runtime API base guard verification
- Context: local `.env.local` contains `VITE_API_BASE_URL=http://127.0.0.1:8787`.
- After runtime guard fix, browser requests from `https://financeaxiom.com` resolve to:
  - `https://api.financeaxiom.com/api/feed?...` (HTTP 200)
  - `https://api.financeaxiom.com/api/indicators/key` (HTTP 200)
- Result: PASS (`Live API Sync`, feed cards rendered from production API).

8. Mobile overflow/layout verification
- Mobile viewport: `390x844`.
- Runtime metrics:
  - `window.innerWidth=390`
  - `document.documentElement.scrollWidth=390`
  - `document.body.scrollWidth=390`
- Result: PASS (no horizontal overflow; UI no longer squeezed/tiny).
