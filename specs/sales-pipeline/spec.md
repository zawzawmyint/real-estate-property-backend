# Sales pipeline integration fixture

Status: Verified (2026-10-27)

## Goal

Verify the frontend sales pipeline against real lead permissions without sharing sign-in rate budgets with other browser suites.

## Scope and exclusions

- In scope: dedicated disposable desktop/mobile Manager and Agent identities in the existing auth browser fixture.
- Out of scope: production accounts, new API routes, schema changes or stage business rules.

## Behavior and contracts

The frontend consumes the existing backend-owned [lead contract](../lead-management/contract.md). The standalone test fixture provisions `e2e-pipeline-{desktop|mobile}-{manager|agent}@example.com` using the caller-provided temporary `STAFF_E2E_PASSWORD`. Existing role authorization and optimistic versions remain authoritative. No production provisioning or public sign-up is introduced.

## Acceptance criteria

- [x] Pipeline browser tests authenticate using their own disposable identities.
- [x] Cross-stage writes and activity history use existing lead APIs.
- [x] Agent ownership, reassignment and expired-session scenarios pass.
- [x] Backend quality checks pass; no API/schema change is required.

## Validation

Run the backend quality suite and frontend pipeline integration tests using the isolated disposable fixture.

## Risks and rollout

Only test fixture provisioning changes. Temporary databases and accounts are removed by the existing fixture lifecycle. Production deployments require no migration or configuration changes.

## Implementation evidence

Verified 2026-10-27. Frontend API drift, lint, formatting and type checks passed with 142 unit tests in 26 files and an isolated production Webpack build. Backend `bun run check` passed with 78 tests in 20 files, including its build. The full isolated desktop/mobile browser regression passed 140 tests with 6 conditional viewport skips (146 total); focused pipeline coverage passed 20 tests with 2 mobile skips for desktop-only dragging. Coverage includes pointer and keyboard drag/cancel, terminal confirmation, conflicts, role ownership/reassignment, pagination/retry, held reads, lost save responses and session loss. Layouts were checked at 320, 390, 768 and 1440px; desktop/mobile screenshots were visually reviewed. Next.js DevTools confirmed an active pipeline browser session with no configuration or session errors.

The production lead contract and business behavior are unchanged. This repository only adds dedicated disposable pipeline Manager/Agent identities, separately for desktop and mobile, to prevent sharing sign-in rate budgets with lead regression tests. Frontend packages are not backend dependencies.
