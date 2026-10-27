# Shared-code naming and ownership

Status: Verified — 2026-10-27

## Goal

Remove misleading property ownership from infrastructure already shared by properties, leads, agency and staff operations.

## Scope and exclusions

- In scope: move Database and Transaction types and the existing serialized per-client transaction implementation into src/infrastructure/database/transaction.ts; rename propertyTransaction to serializedTransaction. Move noStore, requireTrustedOrigin and requireJsonContentType into src/shared/http/middleware.ts. Move foldSearch into src/shared/search/normalize-search-text.ts and rename it normalizeSearchText. Update all source, script, fixture, test and current-documentation consumers.
- Out of scope: transaction semantics, queue ownership, timeouts, middleware order, search normalization behavior, API/schema changes, dependency changes and unrelated cleanup. Preserve existing dirty feature work.

## Behavior and contracts

Keep one shared transaction queue per Prisma client, maxWait 10000 and timeout 15000, exception propagation and queue cleanup unchanged. Keep exact middleware behavior and route execution order. Search normalization remains null-to-empty, NFC normalization and lowercase. Properties retain property search fields/backfill and upload-only middleware. Use direct imports with no compatibility exports from former property modules. Remove an obsolete forwarding-only module only when its consumers are updated directly.

No routes, DTOs, permissions, errors, database schema, commands or runtime configuration change. Frontend companion: specs/shared-code-naming/spec.md. Existing backend-owned API contracts remain authoritative and unchanged.

## Acceptance criteria

- [x] Every transaction consumer uses serializedTransaction and infrastructure-owned Database/Transaction types; no propertyTransaction remains in active source/tests/scripts.
- [x] Shared HTTP guards are imported from shared/http/middleware; property upload checks retain feature ownership and route order.
- [x] Every search normalizer consumer imports normalizeSearchText from shared/search/normalize-search-text; no foldSearch remains in active source/tests/scripts.
- [x] Refactor preserves transaction serialization, public and staff security boundaries, normalized search and API behavior.
- [x] Required quality checks and affected cross-repository smoke tests pass; documentation is reconciled with evidence.

## Validation

Run bun run check, existing concurrency/search/auth/inquiry tests and affected isolated browser smoke tests. Use a disposable database for any database integrity check; do not operate against user data. Review source movement for exact behavior preservation and use existing behavior tests rather than implementation-mirroring rename tests.

## Risks and rollout

Move every caller atomically so no stale import path or duplicate transaction queue survives. Do not install packages, change API contracts, create migrations, commit or push. Rollback reverses this refactor while retaining previously delivered feature work.

## Implementation evidence

Backend `bun run check` passed: lint, formatting, generated-client TypeScript, all 94 tests in 23 files and production build. The actual database-check script passed against a migrated disposable fixture, verifying connection, staff/property/lead tables and search consistency before cleanup. The isolated desktop/mobile smoke run passed 11 tests with one intentional mobile skip (12 total). It covered property enquiry through Manager assignment and Agent visibility, general agency enquiry, protected property reads/404, streamed inventory and public loading/navigation. A fresh scoped audit found no actionable findings and confirmed exact behavior preservation. Runtime checks confirmed this checkout, clean Next configuration/session error state, public pages returning 200 and backend health/public reads returning 200. No schema, migration, dependency, API or command change was introduced.
