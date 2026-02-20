# Open Finance Pulse

Implementation repository for `SPEC.md`.

## Workspace Layout

- `apps/web`: React + Vite frontend (Cloudflare Pages target)
- `apps/worker`: Cloudflare Worker API/ingestion/push
- `packages/shared`: shared types/utilities
- `packages/policy`: compliance/license gate engine
- `supabase`: SQL migrations + seed data
- `config`: indicator/source/license config files
- `docs`: privacy/terms/legal notice drafts

## Quick Start

```bash
npm install
npm run build
npm run test:unit
npm run test:integration
npm run test:compliance
npm run test:e2e
```

## Notes

- Production infra setup follows Section 5 in `SPEC.md`.
- Legal/compliance constraints in Section 1 and Section 11 are enforced by tests and policy gates.

