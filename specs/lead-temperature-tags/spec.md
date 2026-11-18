# Lead temperature tags

Status: Verified — 2026-11-18. P2-06 is complete; no deployment or normal-database migration is claimed.

## Goal

Persist a permission-scoped manual assessment of lead interest/readiness so staff can prioritize follow-up independently of pipeline stage.

## Scope and exclusions

- Include one temperature per lead, explicit versioned updates, activity history, staff DTO projection and combined list/export filters used by the CRM list and pipeline.
- Values: `hot`, `warm`, `cold`, `unassessed`; display the latter as Not assessed. Hot means strong interest/readiness soon; Warm means interested with unresolved decisions; Cold means low current engagement or a distant timeline. Guidance is descriptive, not an automatic classifier.
- Exclude scoring, scheduled aging, suggestions, bulk changes, custom tags, messaging, new reports, public exposure, create/contact-edit controls and CSV column/import-contract changes.

## Behavior and contracts

The main OpenAPI entry must resolve imported cookie-security requirements. Retain `staffCookie` and provide the `StaffCookie` and `staffSession` aliases used by referenced staff contracts. A backend dev-only semantic regression must resolve external references, reject every undeclared security-scheme name in the main document, and validate session-cookie declarations for lead list/create/export and temperature writes; substring checks and type generation alone are insufficient.

The [backend-owned contract](contract.md) defines the implemented routes, exact fields, errors and compatibility. Express owns permissions, validation and transactional writes; the frontend consumes its synchronized contract.

The implemented additive migration adds non-null `Lead.temperature` with database default `unassessed`, plus nullable `LeadActivity.previousTemperature` and `nextTemperature` for structured `temperature_changed` events. Existing activities retain nulls. The `(temperature, createdAt, id)` index supports the new filter.

The additive migration gives historical leads `unassessed` without changing IDs, business fields, versions, timestamps, receipts or history. All creation paths inherit the default, including manual/CSV/property inquiry/agency inquiry. No temperature write field is added to those input contracts. No automatic inference, job or backfill service is included.

The dedicated temperature route follows existing routes -> controller -> service -> repository -> Prisma boundaries. In a serialized transaction it locks the lead, validates current staff identity/resource access and checks expectedVersion before no-op comparison. A real change writes temperature/version/updatedAt and a from/to activity atomically. A current-version same-value request returns current detail without an update/event; stale same-value input still conflicts. A failed transaction persists neither update nor event.

Admin/Manager access all agency leads; Agents access only current assignments. Current assignment decides access after reassignment. Inaccessible and nonexistent records follow existing 404 behavior; no hidden counts or public fields. Do not change lead stage, assignment, task/viewing state, duplicate guards, submission receipts or notification producers.

Preserve existing authentication statuses: 401 UNAUTHENTICATED for missing/expired/invalidated sessions and disabled/banned staff; 403 FORBIDDEN for an authenticated role restriction; 404 NOT_FOUND for inaccessible/nonexistent resources. All three staff roles can use the temperature operation, subject to resource scope. Do not change requireCurrentStaff to satisfy a newly invented disabled-staff 403 expectation.

Extend the existing leadSelect/DTO and LeadSummary/LeadDetail contracts with temperature. Expose `temperatureChange` only in staff activity DTOs as described in the contract. Filter using the shared parameterized SQL predicate for list counts/rows and export so filters apply before pagination and preserve role scopes. Export columns, import templates/version/digests and committed receipt replay remain unchanged.

Frontend integration must preserve repeated temperature parameters through list/pipeline page validation and reject them before a lead-result fetch. Detail-screen local coordination includes assignment as well as temperature, stage and notes/calls, including already-open assignment dialogs and failed-reconciliation blocking. These frontend responsibilities do not weaken independent backend version/permission enforcement.

## Acceptance criteria

- [x] The main OpenAPI entry semantically resolves lead list/create/export/temperature security requirements to the session-cookie scheme; all `staffCookie`/`StaffCookie`/`staffSession` references resolve, and the document-wide regression rejects undeclared names.

- [x] Fresh and populated disposable migrations set historical/new leads to unassessed while preserving historical data, versions/timestamps and receipts; rerunning the migration command is safe.
- [x] Staff reads return the validated four-value field; all creation paths default to unassessed and reject attempts to supply temperature in unchanged strict input contracts.
- [x] Dedicated writes validate the exact body, enforce trusted Origin/session/live resource access and optimistic versions, and return existing safe error envelopes.
- [x] Disabled/banned/invalidated sessions return 401, authenticated role restrictions return 403, and inaccessible Agent resources return 404; frontend recovery distinguishes these outcomes without changing auth behavior.
- [x] Concurrent changes cannot silently overwrite; same-current-version no-op writes do not increment version/timestamp or add activity, while stale same-value writes conflict.
- [x] Real transitions, including reset and Won/Lost leads, create exactly one correct actor/from/to event atomically; rollback leaves no partial change.
- [x] Assignment, stage, contact, inquiry, import, tasks and viewings preserve temperature except for the explicit dedicated mutation.
- [x] Combined temperature/search/stage/source/agent/duplicate filters yield correct scoped counts/pages/export rows; invalid/repeated filters fail safely.
- [x] Existing CSV bytes/column contracts, import receipt recovery and public inquiry/chatbot boundaries remain compatible.
- [x] Backend full checks, disposable database/migration checks, OpenAPI parity and frontend cross-repository acceptance have recorded passing evidence before P2-06 is verified.
- [x] Cross-repository browser acceptance rejects repeated temperature parameters at actual list/pipeline entries and blocks local assignment/temperature races while pending or awaiting successful reconciliation.

## Validation

`tests/lead-temperature.test.ts`, `tests/lead-temperature-migration.test.ts` and `tests/lead-temperature-contract.test.ts` cover domain/defaults/HTTP roles, no-op/stale behavior, serialized races, reassignment/disabled-session checks, transaction rollback, migration preservation, event integrity and main OpenAPI references. The contract regression uses `@redocly/openapi-core` to resolve the main document, verifies all `staffCookie`/`StaffCookie`/`staffSession` names, walks every declared/inherited operation security requirement to reject undeclared names, and applies focused Redocly/cookie-binding checks to list/create/export/temperature. Existing lead, inquiry/import and CSV tests cover defaults, contract rejection and filter parity.

Assert 401 for disabled/banned/revoked-session writes (including invalidation after middleware validation), 404 for another Agent's lead and existing role-based 403 behavior on a restricted lead operation. Test list/export HTTP requests with repeated temperature parameters returning 400 independently of frontend validation. Frontend browser tests cover route-level rejection and bidirectional assignment/temperature coordination, including an already-open assignment dialog, failed reconciliation and draft-preserving recovery.

Backend `bun run check` passed lint, formatting, typecheck, 285 tests in 61 files and production build; the resumed disposable `bun run db:check` passed. The initial OpenAPI repair reproduced four unknown `StaffCookie` references; the broader semantic test then reproduced 14 `staffSession` references before both aliases were added. Backend `bun run check` passed again with 285/61 plus build (`.delivery-work/lead-temperature/openapi-auth-backend-final.log`); the earlier post-repair frontend check remains passing at 416/61 plus 20 static outputs. The repair is schema/dev-test-only, so the prior browser matrix remains the applicable UI evidence and is not claimed as rerun. No normal database was migrated.

## Risks and rollout

Manual tags can become stale and are not a promise of conversion. Migration must preserve existing receipts and timestamps. Backend migration/API ships before the UI; new fields and route are additive, while the staff activity event union requires coordinated client support. Deploy together or gate temperature writes until consumers understand the new event. Rollback should remove the UI/write path first and retain additive columns/history; do not drop user assessments or restore a pre-release database over newer unrelated writes.

Implementation, generated frontend declarations and contract snapshots are verified. No deployment or normal-database migration is claimed.
