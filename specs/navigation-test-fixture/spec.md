# Navigation browser-test account isolation

Status: Verified
Date: 2026-10-23

## Goal

Give the frontend navigation regression coverage dedicated, disposable staff identities without changing production authentication behavior.

## Scope and exclusions

`scripts/auth-e2e-server.ts` provisions two Manager accounts through the existing fixture operator:

- `e2e-navigation-desktop@example.com` (`Navigation E2E desktop`)
- `e2e-navigation-mobile@example.com` (`Navigation E2E mobile`)

They use the existing required temporary `STAFF_E2E_PASSWORD`, fixture SQLite database and cleanup lifecycle. This excludes production provisioning, public endpoints, role/permission changes, rate-limiter changes, migrations and real staff data.

## Behavior and contracts

The accounts exist only while the standalone fixture process runs. They give desktop and mobile browser projects separate sign-in budgets from the existing authentication and property-workflow accounts. The native Better Auth API, Express authorization behavior and limiter configuration are unchanged.

## Acceptance criteria

- [x] The desktop and mobile navigation projects authenticate through the native flow using separate disposable Manager accounts.
- [x] Navigation checks do not consume the authentication suite's accounts.
- [x] No production auth endpoint, schema, migration, role or limiter behavior changes.

## Validation and limits

On 2026-10-23, `bun run check` passed (59 tests plus lint, formatting, type checking and build). The integrated Chromium suite passed 62 tests with 2 duplicate width sweeps skipped against an isolated backend fixture and proxy. The accounts are test infrastructure; they are not production users or a supported provisioning mechanism.
