# Verification Report (2026-02-17)

This report captures reproducible command results for the current implementation.

## Commands and Results

1. `npm run typecheck`
- Result: PASS (web/worker/policy/shared all pass).

2. `npm run lint`
- Result: PASS (web/worker/policy/shared all pass).

3. `npm run build`
- Result: PASS (shared, policy, worker, web build success).

4. `npm run test:unit`
- Result: PASS.
- Highlights:
  - policy tests pass.
  - worker unit tests pass.
  - new tests pass:
    - `test/unit/pushQueue.test.ts`
    - `test/unit/scheduler.test.ts`

5. `npm run test:integration`
- Result: PASS.
- Highlights:
  - API route integration tests pass.
  - queue fanout integration test passes (`PUSH_FANOUT_BREAKING`).

6. `npm run test:compliance`
- Result: PASS.

7. `npm run test:e2e`
- Result: PASS (3/3).

8. `npm run test:load:sec`
- Result: PASS (`sec_rate_limit passed: accepted=10`).

9. `npm run test:release-gate`
- Result: PASS (all gate checks).

## Notable Implemented Items Verified in This Run

- Cron schedule split in Worker config and scheduler logic.
- Push fanout queue flow with:
  - per-user/item dedupe,
  - per-user 10/hour cap,
  - attribution footer in payload,
  - audit write path,
  - DB-first fallback behavior for subscriptions/rules/notification events.
- Legal route cache TTL path (`OFP_KV`) with DB-first response.
