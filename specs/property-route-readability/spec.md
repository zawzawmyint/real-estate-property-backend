# Property route and write-boundary readability

Status: Verified on 2026-10-23.

## Goal

Keep property route declarations small and explicit, name their middleware boundaries, and make permitted database write fields visible without changing the API or permissions.

## Scope and exclusions

- In scope: extract the existing live staff guard into `src/modules/auth/auth.middleware.ts`; extract property transport/upload guards into `src/modules/properties/properties.middleware.ts`; simplify property route declarations; explicitly select writable property fields in the existing `toData` mapping.
- Preserve feature-local routes -> controller -> service -> repository -> Prisma. Services retain business rules, resource access and transaction ownership.
- Out of scope: new endpoints, dependencies, generic middleware frameworks, authentication protocol changes, database migrations, frontend changes and creation of a backend development skill.

## Behavior and contracts

- Existing [property contract](../property-management/contract.md) and [OpenAPI](../../docs/api/openapi.yaml) remain unchanged.
- Preserve middleware order: no-store; live session and route role checks; exact trusted Origin; required JSON content type; bounded JSON parsing; controller schema validation; service authorization/workflow; repository persistence.
- Photo writes retain live session/role/Origin checks followed by ID/resource/state checks and MIME validation before the request body is read or decoded. Preserve 5 MiB byte and current pixel/image constraints.
- Move `requireStaff` without changing live database session checks, role selection, safe errors or caller identity projection. Better Auth's native route/body handling remains separate.
- Keep strict Zod schemas rejecting unknown HTTP fields. Independently make `toData` select known writable fields rather than spread arbitrary runtime properties; preserve undefined omission, explicit null, false/zero values, AED minor-unit and area conversion, publishing state and availability patches.

## Acceptance criteria

- [x] Property routes declare endpoints and named middleware; no inline upload/body/origin policy remains in the route file.
- [x] Existing staff-guard callers import the dedicated auth middleware module; native auth route behavior is unchanged.
- [x] Authentication, roles, Origin/content-type failures, parsing limits, photo access-before-body order, response projections and lifecycle outcomes retain their existing contracts.
- [x] Unknown/internal runtime fields cannot enter `toData` output; valid writable fields, null, false/zero, omitted values and numeric transformations remain correct.
- [x] Backend quality checks and real-database/API regression tests pass; frontend Server Action property browser coverage still passes against the refactored backend.
- [x] Relevant specifications and architecture guidance reflect the implemented boundaries and actual verification evidence.

## Validation

- `tests/property-write-mapping.test.ts` first demonstrated that the former spread accepted unexpected runtime fields. Its three completed tests now verify the allowlist, all accepted fields and conversions, and null/undefined/false/zero handling.
- `bun run check` passed: lint, format check, generated-client typecheck, 14 test files / 59 tests, and production build. Existing real SQLite/API tests cover authentication, roles, malformed requests, strict fields, upload constraints, lifecycle and permissions.
- The 16 desktop/mobile property Playwright tests passed against the disposable backend fixture and existing proxy/warmup setup. The frontend retains its Server Action flow and no frontend production source changed.
- No schema, migration, dependency, configuration, OpenAPI, or public API changes were required.

## Risks and rollout

Moving guards can accidentally change error precedence or body consumption. Preserve route ordering and verify through real HTTP tests rather than source-text assertions. Explicit write mapping can omit a legitimate field; cover the complete accepted mapping. Roll back the affected modules if needed; no migration or configuration rollback is required.
