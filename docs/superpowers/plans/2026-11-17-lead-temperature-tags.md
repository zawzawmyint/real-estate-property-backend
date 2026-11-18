# 🌡️ Lead Temperature Tags Implementation Plan

> **Goal:** Deliver P2-06 manual Hot, Warm and Cold lead assessments with a Not assessed default, scoped filtering and an accountable activity history.

---

## 🎯 Objective

Let agents prioritize follow-up independently of pipeline stage. **Status: Verified — 2026-11-18.** The backend, frontend, contract snapshots and generated declarations are verified. This plan does not claim deployment or normal-database migration.

Read the [local specification](../../../specs/lead-temperature-tags/spec.md) and local contract before execution: frontend snapshot `docs/contracts/lead-temperature-tags.md`; backend authority `specs/lead-temperature-tags/contract.md`. Both repositories contain this coordinated plan; repository paths below are relative to the named repository.

---

## 📦 Scope

**In scope**

- Manual, single-value temperature; detail editing; list/detail/pipeline badges; list/pipeline filtering and filtered export; versioned updates and activity history.
- Additive database migration, backend-owned contract, generated frontend types, permissions and recovery verification.

**Out of scope**

- Automatic scoring/aging, custom tags, bulk actions, create/contact-edit temperature controls, messaging, dashboard metrics and CSV format changes.
- Deployment, normal-database migration, dependency adoption and unrelated cleanup.

---

## ⚙️ Assumptions & Constraints

**Technical**

- Independent repositories; Express owns authorization/persistence and Next.js consumes its API. No sibling-source imports.
- Reuse installed Node 24/Bun 1.3.14, SQLite/Prisma, strict TypeScript, Zod, existing session/Origin boundaries, semantic UI primitives and Webpack. No new runtime dependencies/configuration; the pre-commit contract regression uses the dev-only validator documented below.
- Domain is exactly `hot | warm | cold | unassessed`; display unassessed as Not assessed. Historical and every new lead default to unassessed.
- Preserve serialized transactions, current staff/resource checks, expectedVersion, receipt replay, duplicate guards and dirty-form protection.

**Product / Business**

- Manual assessment describes readiness/interest; it is independent of stage and stays editable for Won/Lost leads. Reassignment preserves it.
- Admin/Manager edit all agency leads; Agents edit only current assignments. Temperature is staff-only.
- Preserve auth distinctions: disabled/banned/invalidated sessions return 401 and use sign-in recovery; authenticated role restrictions return 403; inaccessible/nonexistent leads return 404. Do not change authentication behavior for this feature.
- Product defaults are implemented and verified in the feature specs.

**Dependencies**

- Backend migration/read contract precedes frontend integration; API snapshots/types must agree. No external provider is required.
- During execution follow applicable implementation skills; perform each task's failing-test -> minimal implementation -> passing-test cycle. Use native execution unless the user selects another method.

---

## 🧩 Proposed Approach

**Approaches considered:** Manual classification is selected from the preceding discussion because agents can record intent learned in conversations. Automatic rules would infer readiness from incomplete signals; hybrid suggestions add override/explanation behavior without a present data need. Neither is included.

**Implemented data flow:** Detail selector -> feature-owned Server Action -> Express temperature controller/service -> serialized authorized update plus activity -> refreshed detail/history. List/pipeline/export share backend filtering.

**Backend files**

- `prisma/schema.prisma` (backend only): add `Lead.temperature` defaulting to unassessed, `(temperature, createdAt, id)` index, and nullable previous/next temperature activity columns. Create one new `prisma/migrations/<generated-timestamp>_lead_temperature/migration.sql`; do not edit historical migrations.
- Backend `src/modules/leads/leads.schema.ts`, `leads.routes.ts`, `leads.controller.ts`, `leads.service.ts`, `leads.repository.ts`, `leads.dto.ts`: strict input/filter, dedicated mutation, atomic event, projections and shared SQL predicate.
- Backend `docs/api/leads.openapi.yaml` and applicable API entry-point references own the executable contract.

**Frontend files**

- `src/features/leads/crm/lead-detail.tsx`, `src/features/leads/crm/lead-presentation.tsx`, `src/features/leads/crm/lead-list.tsx`, `src/features/leads/crm/lead-filters.tsx` and `src/features/leads/crm/pipeline/pipeline-lead-card.tsx`: saved badges, detail control, timeline and filter presentation. These are frontend-only paths.
- Frontend `src/features/leads/crm/assignment-dialog.tsx`: integrate detail-hosted assignment trigger/submission with parent-owned synchronous acquisition/release and pending/recovery state, including already-open dialogs. Keep standalone list assignment behavior compatible.
- Frontend `src/app/(staff)/crm/leads/pipeline/page.tsx`: preserve array-valued query parameters through validation, matching the list page's append-based handling; do not silently drop repeated temperature values.
- Frontend `src/features/leads/data/{actions,input,types,filters,pipeline}.ts`: mutation validation/types, query serialization and pipeline propagation; reuse existing transport.
- Frontend `docs/contracts/leads.openapi.yaml`, generated `src/lib/api/generated/leads.d.ts` and the backend-owned contract snapshot follow backend ownership. Regenerate declarations; do not hand-edit them.

**Contract changes**

- Implemented `PATCH /api/v1/staff/leads/{id}/temperature`, operation `changeLeadTemperature`; body `{ expectedVersion: positive integer, temperature: LeadTemperature }`; existing LeadDetail response envelope.
- Add staff DTO temperature and nullable activity `temperatureChange: { from, to } | null`, with `temperature_changed` event type. Extend list/export with optional temperature query.
- Keep CSV columns, public inputs/responses and lead import versions unchanged. The new activity union requires coordinated client rollout.

---

## 🚀 Execution Record

Implementation completed the persistence/API, typed-client/filter and CRM/recovery work described below. Backend final `bun run check` passed lint, formatting, typecheck, 285 tests in 61 files and production build; the resumed disposable `bun run db:check` passed. Frontend final `bun run check` passed API drift, lint, formatting, typecheck, 416 tests in 61 files and production build with 20 static outputs. Focused Edge desktop/mobile coverage passed 14/14; responsive review passed at 320/390/768/1440px, native 200% zoom passed at 1280 physical/640 CSS pixels, keyboard review passed, and the November 18 active-page runtime inspection was clean. The main OpenAPI reference regression independently resolved with openapi-typescript after a red-to-green fix; frontend declarations are generated from the frontend-local OpenAPI snapshot. Browser coverage is split: a November 17 environment refresh interrupted a run after 207 completed cases, then a November 18 fresh fixture completed the exact 279 remaining selection with 222 passed and 57 expected skips. The matrix verifier accounts for all 486 current cases exactly once (419 passed, 67 expected skips, zero failed/missing/unexpected/duplicated); this is not claimed as one uninterrupted clean run.

**Pre-commit OpenAPI authentication repair:** the main document now aliases `StaffCookie` and `staffSession` to its existing `staffCookie`/`agency.session` cookie scheme. RED first exposed four unknown `StaffCookie` references, then the broader semantic regression exposed 14 `staffSession` references across notifications, dashboard, tasks and viewings. GREEN `@redocly/openapi-core` coverage resolves all three definitions, walks every main-document operation's declared/inherited security requirements to reject undeclared names, and retains focused Redocly/cookie-binding validation for lead list/create/export and temperature. The direct backend dependency is dev-only at 1.34.21; no runtime, database or browser behavior changed, so browser evidence was not rerun. Backend final `bun run check` passed again (285 tests/61 files plus build); the earlier post-repair frontend check remains passing (416 tests/61 files plus 20-static-output build).

1. **Persist defaults and history fields** — _(role: backend)_ — additive migration with historical-data preservation.
   - [x] Create `tests/lead-temperature-migration.test.ts`: fresh/populated/repeated migration checks; assert unassessed defaults, old activities' null transition fields and unchanged IDs, stage, assignment, version, updatedAt and receipts.
   - [x] Run `bun run test -- tests/lead-temperature-migration.test.ts`; confirm failure against the current schema.
   - [x] Add the schema/default/index/activity fields and generated migration; include new columns in existing database checks where needed (`scripts/check-database.ts`). Update migration expectations that enumerate tables/columns.
   - [x] Rerun the focused test; verify migration and `bun run db:check` on an explicitly configured disposable database. No normal database writes.

2. **Deliver the authorized API and projections** — _(role: backend)_ — proposed route, event and filtering contract implemented and tested.
   - [x] Create `tests/lead-temperature.test.ts` with named cases `changesTemperatureAtomically`, `sameValueDoesNotWrite`, `staleSameValueConflicts`, `reassignmentRemovesAgentAccess`, `disabledActorCannotWrite`, `concurrentUpdatesDoNotOverwrite` and `eventFailureRollsBackLead`. Assert exact values, one version increment/event per real transition, no partial state, role-specific safe failures and no hidden record data.
   - [x] Add cases for four valid values/reset/Won-Lost, null/case/unknown-field/invalid-version rejection, trusted Origin, session loss, every creation-path default and strict unchanged create/patch/import inputs. Assert 401 for disabled/banned/revoked sessions, including invalidation between middleware and transactional validation; 404 for another Agent's lead; and existing 403 on a role-restricted lead operation. Preserve requireCurrentStaff semantics. Extend `tests/csv-export.test.ts` and relevant lead/inquiry/import tests: combined filters before pagination/count/limit, Agent scoping, repeated temperature HTTP query parameters returning 400 on list/export, stable columns and receipt replay.
   - [x] Run focused backend tests and confirm failures before implementation.
   - [x] Add exported `temperatureSchema` and inferred `TemperatureInput` in leads.schema.ts; wire controller `temperature` and service `temperature(id: string, input: TemperatureInput, identity: Actor)` using the existing stage mutation as the transactional pattern. Recheck version before no-op, explicitly map temperature and event fields, and extend DTO projection/shared SQL predicate.
   - [x] Update backend OpenAPI for the exact contract, including all existing response paths using LeadSummary/LeadDetail/activity. Rerun focused tests and `bun run check`; inspect indexed query plans on representative disposable data.

3. **Connect typed reads, actions and filters** — _(role: frontend)_ — contract-backed action and URL behavior with matching API types.
   - [x] Copy backend OpenAPI and contract into frontend snapshots, then run `bun run api:generate`. No runtime sibling imports.
   - [x] Create `tests/unit/lead-temperature.test.ts` covering exact labels/domain, malformed action input rejected before transport, temperature filter round-trips, invalid/repeated values, page reset, safe return URLs and preservation of other filters. Extend `tests/unit/pipeline.test.ts` and existing CSV filter tests for per-stage/export propagation.
   - [x] Run focused unit tests; confirm new behavior fails, then implement `TemperatureInput` from generated schemas, `changeTemperature(id: string, input: TemperatureInput)` through runLeadMutation, input validation, filter parse/serialization and shared pipeline forwarding.
   - [x] Add route-level browser cases to `tests/e2e/lead-temperature.spec.ts`: directly open `/crm/leads?temperature=hot&temperature=cold` and `/crm/leads/pipeline?temperature=hot&temperature=cold`, assert the existing invalid-filter UI and no lead-result API request. Confirm the pipeline case fails before changing its page entry. Preserve repeated values by appending array items before parsing, as the list page does; verify a valid single temperature still reaches each pipeline stage request.
   - [x] Rerun focused tests and `bun run api:check`. Avoid an unrelated transport/filter refactor.

4. **Deliver the CRM experience and recovery** — _(role: frontend)_ — accessible detail editing, badges, filter and history.
   - [x] Extend `tests/e2e/lead-temperature.spec.ts` from task 3 using isolated role identities and existing duplicate-aware lead creation helpers. Cover manager and assigned-Agent updates/reset, denied other Agent, list/pipeline badges, combined filters/export membership and timeline actor/from/to.
   - [x] Add browser cases for stale versions, response loss after commit (one event), response loss before commit, reconciliation failure blocking writes, concurrent reassignment/access loss, same-tick double save and preservation of an unsaved note. Assert 401 triggers sign-in recovery, while role-based 403 and inaccessible-lead 404 show their existing safe denial behavior. Include stage/task/viewing preservation and pipeline drag/keyboard regression coverage.
   - [x] Hold a temperature save pending and assert assignment cannot open/submit; repeat with the assignment dialog already open. Fail the reconciliation reads and assert both assignment and temperature remain blocked with no competing mutation requests. Then allow successful reads and require an explicit save with refreshed version, preserving temperature/assignment/note drafts. Test the reverse direction by holding assignment pending and attempting temperature submission, including same-tick attempts. Retain existing standalone list-assignment coverage.
   - [x] Confirm focused browser failures against the pre-UI state. Implement TemperatureBadge in lead-presentation.tsx; integrate list/detail/pipeline, labelled detail selector with explicit Save temperature, history rendering and the existing shared filter controls.
   - [x] Extend the detail guard/pending/review coordination to temperature, stage, notes/calls and assignment. Pass parent-owned synchronous acquisition/release and shared pending/recovery state to detail-hosted AssignmentDialog; gate both its trigger and submit path, including an already-open dialog. Assignment must report its pending/uncertain-recovery lifecycle to the parent so coordination works in both directions and releases only after required authorized reads succeed. Preserve standalone list assignment behavior and backend version guards. Keep saved/draft values separate, honor dirty navigation, preserve selections on conflicts, reconcile uncertain saves by reads only, and handle revoked sessions/access safely.
   - [x] Run the focused browser suite; review keyboard, announcements, 320/390/768/1440px and actual native 200% zoom screenshots. Verify no added page overflow and no pipeline control interference.

5. **Verify and reconcile delivery** — _(role: fullstack)_ — evidence-backed status and coordinated rollout instructions.
   - [x] Run backend `bun run check`, disposable migration verification and `bun run db:check`; frontend `bun run check` and `bun run test:e2e` with disposable backend 4311. Stop only owned dev servers before production builds.
   - [x] Identify the correct 3100 checkout with Next DevTools; open affected lead/list/pipeline pages and inspect get_errors/get_page_metadata. Record runtime and visual evidence plus material limitations.
   - [x] After code/tests settle, delegate final documentation reconciliation to the global spec-updater with ownership of feature specs, contracts, relevant operational docs and synchronized ROADMAP copies; review its diff/gaps. If unavailable, reconcile directly.
   - [x] Update executable contract snapshots and root/index documentation as necessary. Check P2-06 only after full acceptance is verified; record partial evidence without completion otherwise. Review diffs and commit coherent verified slices if authorized; do not push or deploy without authorization.

---

## ✅ Acceptance Criteria

**Functional**

- [x] Four values/default/reset, manual detail updates and persistent list/detail/pipeline display match both feature specs.
- [x] Correct live permissions, atomic history/version semantics and combined list/pipeline/export filters pass verified acceptance.
- [x] Actual list/pipeline routes reject repeated temperature parameters without fetching broadened results; 401/403/404 recovery follows existing auth/resource semantics.
- [x] Assignment and temperature cannot race in either direction, including already-open dialogs and failed reconciliation; successful read recovery preserves drafts before explicit resubmission.
- [x] No automatic classification, altered stage/assignment, changed CSV schema or public exposure is introduced.

**Non-functional** (performance, security, accessibility, reliability)

- [x] Scoped database filtering occurs before pagination/count/export limits; no unbounded application filtering or hidden-record leakage.
- [x] Concurrent/uncertain writes preserve data and drafts; migration preserves prior data and receipts.
- [x] Keyboard, responsive, native-zoom, contract parity, full quality gates and runtime checks have evidence.

---

## 🧪 Validation Plan

**Manual tests**

- Use all three roles to assess/reset leads, combine list/pipeline filters, inspect history/export and verify reassignment/access loss. Review badge contrast, keyboard, screen-reader announcements and native zoom with real pages open.

**Automated tests**

- Tasks 1–4 specify failing regression tests; task 5 executes full gates and cross-repository smoke/regression. Use disposable databases/identities, retaining production auth limits and duplicate guards.
- Regression coverage includes actual page entries for repeated temperature queries (task 3), 401 disabled/invalidated-session versus 403 role restrictions and 404 resources (tasks 2/4), and assignment trigger/submission during pending saves/failed reconciliation plus the reverse pending-assignment case (task 4).
- Review focus: stale same-value requests (task 2), revoke/reassign during writes (tasks 2/4), committed-response loss (task 4), filters across page/role/export boundaries (tasks 2/3/4), and default/history/receipt preservation during migration (tasks 1/2).

**Rollback / mitigation**

- Back up before operational migration. Roll out migration/API before UI and enable new activity production only when consumers support it. Revert UI/write path first, retaining additive columns and recorded history. Never overwrite newer unrelated writes by restoring an old database casually.

---

## ⚠️ Risks & Open Questions

**Risks**

- **Risk:** Manual temperatures become stale or inconsistent. — _Mitigation:_ shared guidance and visible change history; no unapproved automatic aging.
- **Risk:** Temperature saves conflict with existing edits. — _Mitigation:_ current versions, shared local mutation coordination and read reconciliation without automatic retries.
- **Risk:** Older activity consumers do not recognize the new event. — _Mitigation:_ coordinated rollout; deploy support before enabling temperature writes.

**Open questions** _(blockers for implementation)_

- No open implementation blocker. Deployment and normal-database migration remain separate operational work.
