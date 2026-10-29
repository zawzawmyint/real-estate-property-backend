# 📊 Agency Dashboard Implementation Plan

> **Goal:** Deliver P1-28–P1-30 as an authorized CRM Overview with clearly defined lead metrics and shadcn/ui charts.

---

## 🎯 Objective

Replace the `/crm` placeholder with useful lead acquisition and current-pipeline summaries. **Verified:** the endpoint, dashboard composition, local API snapshot/generated declarations and charts are delivered. Read the repository-local [feature spec](../../../specs/agency-dashboard/spec.md) first; the companion backend contract remains authoritative.

---

## 📦 Scope

**In scope**

- P1-28: weekly new leads, current Won count and all-time current Won/total percentage.
- P1-29–P1-30: source bar chart and horizontal stage bar chart, including accessible text equivalents.
- Role-scoped aggregate API, generated frontend types, responsive loading/empty/error/retry states and verification.

**Out of scope**

- Historical/cohort reporting, date/agent filters, revenue, rankings, task/viewing widgets, exports and notifications.
- Homepage/public mobile completion, deployment and changing lead-write behavior.

---

## ⚙️ Assumptions & Constraints

**Technical**

- Independent repositories on `feat/agency-dashboard`; use existing Express → Prisma/SQLite ownership and Next.js server-only transport. No cross-repository imports, shared dependency assumptions, migration or new production configuration expected; dedicated browser verification uses documented test-only variables.
- Follow repository AGENTS.md and relevant implementation skills. Use Node 24.14.1/Bun 1.3.14; retain frontend Webpack.
- The local shadcn/ui Base Nova Chart primitive and `recharts` 3.8.0 are installed for this dashboard. No additional production runtime configuration was introduced.
- No shared aggregate cache, browser persistence or polling. Use live staff authorization and no-store.

**Product / Business**

- Approved defaults: Admin/Manager agency totals including unassigned leads; Agent current own-assignment totals.
- Week starts Monday 00:00 **Asia/Dubai**. Weekly acquisition uses creation time; other metrics use all-time current source/stage with a common generatedAt cutoff.
- Conversion means **current Won / all visible leads**, one decimal, null for no leads. Reopening/reassignment changes the next snapshot. This is not historical performance attribution.

**Dependencies**

- Existing lead schema, source/stage enums, staff authentication, CRM shell and test fixtures.
- Backend-owned contract and additive OpenAPI must settle before frontend integration.

---

## 🧩 Proposed Approach

- Use one `GET /api/v1/staff/dashboard` summary response rather than frontend aggregation of paginated lead records. This avoids overfetching/private records and preserves one authorized snapshot.
- Prefer two bar charts over a donut: labels and category counts remain easy to compare, including zeros. Use existing Cards for metrics rather than chart components for plain numbers.
- Keep fixed periods for this slice; date filtering adds metric/URL complexity without being required by P1-28–P1-30.
- Backend implementation files are `src/modules/dashboard/dashboard.routes.ts`, `dashboard.controller.ts`, `dashboard.service.ts`, `dashboard.repository.ts` and `dashboard.dto.ts`, mounted from `src/app.ts`. The repository performs counts/grouping in one SQLite read transaction; the service determines clock/scope/formulas/category filling.
- Frontend implementation is directly under `src/features/dashboard/` (`dashboard-results.tsx`, `dashboard-view.tsx`, `dashboard-charts.tsx`, `request.ts`, `server.ts`, `schema.ts`, `types.ts` and `presentation.ts`), with local `src/components/ui/chart.tsx` and `src/app/(staff)/crm/page.tsx`. Chart rendering is client-side; initial reads remain server-side.
- API contract: no query parameters; exact fields and arrays are defined in the backend-owned contract. Unknown parameters return 400 after auth. Response contains no identifying records; all aggregates apply current assignment scope and `createdAt <= generatedAt`.
- Backend publishes `docs/api/dashboard.openapi.yaml` and adds the root contract reference. Frontend receives `docs/contracts/dashboard.openapi.yaml`, adds `dashboard` to `scripts/generate-api.mjs` and generates `src/lib/api/generated/dashboard.d.ts`.
- Existing references: [repository-local feature specification](../../../specs/agency-dashboard/spec.md), [roadmap](../../../ROADMAP.md) and [tool inventory](../../../TECH_STACK.md).

---

## 🚀 Execution Plan

1. **Authorize and aggregate the dashboard** — _(role: backend)_ — a tested read-only endpoint and authoritative API contract.
   - [ ] Read the backend spec/contract and existing auth, transaction, errors, lead enums and integration fixtures. Confirm the proposed definitions with the reviewed specification before implementation.
   - [ ] Add `tests/dashboard.test.ts` and `tests/dashboard-metrics.test.ts`. Assert Admin/Manager/unassigned inclusion, two-Agent isolation, rejection of query scope/agent injection, absent/revoked sessions, exact DTO keys and no-store on success/errors. Run `bun run test -- tests/dashboard.test.ts tests/dashboard-metrics.test.ts`; confirm the missing endpoint/behavior fails for the intended reason.
   - [ ] Implement `createDashboardRepository(database)`, `createDashboardService(database)`, `createDashboardController(service)` and `mountDashboard(app, auth, database)` with established dependency types. Service exposes `summary(actor)` returning the contract DTO; give its clock an injectable `() => Date` default for deterministic tests. Use existing staff actor typing when compatible. Repository accepts explicit transaction and authorized predicate for every query; do not export private record projections.
   - [ ] Test the 10/2/3 → 20% fixture; 2/3 → 66.7%; zero → null; old Won leads, repeated win events, reopened Won, reassignment, all categories including zeros, both sums equal total. Add deterministic fixtures around Sunday `2026-10-25T19:59:59.999Z`, Monday `2026-10-25T20:00:00.000Z`, future timestamps and the exact generatedAt cutoff.
   - [ ] Prove snapshot consistency under a deterministic interleaved write or adapter-level transaction test. Test safe DB failure rather than zero fallback. Re-run focused tests and require all pass.
   - [ ] Publish the OpenAPI and root reference matching the prose contract and actual error envelope. Run backend `bun run check` and `bun run db:check`; review query volume on representative data. Commit the coherent API slice only after verification if commits are part of the authorized execution workflow.

2. **Deliver the CRM Overview** — _(role: frontend)_ — scoped metrics and accessible charts from the real endpoint.
   - [ ] Copy the authoritative OpenAPI snapshot, update the generator domain list and run `bun run api:generate`. Define `DashboardSummary` from generated response types in `data/types.ts`; implement `requestDashboard` and server-only `getDashboardSummary()` following existing allowlisted-cookie/error/no-store transport.
   - [ ] Add `tests/unit/dashboard-queries.test.ts` and `tests/unit/dashboard-presentation.test.ts` before corresponding implementation. Cover request URL, cookies/no-store, 401/500 behavior, one-decimal percent/null, zero category ordering and scope labels. Confirm intended failures with `bun run test -- tests/unit/dashboard-queries.test.ts tests/unit/dashboard-presentation.test.ts`.
   - [ ] Check current official chart docs and Base Nova registry, install the selected compatible Recharts version and only required chart primitive. Record installed versions in TECH_STACK only after manifest/lockfile and verification agree. Reuse existing semantic chart tokens if present; otherwise add only the needed chart tokens to `src/styles/tokens.css`.
   - [ ] Implement server-owned `DashboardResults`, metric presentation and client `DashboardCharts` with generated DTO props. Replace the Overview placeholder using existing PageHeader/Card/Alert/Button patterns and a Suspense result region. Keep response scope/time with the results. Add explicit retry through existing navigation/refresh patterns; never substitute zero data after errors.
   - [ ] Build zero-data and nonzero category count tables/lists alongside charts; use readable source/stage labels, stable order, no color-only meaning, responsive dimensions and reduced motion. Keep Properties accessible through existing navigation.
   - [ ] Re-run focused tests; run `bun run api:check`, `bun run lint`, `bun run format:check`, `bun run typecheck`, `bun run test` and `bun run build`. Commit a coherent verified UI slice if authorized.

3. **Verify role boundaries and reconcile delivery** — _(role: fullstack)_ — tested browser behavior and accurate delivery records.
   - [ ] Extend `scripts/auth-e2e-server.ts` and existing frontend fixture support with isolated dashboard accounts/data, without altering legacy fixture expectations. Add `tests/e2e/dashboard.spec.ts` for Admin, Manager and two Agents, exact counts, unassigned visibility, reassignment/refresh and reopening/refresh.
   - [ ] Cover no leads, delayed loading, backend failure/retry, revoked session and attempts to request broader scope. Check returned/network/accessible data, not only visible headings. Confirm repeated navigation cannot reuse another user's data.
   - [ ] Exercise desktop and 360px mobile layouts, keyboard retry/navigation, count alternatives, reduced motion, chart hydration and no horizontal overflow. Verify same counts at both viewports.
   - [ ] Start the intended backend fixture on port 4311 and run `bun run test:e2e` from frontend. Confirm runtime identity on frontend port 3100 using next-devtools, open `/crm`, inspect `get_errors`/`get_page_metadata`, and inspect browser console for chart sizing/hydration errors. Stop an owned dev server before production builds; never stop unrelated processes.
   - [x] Run final affected quality gates and review the whole diff against both specs and privacy invariants. Record exact passed/failed/skipped evidence and document the legacy-suite limitation.
   - [ ] Delegate final documentation reconciliation to `spec-updater` when available, assigning documentation ownership and reviewing its diff. Update feature/root specs, indexes, local API docs and shared ROADMAP/TECH_STACK frontend-first; sync backend copies. Mark P1-28–P1-30 verified only when all acceptance passes. Do not mark public homepage/mobile or Phase 1 release complete.

---

## ✅ Implementation Status

- Backend: 126 tests across 35 files, lint, type checks, build and disposable-database verification passed. Dashboard coverage includes authorization, fixed Dubai boundaries, zero fill, query rejection, safe failures, a real SQLite WAL snapshot assertion and a 10,000-fictional-lead aggregate measurement.
- Frontend: 271 tests across 46 files, lint, API drift checks, type checks and production build passed. Focused coverage includes malformed dashboard DTO rejection.
- The final `STAFF_E2E_DASHBOARD_ONLY=1` fixture run passed all 16 dashboard cases (8 desktop and 8 mobile), with no skips or failures, in 1.9 minutes on isolated port 14311. Runtime inspection found the expected project path and no configuration/session errors with `/crm` open; refreshed desktop/mobile screenshots and visual QA passed. Legacy coverage is the union of two non-clean parallel runs (233 passed/26 skipped/1 failed, then 226 passed/26 skipped/8 failed): each active legacy case passed at least once, but timing and sign-in-cache instability prevent a clean-suite claim. The revised pipeline session case passed six focused desktop/mobile repeats.

---

## ✅ Acceptance Criteria

**Functional**

- [x] `/crm` provides the four cards and both charts; values agree with the backend contract and fixed period labels.
- [x] Admin/Manager agency and Agent own-assignment visibility hold across all returned and rendered data.
- [x] Week boundaries, zero denominator, rounding, current-stage/reassignment changes and chart totals pass deterministic tests.
- [x] Loading, empty, authentication failure and retry are usable; errors never masquerade as zeros.

**Non-functional** (performance, security, accessibility, reliability)

- [x] One consistent no-store snapshot, no raw lead overfetch/private fields and bounded aggregate query count.
- [x] Mobile/desktop, keyboard, reduced motion, text alternatives and runtime hydration checks pass.
- [x] Contracts, generated types, dependencies and docs match delivered code; all required checks have evidence.

---

## 🧪 Validation Plan

**Manual tests**

- Compare known fixture counts across roles, reassignment/reopening and refreshed snapshots; verify periods and Dubai timestamps are understandable.
- Review mobile charts/text equivalents, keyboard navigation, error/retry and runtime diagnostics with the actual page open.

**Automated tests**

- Backend SQLite/Supertest authorization, aggregation, clock and snapshot tests; frontend transport/presentation tests; integrated Playwright role/state/viewport cases from the execution tasks.
- Backend `bun run check`, `bun run db:check`; frontend `bun run check` and `bun run test:e2e`. Run focused failures before implementations and full gates after integration.

**Rollback / mitigation**

- Revert dashboard mount and Overview composition together; restore placeholder while retaining existing lead/property workflows. No schema/data rollback expected.
- Keep fixture databases isolated. Do not install deferred tools or tick acceptance based solely on these documents.

---

## ⚠️ Risks & Open Questions

**Risks**

- **Risk:** Users read conversion as a historical close rate — _Mitigation:_ explicit all-time current-state formula and card help text; historical reporting stays separate.
- **Risk:** Reassignment changes historical-looking totals — _Mitigation:_ use consistent current-assignment scope and clear snapshot labels; verify refresh behavior.
- **Risk:** Concurrent writes produce inconsistent distributions — _Mitigation:_ verify one read snapshot with the installed SQLite adapter before accepting the endpoint.
- **Risk:** Charts omit accessible values or break during hydration — _Mitigation:_ count alternatives, responsive dimensions and real browser checks.

**Open questions** _(blockers for implementation)_

_None. The approved metric definitions and role scope are implemented._

Approved design update (2026-10-29): implement the selected maroon/ivory dashboard mockup with four metric cards, adding Total leads (all time). Preserve the existing CRM shell and deliver the complete professional responsive design. The fixed-period and role-scope defaults are approved for implementation.
