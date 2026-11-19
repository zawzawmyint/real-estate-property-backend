# 📊 P2-07 Agent Performance Reporting Plan

> **Goal:** Deliver a read-only, permission-scoped report of agent activity, first-Won outcomes and recorded follow-up, with honest historical attribution and coverage.

---

## 🎯 Objective

Help managers distribute leads and identify coaching needs; let agents understand their own recorded work. **Status: Verified — 2026-11-18.** Implementation and acceptance are complete locally; no commit, push, deployment or normal-database migration is claimed. P2-07 is checked.

Read the [repository-local specification](../../../specs/agent-performance-reporting/spec.md). The backend metric authority is `backend/specs/agent-performance-reporting/contract.md`; frontend's identical snapshot is `frontend/docs/contracts/agent-performance-reporting.md`. Companion paths below are relative to the named independent repository. This coordinated plan is stored identically in both repositories.

---

## 📦 Scope

**In scope**

- Dubai date range, historical attribution, leads handled, first-Won deals, completed/ongoing/ended follow-up cohorts and elapsed mean with sample counts.
- Admin/Manager agency/agent selection; Agent self-only historical aggregates; coverage warnings, identity availability, zero rows and pagination.
- Backend-owned API/OpenAPI, generated frontend types, `/crm/reports/agents`, workspace navigation and complete verification.

**Out of scope**

- Charts, leaderboards, revenue, commissions, conversion rates, exports, messaging, business-hours SLA, drill-down, scheduled delivery, migrations and historical backfill.
- New dependencies/configuration, deployment, changes to the existing dashboard and unrelated cleanup.

---

## ⚙️ Assumptions & Constraints

**Technical**

- Reuse independent Express/SQLite and frontend server-read architecture. Backend owns definitions, validation, authorization and calculations. No cross-repository imports.
- Existing history records assignment IDs, calls and stages but lacks durable ordering for equal timestamps. Exclude ambiguous attribution; never sort UUIDs into invented chronology.
- One live-authorized read snapshot, one generated clock instant, no shared response cache and no private lead/body materialization.
- Ranges are at most 366 inclusive Dubai dates; limits are 100,000 relevant activities and 2,000 identities. Explicit 422 overflow replaces partial results. Target under two seconds on the documented 10,000-lead/100,000-activity fixture.

**Product / Business**

- Qualifying follow-up is an assigned-agent call log or New → Contacted transition. It measures recorded action/attempt, not customer receipt. Generic notes do not qualify.
- Deals mean the first-ever Won transition per lead, credited to its owner then. Reopening/re-winning does not generate new credit. Handled leads can appear for more than one agent.
- Response cohort uses episodes assigned during the selected period. Show completed sample size, ongoing missing follow-up and ended-without-follow-up separately; incomplete episodes are disclosed and excluded.
- All choices are the recommended design requested by the user; product acceptance is still unverified.

**Dependencies**

- No external provider. Existing authentication, lead history, disposable fixtures, server API transport and CRM components suffice if the history feasibility/performance checks pass.
- Contract/OpenAPI delivery precedes generated frontend consumers. If history cannot support a useful report, revise the specification before introducing persistence.

---

## 🧩 Proposed Approach

- **Recommended:** reconstruct provable historical assignments from existing activities and calculate a bounded report. This preserves existing write workflows and avoids a migration, at the cost of visible omissions where history is uncertain.
- **Alternative considered:** store new reporting events/snapshots. This improves future ordering but adds writes/migration/reconciliation and still cannot prove missing historical facts. Defer unless the feasibility check shows the first approach is insufficient.
- Flow: URL filters → server-only frontend read → Express live authorization → validated scope/date window → historical reconstruction and aggregation in one snapshot → safe paginated DTO → table and coverage explanation.
- Proposed API: `GET /api/v1/staff/reports/agent-performance` with `from`, `to`, `agentId`, `page`, `pageSize`. Exact query defaults, calculations, identity universe, omissions, fields, bounds and errors are in the contract. Existing APIs and schemas remain compatible.

**Backend ownership — delivered implementation files**

- New feature files: `backend/src/modules/reports/agent-performance/agent-performance.routes.ts`, `.controller.ts`, `.service.ts`, `.repository.ts`, `.schema.ts`, `.dto.ts` and `.metrics.ts` (same basename; metrics owns the used pure reconstruction/calculation functions).
- Modify existing `backend/src/app.ts` for application composition. Do not introduce a root app/package.
- New tests: `backend/tests/agent-performance.test.ts`, `backend/tests/agent-performance-metrics.test.ts`, `backend/tests/agent-performance-contract.test.ts`.
- Future contract files: `backend/docs/api/agent-performance.openapi.yaml`, referenced from existing `backend/docs/api/openapi.yaml`. No OpenAPI operation is advertised as implemented in this documentation delivery.

**Frontend ownership — delivered implementation files**

- New thin route: `frontend/src/app/(staff)/crm/reports/agents/page.tsx`.
- New feature files under `frontend/src/features/reports/agent-performance/`: `types.ts`, `filters.ts`, `server.ts`, `report-filters.tsx`, `report-results.tsx`, `report-table.tsx`, `presentation.ts` and `report-loading.tsx`. Each must have real use; avoid barrels and unused scaffolding.
- Register the report-only Back/Forward guard through `frontend/src/instrumentation-client.ts` before router hydration. Keep the guard and route constant in feature-local `report-history.ts` and `report-path.ts`. Verify that direct Back/Forward after a role change conceals the report and performs one fresh authorized read at the preserved URL.
- Modify existing `frontend/src/components/layout/workspace-navigation.tsx` and `frontend/scripts/generate-api.mjs`; add Reports using an existing appropriate icon and add the `agent-performance` generation domain.
- Future `frontend/docs/contracts/agent-performance.openapi.yaml` and generated `frontend/src/lib/api/generated/agent-performance.d.ts`; use the server transport from existing `frontend/src/lib/api/server.ts`.
- New tests: `frontend/tests/unit/agent-performance.test.ts` and `frontend/tests/e2e/agent-performance.spec.ts`; extend existing `frontend/tests/fixtures/data-tools-staff.ts` and backend disposable `scripts/auth-e2e-server.ts` only if they are the appropriate fixture owners after inspection.
- Reuse existing PageHeader (`frontend/src/components/layout/page-header.tsx`), FilterPanel (`frontend/src/components/layout/filter-panel.tsx`), DataTable (`frontend/src/components/crm/data-table.tsx`) and CollectionPagination (`frontend/src/components/crm/collection-pagination.tsx`). Companion source paths are descriptive, not cross-repository imports.

---

## 🚀 Execution Plan

1. **Prove historical metrics** — _(role: backend)_ — implement the contract example as failing tests in `agent-performance-metrics.test.ts`. Pin assigned creation, pre-range history, reassignments, first-ever wins, missing actors and equal-timestamp ambiguity. Implement only the pure metrics/reconstruction needed to pass. Deliver an independently testable calculation model; stop and revise the spec if reliable scoping requires guessed history.
2. **Build authorized bounded reads** — _(role: backend)_ — add repository/service/schema tests before implementation. Service interface: `report(identity, validatedQuery)` returns the exact report DTO; repository receives an explicit transaction, scope and bounds. Read only needed attribution fields and retain pre-range context. Verify live staff, all/self scope, deleted/inactive staff, snapshot consistency, limits and SQL/query/memory behavior. Run and record the benchmark before building the UI.
3. **Expose the contract** — _(role: backend)_ — add route/controller/DTO and mount through `src/app.ts`; write HTTP tests for valid filters, strict repeated/unknown parameters, safe errors, forbidden selection and exact private-field exclusions. Add OpenAPI/main references, resolve all security names and synchronize frontend snapshots. Deliver a verified read-only endpoint without changing lead writes.
4. **Deliver typed server reads and filter state** — _(role: frontend)_ — extend generation, generate declarations, test real page-entry parsing for missing/paired/repeated dates and agent IDs. Add server transport and thin route with query-keyed result Suspense. Test URL Apply/reset/page behavior, no broadening of invalid queries and no cross-user/stale-filter results.
5. **Deliver usable reporting UI** — _(role: frontend)_ — assemble reused headers/filters/table/pagination, add Reports navigation, format averages including null/zero, explain attribution/sample sizes and show coverage/availability. Verify fixtures for all-agent/self, no data, former agents, failed reads, 422 narrowing guidance, session/role loss and rapid navigation. Review responsive/keyboard/native-zoom captures; add charts only in a separately agreed future slice.
6. **Verify complete integration** — _(role: fullstack)_ — run backend/frontend quality gates, disposable database compatibility, contract/security parity, focused report browser coverage and a clean serial run of each complete desktop/mobile project. Independent projects may run concurrently only with separate frontend, proxy, backend, database and fixture state. Both clean runs must account for the complete discovered matrix; never pool partial or failing runs into a passing claim. Check the actual port-3100 runtime with an affected page open. Capture commands/counts/skips, screenshots and benchmark evidence; fix regressions before acceptance.
7. **Reconcile documentation** — _(role: fullstack)_ — delegate final reconciliation to `spec-updater` after implementation/tests settle, with ownership of affected specs/indexes/contract notes/roadmap entries and no concurrent edits. Review its diff and gaps. Update project overview/development docs only for delivered behavior. Edit frontend roadmap first, reconcile backend; check P2-07 only after both specs' criteria pass. Commit/push/deployment remain separately controlled by user authorization.

For each implementation task: demonstrate the relevant test failure, make the smallest correct change, then record passing targeted checks before proceeding. Use existing project quality commands; do not install tooling just for this report.

---

## ✅ Acceptance Criteria

**Functional**

- [x] The contract example produces A: handled 1/closed 0/mean 600 seconds and B: handled 1/closed 1/mean 1,800 seconds; a later re-win creates no additional closure.
- [x] Date/assignment/event windows, repeated assignments, cohort partition, first-win historical attribution and sample counts match the backend authority.
- [x] Admin/Manager all/selected access and Agent self-only history hold through direct requests, role loss and reassignment without exposing lead records or agency coverage.
- [x] Date/agent/pagination state, identity availability, zero/null states, coverage, errors, refresh and recovery work in the browser.
- [x] Both feature specifications and all roadmap copies agree with actual verified delivery; P2-07 is checked.

**Non-functional** (performance, security, accessibility, reliability)

- [x] Reports use one no-store authorized snapshot, bounded queries and explicit limit errors; no raw customer data or note bodies escape.
- [x] The documented benchmark meets the under-two-second target without unbounded history reads or per-agent/per-lead query loops.
- [x] 320/390/768/1440px, keyboard, native 200% zoom and long-name review pass; table scrolling is contained and labelled.
- [x] Both repositories' required checks, contract parity, integration regression and active-page runtime inspection have passing evidence.

---

## 🧪 Validation Plan

**Manual tests**

- Compare exact fixture results against the contract; explain why current dashboard Won totals may differ. Review metric wording and incomplete-history warnings.
- Review Manager and Agent views, all filters/pagination/refresh/retry, zero work, inactive/former staff, role/session loss and report-too-large recovery.
- Visually inspect screenshots at the width matrix and native zoom; verify keyboard focus, date errors, table headers/scroll and loading announcements.

**Automated tests**

- Backend: exact example; leap/month/year/Dubai boundaries; assigned/manual versus unassigned public/import starts; pre-range first win; reopen/re-win; Manager-recorded win; reassignment; repeat episodes; zero/null; unknown/tied history; deleted actors; role change; privacy; snapshot consistency; limit boundaries and self-scope-before-limit.
- Frontend: URL validation at actual page entry, generated type parity, safe formatting/error mapping, out-of-order navigation and hydration; disposable report browser tests plus complete clean serial desktop and mobile regressions in independent environments.
- Validation commands: backend `bun run check`, disposable `bun run db:check`; frontend `bun run api:check`, `bun run lint`, `bun run format:check`, `bun run typecheck`, `bun run test`, `bun run build`, then `bun run test:e2e -- --workers=1` using the documented fixture setup. Respect separate exact-data dashboard fixtures. Inspect expected checkout through Next DevTools on port 3100 with the report open.
- Final evidence: backend quality gates passed with 310 tests in 65 files; frontend quality gates passed API parity, lint, format, typecheck, 440 tests in 62 files and build. Complete isolated serial projects accounted for all 508 discovered browser cases exactly once (desktop 240 passed/14 configured skips; mobile 192 passed/62 configured skips), with zero failures, flaky outcomes, retries, missing or unexpected cases. The separate exact-data dashboard run passed 16/16. The normal port-3100 report page was inspected read-only with demo Manager sign-in/sign-out and Back/Forward revalidation; no browser or Next DevTools errors were reported.

**Rollback / mitigation**

- Remove additive UI/navigation and reporting route if necessary; no database rollback or history rewrite is required. Deploy backend before frontend. Preserve existing dashboard and lead workflows.
- If reconstruction/performance fails, leave acceptance open and revise the specs; do not silently add persistence, approximate attribution or truncate results.

---

## ⚠️ Risks & Open Questions

**Risks**

- **Risk:** Missing/tied historical events reduce coverage — _Mitigation:_ explicit omission rules, scoped warnings, sample counts and no guessed backfill.
- **Risk:** Fast logged calls do not mean useful customer contact — _Mitigation:_ label recorded attempts, explain eligible events and avoid rankings/SLA claims.
- **Risk:** Changing ownership or reopened leads distorts credit — _Mitigation:_ historical assignment and first-ever Won rules, with boundary fixtures.
- **Risk:** Long histories exceed query budgets — _Mitigation:_ benchmark early, strict caps and clear narrow-range/agent recovery; revise before delivery if necessary.
- **Risk:** Historical Agent aggregates are mistaken for current record access — _Mitigation:_ explicit aggregate permission, no lead drill-down and independent current-lead authorization.

**Open questions** _(blockers for implementation)_

- No unresolved product choice blocks the delivered first version. Native Safari was not exercised; incomplete historical evidence remains intentionally disclosed rather than inferred.
