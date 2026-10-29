# 🧭 Viewing Management Implementation Plan

> **Goal:** Deliver Phase 1 viewing scheduling, calendar visibility and post-visit feedback without changing lead-stage behavior automatically.

---

## 🎯 Objective

Connect existing leads and property inventory to real appointments. The feature is verified with complete final-source browser coverage recorded below.

---

## 📦 Scope

**In scope**

- **P1-23–P1-25:** schedule/reschedule/cancel, weekly calendar/mobile agenda, completion and feedback.
- Backend persistence/API/access rules and frontend lead-detail/calendar integration.

**Out of scope**

- Public booking, notifications, external calendars, recurring visits, conflict prevention, tasks and dashboards.
- Automatic pipeline changes, new dependencies or marking roadmap items complete before verification.

---

## ⚙️ Assumptions & Constraints

**Technical**

- Independent repositories, each on **feat/viewing-management**. Retain current Express/SQLite and Next.js architecture; no cross-repository imports.
- Backend owns transactions, authorization and contracts; frontend uses server reads and validated Server Actions. Preserve native authentication.
- Follow existing business module layering, selected persistence writes, shared CRM primitives and feature-local forms/data organization.

**Product / Business**

- Delivered defaults: **Asia/Dubai**, 60-minute initial duration, permitted duration 15–240 minutes, responsibility follows current lead assignment, overlaps allowed, manual pipeline stages, terminal records read-only.
- Creation/rescheduling requires an eligible assigned lead and bookable property. Historical appointments remain readable after property availability changes.

**Dependencies**

- Existing leads, role enforcement, property reads and CRM shell. The delivery follows the [repository-local feature spec](../../../specs/viewing-management/spec.md) and its companion repository counterpart.
- No library adoption was required; no dependency or configuration change was introduced.

---

## 🧩 Proposed Approach

- **Backend delivery:** [viewings routes](../../../src/modules/viewings/viewings.routes.ts), [controller](../../../src/modules/viewings/viewings.controller.ts), [service](../../../src/modules/viewings/viewings.service.ts), [repository](../../../src/modules/viewings/viewings.repository.ts), [schema](../../../src/modules/viewings/viewings.schema.ts), [DTO](../../../src/modules/viewings/viewings.dto.ts), [route registration](../../../src/app.ts), [Prisma schema](../../../prisma/schema.prisma) and the [additive migration](../../../prisma/migrations/20261028000000_viewing_management) implement the backend.
- **Contract:** [viewings OpenAPI](../../api/viewings.openapi.yaml) is merged into [the API contract](../../api/openapi.yaml). The frontend holds its generated local snapshot and types; no sibling source import is used.
- **Frontend delivery:** the companion frontend implements feature-owned data and CRM modules, thin calendar/new/detail routes, plus lead-detail and workspace-navigation integration. Its local feature specification and contract snapshot remain authoritative for frontend details.
- **API:** GET/POST `/api/v1/staff/viewings`, GET/PATCH `/api/v1/staff/viewings/:id`, PATCH `/api/v1/staff/viewings/:id/status`. Shapes, lifecycle and pagination are defined in the backend spec. Create deduplicates by submissionId; updates use expected versions; ownership is checked inside each write transaction.
- **Calendar:** bounded date-range reads, UTC persistence/Dubai presentation, URL-owned week/status, stable pagination and explicit loaded/total counts. Lead-specific history reuses this presentation with a leadId filter.

---

## 🚀 Execution Plan

1. **Lock contracts and persistence** — _(role: backend)_ — delivered the OpenAPI contract, Viewing persistence, retained relations, receipt fields and additive migration; populated-upgrade and database checks passed.
2. **Deliver authorized appointment API** — _(role: backend)_ — delivered routes, lifecycle/ownership enforcement and regression coverage; `bun run check` passed with 105 tests in 28 files.
3. **Integrate frontend data and booking** — _(role: frontend)_ — synchronized the local contract/types and delivered validated server actions, booking/detail forms and recovery behavior.
4. **Deliver calendar and feedback** — _(role: frontend)_ — delivered URL-owned calendar/mobile agenda, pagination, lifecycle controls, CRM navigation and focused unit coverage.
5. **Verify the agency workflow** — _(role: fullstack)_ — feature-specific desktop/mobile browser suites passed 34/34 cases, and live runtime inspection verified the intended page and clean diagnostics.
6. **Reconcile and review delivery** — _(role: fullstack)_ — reconciled feature specs, local contract, root specifications, roadmap and plan; P1-23–P1-25 are verified. No commit or push is included.

---

## ✅ Acceptance Criteria

**Functional**

- [x] Authorized staff can book a lead/property visit, reschedule/cancel it and read it from both lead details and the calendar.
- [x] A started visit can be completed with persisted feedback; multiple visits remain separate and historic records survive property changes.
- [x] Current lead assignment controls access; booking never silently changes pipeline stage or inquiry property.

**Non-functional** (performance, security, accessibility, reliability)

- [x] Ownership races, stale updates and uncertain writes cannot leak data or silently duplicate/overwrite appointments.
- [x] Date-range reads are bounded/paginated and expose partial loading honestly; Dubai dates agree across device timezones.
- [x] Keyboard operation, visible feedback and 320/390/768/1440px layouts pass; API snapshots and specs agree with delivered behavior.

---

## 🧪 Validation Plan

**Manual tests**

- Manager creates a viewing for an assigned lead; assigned Agent sees it, another Agent cannot access it; reassignment removes former-owner access.
- Reschedule, cancel and complete separate fixtures; verify property archive does not hide history and feedback persists after reload.
- Inspect desktop week/mobile agenda, day boundaries, pagination, empty/loading/error states, expired sessions and uncertain saves.

**Automated tests**

- Backend: appointment validation/lifecycle, private DTO fields, create replay, ownership reads/counts/writes, reassignment concurrency and migration/property-delete regressions. Run `bun run check`, disposable `bun run db:migrate` and `bun run db:check`.
- Frontend: validation/time conversion, calendar/filter serialization, pagination, action boundaries and save recovery. Run `bun run api:check`, `bun run lint`, `bun run format:check`, `bun run typecheck`, `bun run test` and `bun run build`.
- Integration: two final-source runs passed without failures: the viewing suites passed 34/34 desktop/mobile cases in 3.7 minutes, and the remaining existing suites passed 165 cases with 9 conditional project/viewport skips in 12.9 minutes. Together they cover 199 passing cases, 9 skips and 208 registered cases; they are not represented as one combined suite. Live Next DevTools identified the correct frontend checkout with `/crm/viewings` open and no configuration or session errors.

**Rollback / mitigation**

- Back up SQLite, deploy additive backend changes first, then frontend exposure. Roll back application exposure while preserving appointment records; no destructive database rollback.

---

## ⚠️ Risks & Open Questions

**Risks**

- **Risk:** Lead reassignment changes appointment responsibility — _Mitigation:_ derive owner live, recheck inside writes and test stale access.
- **Risk:** Local time or pagination hides appointments — _Mitigation:_ explicit Dubai labels, boundary tests, loaded/total counts and Load more.
- **Risk:** An uncertain response produces duplicate booking — _Mitigation:_ durable submission deduplication and explicit reconciliation; no automatic mutation retries.
- **Risk:** Users assume appointments and stages stay synchronized — _Mitigation:_ clear manual-stage copy and regression coverage.

**Open questions** _(blockers for implementation)_

- _N/A_. The delivered defaults are assignment-derived responsibility, manual pipeline stages, Dubai time, permitted overlaps and immutable completed feedback. Future changes need a new specification decision.
