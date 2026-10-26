# Project review remediation

Status: Verified (2026-10-26).

## Purpose

Resolve unbounded application-side property search found in the October 23 project review.

## Scope

Move literal Unicode search matching, counts and pagination into SQLite so a search never materializes the entire candidate inventory in Node. Preserve NFC normalization, lowercase matching, literal percent/underscore, filters, sorting, stable IDs and pagination. Internal search representation may change; public DTOs do not.

The disposable browser fixture seeds its existing fictional featured listings by default so photo tests run independently of property-test order. Set `STAFF_E2E_SEED_PROPERTIES=0` to opt out for targeted suites that do not exercise public photos. This does not seed ordinary development/production databases.

## Permissions and contracts

Public searches remain limited to published available properties. Staff search retains live role/session enforcement and owner-field projections. The backend property-management contract remains authoritative; no endpoint or response shape changes.

## Acceptance criteria

- [x] Matching and counting execute in SQLite, with only page-sized property results loaded into Node.
- [x] Unicode, literal wildcard characters, combined filters, stable sorting and counts retain existing semantics.
- [x] Existing records and create/update/demo-seed paths produce consistent search results.
- [x] Existing authorization and private-field projections remain intact.
- [x] Quality gates, disposable migration/database checks and cross-repository browser tests pass.

## Validation

Exercise existing Unicode/literal search API tests and add pagination/write/backfill coverage appropriate to the chosen representation. Verify migration compatibility on a disposable database and run check/db:check.

## Rollout and risks

Apply migration `202610230001_property_search` before starting the updated application. Stop writes, back up the matching SQLite database and media, then generate the updated Prisma client, run `bun run db:migrate` and `bun run db:check`, and restart. The idempotent bounded NFC/lowercase backfill preserves business timestamps. Arbitrary substring matching remains an O(N) SQLite scan, but only page-sized IDs and DTOs are materialized in Node.

## Implementation evidence

- The migration adds internal normalized title, city and community columns. Parameterized SQLite `instr()` and `COUNT(*)` perform literal Unicode matching/counting; create, update and demo-seed paths maintain the same folds. Public DTOs, owner projections and authorization behavior are unchanged.
- The October 23 local maintenance run stopped writes, backed up the local SQLite database at `backend/var/review-backup-2026-10-23T13-51-30.766Z`, then migrated and checked the database.
- `bun run check` exited 0 on 2026-10-26: lint, formatting, type checking, 60 tests in 15 files and the production build passed. `bun run db:check` also exited 0 against the existing local SQLite schemas and normalized search fields.
- The isolated frontend browser suite exited 0 on 2026-10-26 with 80 cases discovered, 76 passed and four intentional viewport-project skips; property search, permissions, loading, retry and image flows passed against disposable fixture services.
