# 🧭 Follow-up Tasks Implementation Plan

> **Goal:** Deliver P1-26 and P1-27 with lead-linked dated tasks, current-assignment access and visible overdue follow-ups.

---

## 🎯 Objective

Give agents a reliable next action after lead conversations and viewings. **Status: verified on 2026-10-29.** Read the [local feature specification](../../../specs/follow-up-tasks/spec.md) alongside this delivery record. The backend's `specs/follow-up-tasks/contract.md` owns the implemented API; both repositories have corresponding specs and this plan.

---

## 📦 Scope

**In scope**

- Lead-linked create/read/edit/complete/cancel, a global Tasks list and lead-detail Tasks section.
- Due dates in Dubai time, overdue highlighting/filtering, authorization, pagination, creation receipts and versioned writes.
- Additive persistence/API, frontend integration, focused regressions and final documentation reconciliation.

**Out of scope**

- Standalone personal tasks, separate task assignees, reminders, scheduled workers, recurring tasks, priorities, calendars and dashboards.
- Automatic pipeline/viewing/activity changes, new dependencies and release deployment.

---

## ⚙️ Assumptions & Constraints

**Technical**

- Both independent repositories use **feat/follow-up-tasks**. Express owns authorization/persistence; Next.js consumes backend contracts through server reads and validated Server Actions. No cross-repository imports.
- Keep existing business layering, serialized transaction/session checks, selected writes, native authentication and reusable CRM components.
- No new package/configuration was introduced. The source, test and OpenAPI paths below are implemented; no commit, push or deployment is claimed.

**Product / Business**

- **Approved defaults:** every task belongs to a lead; responsibility follows current lead assignment; open -> completed/cancelled, with no reopen/delete. Admin/Manager see all, Agents only currently assigned leads.
- Creation/edit needs a nonterminal lead with an active assigned Agent; authorized completion/cancellation remains available after eligibility changes.
- Title 1–160 trimmed characters; nullable notes <= 2000; explicit **Asia/Dubai** input/display and UTC persistence. New/changed due time must be future; unchanged overdue dueAt may survive text edits exactly.
- Overdue means **open and dueAt < server asOf**. Today uses Dubai midnight boundaries. Result/detail refresh cadence is 60 seconds while visible plus focus/manual refresh, preserving dirty forms.

**Dependencies**

- Verified leads, viewing patterns, staff roles, shared CRM components and existing SQLite migration/browser-fixture infrastructure.
- Backend machine-readable contract precedes generated frontend types. No feature requires notification infrastructure.

---

## 🧩 Proposed Approach

- **Backend:** `src/modules/tasks/tasks.{routes,controller,service,repository,schema,dto}.ts` is mounted in `src/app.ts`, with `prisma/schema.prisma` and an additive migration. Receipt/lifecycle logic remains feature-local.
- **Contract:** backend `specs/follow-up-tasks/contract.md` is implemented as `docs/api/tasks.openapi.yaml` with aggregate registration. Frontend has `docs/contracts/tasks.openapi.yaml`, `docs/contracts/tasks.md` and generated `src/lib/api/generated/tasks.d.ts`; `scripts/generate-api.mjs` registers tasks.
- **API:** GET/POST `/api/v1/staff/tasks`; GET/PATCH `/api/v1/staff/tasks/:id`; PATCH `/api/v1/staff/tasks/:id/status`. One-record envelope `{ task, asOf }`; list `{ items, page, pageSize, total, asOf }`. Full request/DTO/error rules live in the backend contract.
- **Frontend:** `src/features/tasks/data/{types,input,queries,request,server,actions,action-boundary}.ts` and `crm/{task-fields,task-form,task-detail,task-list,results}.tsx` own feature behavior. Thin `src/app/(staff)/crm/tasks/{page,new/page,[id]/page}.tsx` routes compose it. Add navigation and a tasks slot to the existing lead detail/page. Reuse existing shared primitives rather than creating a second table/form framework.
- **Consistency:** durable same-submission creation replay, conditional version/state writes and current ownership checks inside transactions. SQL scopes counts/pages. Server-derived overdue flags share one clock per response. UI handles receipt conflicts, uncertain writes and access loss without blind retries.

---

## 🚀 Execution Plan

1. **Contract, persistence and safe reads** — _(role: backend)_ — delivered: migrated Task model, exact OpenAPI and role-scoped GET endpoints.
   - [x] Added task/migration coverage for defaults, safe DTOs, deterministic ordering, input validation and populated upgrade preservation.
   - [x] Implemented schema/projections/repository, injected-clock service reads, Task indexes/relations and protected transport routes.
   - [x] Implemented one-asOf due filters, including equality and Dubai midnight, and published the OpenAPI contract.
   - [x] Backend task/migration checks passed, including fresh and populated disposable upgrades; existing records were preserved and no inferred tasks were created. No commit was made.

2. **Transactional task lifecycle and recovery** — _(role: backend)_ — delivered: POST/PATCH/status endpoints with ownership and duplicate protection.
   - [x] Added lifecycle, ownership, recovery and concurrency coverage using `tests/task-fixture.ts`.
   - [x] Implemented create, update and status service/controller paths with receipt replay and authorized conflict handling.
   - [x] Implemented serialized live-identity, receipt/resource, ownership/version/eligibility checks and canonical writes.
   - [x] Focused lifecycle, ownership, recovery and concurrency coverage passed; backend `bun run check` passed with 119 tests in 33 files. No commit was made.

3. **Frontend data and forms** — _(role: frontend)_ — delivered: generated task types, authorized reads/actions and usable create/detail workflows.
   - [x] Generated task types and added input/action/recovery coverage for conversion, exact timestamps, safe results and receipt/version recovery.
   - [x] Implemented server/browser task reads and validated Server Actions using generated contract bodies.
   - [x] Implemented shared task fields, creation/detail editing, receipt recovery and explicit review of uncertain writes.
   - [x] Frontend API validation and typecheck passed with the task unit suites; no commit was made.

4. **Task discovery and lead integration** — _(role: frontend)_ — delivered: global and lead-specific paginated task views with overdue states.
   - [x] Added task-query coverage for defaults, validation, Today/Overdue and independent lead keys.
   - [x] Implemented global/lead results, thin routes, navigation and a lead-detail Tasks slot using shared CRM primitives.
   - [x] Implemented updated-time/manual and bounded background refresh with dirty/uncertain preservation and server-derived text overdue badges.
   - [x] Frontend lint, formatting, typecheck and 241 tests in 45 files passed; task UI reuses the shared CRM primitives. No commit was made.

5. **Cross-repository acceptance** — _(role: fullstack)_ — delivered: browser/quality evidence against the complete candidate source.
   - [x] Added disposable task scenarios and task/recovery browser coverage for role transfer, lifecycle, filters and pagination.
   - [x] Covered lost/delayed writes, stale versions, session/access changes, dirty refresh, timestamp preservation and Dubai time boundaries.
   - [x] Reviewed keyboard/confirmation/loading/error states and 320/390/768/1440px layouts; shared pagination and viewing-query integration remained intact.
   - [x] Backend/frontend quality gates and runtime inspection passed. Task cases pass across documented reruns; the separate legacy serial regression passed 199 with 9 conditional skips and no failures.

6. **Review and reconcile documentation** — _(role: fullstack)_ — delivered: implementation and evidence-aligned specs, contracts and roadmap.
   - [x] Reviewed permissions, callers, clock semantics and recovery against every acceptance criterion; no residual review finding remained.
   - [x] Reconciled task specs, contract overview, indexes, root specs, plans and frontend-first roadmap copies.
   - [x] Documentation records verified delivery, checked P1-26/P1-27 and unchanged TECH_STACK. No commit, push, merge or deployment is claimed.

---

## ✅ Acceptance Criteria

**Functional**

- [x] Tasks can be created, edited, completed/cancelled and found through global/lead views under current lead ownership.
- [x] Due/overdue rules, eligibility after lead changes, lifecycle, filtering and pagination match both specs and the backend contract.
- [x] Existing lead stages/activity/inquiry context and viewing behavior remain unchanged.

**Non-functional** (performance, security, accessibility, reliability)

- [x] Receipt/version/assignment races cannot duplicate tasks, overwrite stale changes or disclose unauthorized data.
- [x] SQL-bounded lists/counts, UTC/Dubai consistency, accessible overdue text and all target widths pass.
- [x] Uncertain-write recovery and dirty-form refresh are verified; all affected quality checks, migration tests and documentation reconciliation pass.

---

## 🧪 Validation Plan

**Manual tests**

- Create from lead and global Tasks, inspect/edit, complete/cancel, reload, and follow lead/task navigation with Manager and Agent accounts.
- Check overdue/today/upcoming at Dubai boundaries, page changes, closure/reassignment and correction of overdue text without rescheduling.
- Inspect mobile/keyboard, empty/error, access expiry, explicit retries and dirty background refresh.

**Automated tests**

- Steps 1–2 own backend validation/migration/clock/ownership/concurrency/replay tests; steps 3–4 own frontend date/query/action/recovery tests; step 5 owns browser and full regression checks.
- **Review focus:** dueAt equality and Dubai midnight (1/5); stale ownership and competing writes (2/5); old receipt replay after eligibility/state changes (2/5); untouched overdue timestamps with seconds (3/5); dirty refresh and disappearing last page (4/5). Each must be represented in the owning test suite.

**Rollback / mitigation**

- Verify a populated disposable additive migration, back up SQLite before rollout, deploy backend first. Revert feature exposure/application code while retaining task records; no destructive database rollback.

---

## ⚠️ Risks & Open Questions

**Risks**

- **Risk:** Responsibility transfer surprises agents — _Mitigation:_ show current Agent and test immediate access transfer on all surfaces.
- **Risk:** Time/filter refresh misrepresents overdue work — _Mitigation:_ one server asOf, explicit Dubai labels, updated-time copy and bounded refresh tests.
- **Risk:** Response loss duplicates actions or refresh discards edits — _Mitigation:_ durable same-submission receipts, version review and dirty-form preservation.

**Open questions** _(blockers for implementation)_

- _None._ The unchanged serial legacy regression passed 199 cases with 9 conditional skips and no failures; all 36 task cases have passing evidence across the documented 35/36 worker run and two serial reruns, not one combined clean 36/36 run.
