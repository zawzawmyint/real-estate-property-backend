# 🧭 Record Activity Log Implementation Plan

> **Goal:** Deliver P3-04 as a dependable agency-wide investigation log available only to Admins and Managers.

---

## 🎯 Objective

**Status: Locally verified — 2026-11-26.** Managers can investigate business changes, including Admin actions. Existing lead activity remains separate and lacks complete historical field/role evidence. The delivered feature is defined by the repository-local [feature specification](../../../specs/record-audit-log/spec.md); the backend owns `specs/record-audit-log/contract.md` in its independent repository.

Implementation was authorized after correcting coverage rollback, observed-access-loss recovery and context-only lead changes. The completed evidence is summarized below; deployment, normal-data migration, push and production retention/backup decisions remain separate actions.

---

## 📦 Scope

**In scope**

- Successful property, lead, viewing and task operations; committed import summary/per-record events; explicit sensitive-field redaction; preserved event-time actor identity and target labels.
- Additive SQLite persistence, atomic transaction-local producers, two protected read endpoints, historical actor choices and `/crm/activity-log` with role-aware navigation.

**Out of scope**

- Staff administration, login monitoring, failed/read/export requests, historical backfill, real-time streaming, audit export, private documents and new business lifecycle operations.
- Dependency installation, normal-database migration, push and deployment.

---

## ⚙️ Assumptions & Constraints

**Technical**

- Separate frontend/backend repositories; Express owns permissions/persistence/contracts. Use installed Node 24/Bun 1.3.14, TypeScript, Prisma/SQLite and existing UI tooling; no new packages or environment variables.
- Keep business routes -> controller -> service -> repository; append through the caller's transaction, without generic audit middleware or an asynchronous queue. Preserve existing notification/email transaction coordination.
- Property service mutations now accept an Actor instead of a role, providing reliable identity and transaction-scoped current-session revalidation. Existing HTTP mutation contracts remain compatible.
- Existing tasks have no independent assignee/reopen/delete; viewings have no reopen/delete/feedback-edit operation. Capture only supported operations.

**Product / Business**

- Approved: manager investigation; Admin/Manager only; both see all agency actions including Admin actions. Agent lead timelines remain unchanged.
- Implemented defaults: metadata-only sensitive changes, no historical backfill, 7-date Dubai UI default, maximum 93-day API interval, 20-row default pages and no application purge in v1.
- P3-04 is locally verified; earlier-phase release gates remain in force, and local verification is not deployment.

**Dependencies**

- Backend migration/producers/API precede frontend integration and runtime verification. Synchronize backend-owned narrative/OpenAPI snapshots before generating frontend types.
- Before implementing framework-specific details, read installed Next.js documentation and obtain current Context7 guidance where applicable; no framework API changes are decided by this plan.

---

## 🧩 Proposed Approach

**Chosen recommendation:** a dedicated append-only RecordAuditEvent store populated explicitly inside existing feature transactions. This supports consistent filtering and immutable event-time context. A union of existing lead/notification records cannot reconstruct missing before/after values or role snapshots; HTTP request middleware lacks committed outcomes and cannot preserve transaction atomicity.

Backend flow: authorized business operation -> current actor/resource checks -> persisted change plus explicitly mapped audit row in the same transaction -> existing response. Read flow: current Admin/Manager checks -> bounded audit query and count -> safe DTO -> server-rendered CRM results. Existing LeadActivity continues to serve lead timelines/reporting.

**Backend ownership:** `prisma/schema.prisma` plus its additive migration; `src/modules/audit-log/audit-log.{routes,controller,service,repository,schema,events,changes,dto}.ts`; existing property/controller, lead/viewing/task and import services; `src/app.ts`; `docs/api/record-audit-log.openapi.yaml` and the aggregate OpenAPI. The controller passes deferred query readers to the service, which revalidates current access before parsing inside its transaction; repositories own reads and `audit-log.dto.ts` contains the explicit public response mapping. The backend-owned `specs/record-audit-log/contract.md` defines both GET endpoints and DTOs.

**Frontend ownership:** thin `src/app/(staff)/crm/activity-log/page.tsx`; `src/features/activity-log/{filters,input,response,server}.ts` and `{access,actor-picker,log-page,log-controls,log-results,change-details}.tsx`; the narrow `src/app/api/v1/staff/audit-log/actors/route.ts`; and existing `src/components/layout/workspace-{navigation,sidebar,menu,shell}.tsx` and `src/app/(staff)/crm/layout.tsx`. The controls use React Hook Form with the canonical audit-filter schema, labelled shared fields/errors and the shared submit button; access loss and provider errors use the shared alert/button patterns. Contract snapshots, API generation and parity checks follow existing conventions.

The delivered paths above are repository-relative within their named owner; no cross-repository source import is used. Existing implementation references remain the property/lead/viewing/task feature modules and agent-performance report.

**Local implementation references:** [Prisma schema](../../../prisma/schema.prisma), [property mutations](../../../src/modules/properties/properties.service.ts), [current staff validation](../../../src/modules/auth/staff-actor.ts) and [aggregate API contract](../../../docs/api/openapi.yaml).

**Delivered interfaces:** `appendAuditEvent(tx, input: RecordChange | Summary)` validates explicit per-action payloads and stores them. `createAuditLogService(database)` exposes `list(queryReader, identity)` and `actors(queryReader, identity)`; the controller supplies deferred query readers so current access is revalidated before parsing. Repositories return persistence/read shapes; the controller applies the separate public DTO mapper before responding.

---

## 🚀 Execution Plan

**Delivery evidence:** The completed implementation uses `RecordAuditEvent`/`RecordAuditCoverage`, transaction-local producers, two protected reads and `/crm/activity-log`. Actual focused backend files are `record-audit-log.test.ts`, `record-audit-log-read.test.ts`, `record-audit-log-contract.test.ts`, `record-audit-log-migration.test.ts`, `property-audit-log.test.ts`, `property-audit-identity.test.ts`, `lead-audit-log.test.ts`, `viewing-task-audit-log.test.ts` and `import-audit-log.test.ts`; the inventory is [coverage.md](../../../specs/record-audit-log/coverage.md). Frontend evidence is `tests/unit/activity-log.test.ts`, `tests/unit/navigation.test.ts` and `tests/e2e/activity-log.spec.ts`. Backend `bun run check` passed 89 files/390 tests; frontend `bun run check` passed API parity, lint, format, typecheck, build and 63 files/457 tests. Dedicated browser verification recorded 9 passes and one intentional duplicate-mobile native-zoom skip. No normal database migration or deployment occurred.

**Maintenance evidence (2026-11-26):** The skill-conformance corrections kept the HTTP contract, permissions, schema and producer inventory unchanged. Backend `bun run check` then passed with 89 files/391 tests. Frontend `bun run check` then passed API parity, lint, format, Next type generation/TypeScript and production build with 65 files/473 tests. The clean dedicated browser matrix registered 14 cases: 13 passed and one intentional duplicate native-zoom mobile case skipped, including validation/error-focus, independently streamed results and provider-503 conceal/retry recovery. A held authenticated `/crm/activity-log` page on the canonical port-3100 checkout reported no configuration or session errors during active Next runtime inspection. No normal database migration or deployment occurred.

1. **Lock the producer inventory and contract** — _(role: fullstack)_ — output: reviewed operation matrix and machine-readable additive read contract.

   - [x] Read both feature specs and backend contract; inventory all mutation routes/callers in properties, leads, public enquiry/chatbot handoffs, viewings, tasks and both imports. Save `backend/specs/record-audit-log/coverage.md` with action, entry point, service/transaction, redacted fields and proving test for every operation.
   - [x] Add failing `backend/tests/record-audit-log-contract.test.ts` cases for exact query/DTO unions, unknown/duplicate keys, 93-day boundary, invalid actor/entity combinations and unsafe pagination offsets. Keep this step at schema/OpenAPI level; HTTP authorization is proved in Step 5.
   - [x] Define schemas/event allowlists and both proposed read endpoints in domain/aggregate OpenAPI. Run `bun run test -- tests/audit-log-contract.test.ts` in backend; require schema/parity assertions to pass without mounting product routes. Carry the precise interface names above into later tasks.

2. **Add transactional persistence and safe event mapping** — _(role: backend)_ — output: additive migration, coverage metadata and append function.

   - [x] Write `backend/tests/record-audit-log.test.ts` for null/false/zero, money strings, redacted fields without hidden content, photo IDs without storage keys, sensitive-label exclusion and event survival after target/actor deletion. Run it to establish failures against missing functionality.
   - [x] Implement RecordAuditEvent/coverage persistence, required indexes and per-action validation/mapping. Keep actor/entity IDs non-cascading; require transaction-scoped calls. Run the focused tests until passing.
   - [x] Apply migrations to fresh and populated disposable databases; assert business/auth data unchanged and no historical events fabricated. Exercise insertion failure/rollback in a real transaction, and run `bun run db:check` only with the disposable database selected.

3. **Instrument properties and media safely** — _(role: backend)_ — output: all supported property writes produce attributable events.

   - [x] Add `backend/tests/property-audit-log.test.ts` covering create/patch/publish/archive/restore/delete, photo add/remove/reorder, no-op changes and rejected lifecycle rules. Include price/availability before/after, Manager denial of permanent delete and transaction-time actor demotion. Establish failing assertions first.
   - [x] Update property controller/service mutation signatures and every internal caller/test to pass Actor; revalidate inside the transaction, retaining resource checks before upload consumption. Append exactly one event for each committed meaningful operation and preserve HTTP response shapes.
   - [x] Force audit append failure during upload/deletion and test existing cleanup/unknown-outcome behavior. Run the focused test plus impacted existing property/media suites; all assertions must pass before moving on.

4. **Instrument leads, appointments, tasks and imports** — _(role: backend)_ — output: complete declared producer coverage with existing workflows preserved.

   - [x] Add `backend/tests/lead-audit-log.test.ts`, `viewing-task-audit-log.test.ts` and `import-audit-log.test.ts`; fail first on missing audit events. Cover every action in coverage.md, website/chatbot attribution, stage/temperature/assignment, redacted notes/feedback, due-date values and clearing retained lead property/assignee snapshots while their IDs remain null (metadata-only field markers, no null-to-null ID diff).
   - [x] Append inside existing transactions after successful version/state checks; retain LeadActivity and reporting behavior. Preserve notification recipients and email ledger writes. Do not audit derivative internal cleanup as another user action.
   - [x] For N committed import records, assert N creation events plus one summary with shared importId. Test maximum allowed batch size, invalid row, audit failure partway through, known receipt replay and changed-payload conflict; rollback/replay must not add partial/duplicate events.
   - [x] Test stale versions, unauthorized actors, no-op patches and rolled-back writes; run focused suites plus impacted lead/viewing/task/import/notification/email/report tests. Every operation in the inventory must have passing evidence.

5. **Expose manager investigation reads** — _(role: backend)_ — output: protected list and historical actor APIs.

   - [x] Write `backend/tests/record-audit-log-read.test.ts` for Admin/Manager parity including Admin-origin events; Agent/public/revoked/disabled/banned access and authorization before malformed-query validation; same-timestamp order, all filters, pre-coverage ranges, above-last pages and renamed/deleted actors. Filtering a deleted entity must return its retained events with available=false. Establish failing tests first.
   - [x] Implement routes/controller/service/repository, current-role revalidation before query parsing/reads, no-store and explicit DTO projection. Resolve target existence in bounded per-type queries; historical actor choices come from audit rows, not live staff membership.
   - [x] Verify field privacy against stored rows and HTTP DTOs. Run read/contract suites; inspect indexed queries with representative event volume and complete backend `bun run check` plus disposable database validation.

6. **Build the authorized investigation screen** — _(role: frontend)_ — output: usable `/crm/activity-log`, navigation and protected actor picker.

   - [x] Copy finalized backend narrative/OpenAPI into local `docs/contracts/`, register API generation and extend parity checks. Generate types via existing `bun run api:generate`; then `bun run api:check` must pass.
   - [x] Add failing `frontend/tests/unit/activity-log.test.ts` and extend `navigation.test.ts`: Dubai boundary conversion, invalid/dependent filters, literal identifiers, money/redaction/escaping, unavailable/import links and role visibility.
   - [x] Implement server-only reads and query-keyed results using shared CRM primitives; thread role/capability through desktop/mobile navigation callers. Add a narrowly scoped same-origin authenticated actor-search GET handler if the picker needs browser reads. Match backend query and recovery behavior without exposing origin/cookies.
   - [x] Verify observed session-provider loss/role change and protected 401/403 clear old events/options; revalidate on focus without claiming instant idle-page detection, before/after details retain historical values and coverage explanation always renders. Run unit checks and `bun run check`; require all gates to pass.

7. **Prove cross-repository behavior and accessibility** — _(role: fullstack)_ — output: recorded end-to-end acceptance evidence.

   - [x] Add `frontend/tests/e2e/activity-log.spec.ts` against an isolated disposable Express/SQLite fixture on 4311. Cover all roles, an Admin action visible to Manager, live revocation/demotion, actual producer writes, import correlation/replay, redaction, deletion, filters/pagination and unchanged Agent lead timelines.
   - [x] Run targeted `bun run test:e2e -- tests/e2e/activity-log.spec.ts` with existing API/unit regressions covered by both full quality gates; the full browser matrix was not rerun. Review 320/390/768/1440px, native 200% zoom, keyboard details/filter/pagination focus, loading/outage/empty and invalid URL states.
   - [x] Verify normal port-3100 project identity before active-page Next DevTools/browser inspection. Inspect errors/page metadata while exercising authorized reads. Do not claim a clean runtime from an absent session; state test-matrix/browser limitations.

8. **Reconcile documentation and release gates** — _(role: fullstack)_ — output: accurate completion status and migration/rollback instructions.

   - [x] Reconcile coverage.md, both feature specs, contract/OpenAPI, project indexes and shared roadmap against final evidence. Use the spec-updater subagent for final documentation reconciliation with exclusive documentation ownership, review its diff/gaps, and retain unchecked criteria where evidence is missing.
   - [x] Run backend/frontend `bun run check`, disposable migrations/database checks and necessary integration regressions after final code changes. Check P3-04 only when the complete declared scope passes; local verification is not deployment.
   - [x] Document coordinated maintenance-window migration/producer activation, backups, pending production retention decision and rollback preserving producers/events; verify writes stay stopped until producers are restored if rolled back. Do not apply migration to normal/production data or deploy under this plan-authoring request.

---

## ✅ Acceptance Criteria

**Functional**

- [x] Backend A01–A08 and frontend F01–F07 pass with evidence linked from their specs.
- [x] Full declared producer inventory is covered; Admin and Manager see identical history, and Agents cannot read the new log/options/counts.
- [x] Imports, deletion snapshots, historical actors and filtered investigation work without changing existing business permissions or lead history.

**Non-functional** (performance, security, accessibility, reliability)

- [x] Atomic writes, safe DTO/field allowlists, current-session enforcement and stable bounded reads pass real database tests.
- [x] Existing UI primitives, responsive layouts, keyboard operation and native zoom pass review.
- [x] Fresh/populated migrations preserve data; indexed queries and maximum import batch are exercised; coverage and rollback limits are documented honestly.

---

## 🧪 Validation Plan

**Manual tests**

- Investigate a real fixture price/assignment/date change as Manager, expand details, follow valid records/import correlation and inspect deleted targets. Repeat as Admin; verify Agent denial and existing lead timeline behavior.
- Exercise session loss, empty ranges and service outage. Review responsive/zoom/keyboard states and explicit start-of-coverage messaging.

**Automated tests**

- Focused test files in Steps 1–7 prove each contract/producer/privacy/rollback path; the operation inventory prevents untested producers. Run repository quality gates, disposable migration/database checks, API parity and cross-repository browser tests.
- Review focus: demotion during mutation/read (Steps 3/5/7); unknown upload outcome (Step 3); partial/replayed import (Step 4); deleted/renamed actors/targets (Steps 2/5/7); timezone/money/redaction boundary rendering (Steps 2/6/7).

**Rollback / mitigation**

- Hide frontend and disable audit reads while retaining schema/producers/events. If reverting producers, stop business writes until all producers are restored; v1 cannot represent coverage gaps and must not resume unaudited writes. Preserve backups and do not drop audit history as routine rollback.

---

## ⚠️ Risks & Open Questions

**Risks**

- **Risk:** Broad producer coverage misses a path — _Mitigation:_ explicit coverage.md operation-to-test mapping, transaction failure tests and scoped review.
- **Risk:** Audit failure affects business availability — _Mitigation:_ local transactional writes, indexed/bounded reads and tested failure recovery; never silently skip evidence.
- **Risk:** Sensitive snapshots or misleading historical completeness — _Mitigation:_ explicit field allowlists, generic personal-record labels, no backfill and visible activation/exclusions.
- **Risk:** Earlier releases remain undeployed — _Mitigation:_ retain existing roadmap release gates and distinguish documentation/local verification from release.

**Open questions** _(blockers for implementation)_

- No local implementation blockers remain. The user authorized implementation after the three review corrections on 2026-11-26.
- Production retention/backup ownership must be decided before live activation; it does not block disposable local implementation under the proposed no-purge default.
