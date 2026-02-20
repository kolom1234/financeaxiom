# OSS Notices Process

This repository includes third-party open-source dependencies.
This document defines the minimum process for notice/license compliance in builds and releases.

## Scope

- Applies to all packages resolved through `package-lock.json`.
- Applies to production bundles, worker deployments, container images, and any redistributed artifacts.

## Required Checks Per Release

1. Generate dependency license inventory from the current lockfile.
2. Flag copyleft or mixed-license packages (for example GPL/LGPL/AGPL/MPL).
3. Confirm whether distribution model triggers notice/source-offer obligations.
4. Produce or update shipped notices file(s) for distributed artifacts.
5. Record review date and reviewer in release notes or compliance log.

Recommended commands:

- `npm run gen:oss-notices`
- `npm run test:oss-notice-gate`

## Current Notable Licenses

- The lockfile currently includes LGPL-related packages under `@img/sharp-*`.
- These packages require review of distribution context and corresponding notice obligations.

Reference evidence:
- `package-lock.json:1206`
- `package-lock.json:1223`
- `package-lock.json:1560`

## Output Artifacts

- `THIRD_PARTY_NOTICES.txt` (or equivalent) in release artifacts.
- Compliance review entry in the release checklist.

## Ownership

- Engineering owns automated inventory generation.
- Release owner confirms notice bundle inclusion before deployment.
