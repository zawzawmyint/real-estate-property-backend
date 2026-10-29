# Follow-up tasks

Status: Verified 2026-10-29 on `feat/follow-up-tasks`.

## Goal

Give staff a dated next action for a lead and make missed follow-ups visible, using the existing lead ownership boundary.

## Scope and exclusions

- In scope: lead-linked tasks; create, list, read, edit, complete and cancel; due date/time; overdue filtering/highlighting; current-assignment authorization; durable creation deduplication and versioned updates.
- Out of scope: standalone/personal tasks, independent task assignees, notifications, scheduled jobs, recurring tasks, priorities, attachments, external calendars, dashboards, automatic lead-stage changes and additions to the lead activity API.
- The user approved these defaults and implementation on 2026-10-29.

## Behavior and contracts

### Ownership and eligibility

- Require a live Admin, Manager or Agent session. Admin/Manager access all tasks; Agents access only tasks for leads currently assigned to them. Scope before filtering, count, pagination, detail, mutation and receipt replay. Return 404 for missing/inaccessible leads or tasks.
- Responsibility follows the current lead assignment. No separate task owner field or assignee selector. Reassignment transfers existing task access; unassignment leaves history visible to Admin/Manager. Historical rows retain no private staff contact details.
- Creating a task requires a nonterminal lead (not won/lost), an active assigned Agent and the current expectedLeadVersion. Editing an open task requires the same eligibility and lead-version guard. A Manager must first assign an unassigned lead using existing lead controls.
- Authorized staff can complete/cancel an open task even if its lead becomes terminal, unassigned or assigned to an inactive Agent. Agents still require current ownership and their own live active session. Lead closure does not automatically finish tasks.
- Revalidate current identity, lead ownership, eligibility, versions and task state inside the serialized write transaction, following the existing viewing/lead patterns. Concurrent reassignment and writes must not bypass access checks.

### Fields, dates and lifecycle

- Required title: trimmed, 1–160 characters. Optional notes: trimmed, at most 2000 characters; blank normalizes to null. No HTML rendering.
- Each task references exactly one lead. leadId is immutable. No property relation; its lead link provides context without copying inquiry/property data.
- dueAt must be an ISO 8601 instant with Z or a numeric offset, in years 2000–9999. Reject offset-free or invalid dates; normalize to UTC. The UI enters/displays Asia/Dubai time, explicitly labelled regardless of device timezone.
- Creation and a changed dueAt require dueAt > transaction clock now. An overdue open task may have its title/notes edited while retaining its exact existing dueAt. Do not make an unchanged overdue date prevent correcting text.
- States: open -> completed or cancelled. New tasks start open. Only open tasks can be edited or transitioned; completed/cancelled tasks are read-only. No hard delete or reopen endpoint.
- Completion/cancellation records completedAt/cancelledAt respectively using server time. Completion before dueAt is allowed. Each successful edit/transition increments version once. Never mutate lead version, stage, notes, inquiry property or viewing state as a side effect.
- Overdue is derived: status = open AND dueAt < asOf, with one server-clock asOf per response. At exact equality a task is not overdue. Completed/cancelled tasks never count as overdue. There is no persisted overdue flag, background worker or notification channel.

### Persistence and canonical contract

- Task model: UUID id; unique submissionId; actorScope; payloadHash; leadId; title; nullable notes; dueAt; status (default open); version (default 1); nullable completedAt/cancelledAt/createdById; createdAt/updatedAt. Lead deletion is restricted; creator deletion sets createdById null. actorScope is a durable receipt scope even if creator is deleted.
- Add Lead.tasks and User-created-task relations and indexes on status/dueAt/id and leadId/status/dueAt/id. Use selected write fields and safe projections; do not return raw Prisma objects or receipt fields.
- The backend-owned [API contract](contract.md) defines exact payloads, pagination, errors, safe DTOs and replay rules. Its machine-readable form is implemented in `docs/api/tasks.openapi.yaml` and registered in `docs/api/openapi.yaml`; the frontend snapshot/types derive from it.
- No dependency, environment-variable or operator-command change was introduced. The existing migration and transaction infrastructure is used.

## Acceptance criteria

- [x] P1-26: authorized staff create a lead-linked dated task, inspect it, edit it while open, and complete/cancel it; state survives reload.
- [x] P1-27: only open tasks strictly before server asOf are overdue; list filters/counts and response flags agree at time boundaries.
- [x] Admin/Manager and Agent access match current lead assignment on lists/counts/details/writes/replays, including reassignment, unassignment, disabled sessions and concurrent changes.
- [x] Lead eligibility and expected versions prevent stale create/edit; completion/cancellation retain access to historical tasks without requiring current lead eligibility.
- [x] Identical authorized creation retries insert once; changed receipt payloads conflict; inaccessible/other-actor receipts never disclose saved task identifiers.
- [x] Stale/competing updates cannot overwrite one another, terminal tasks reject writes, and overdue text edits preserve unchanged dueAt.
- [x] Pagination is bounded/stable; DTOs omit staff email, lead contact details, owner contacts and receipt material; strict inputs reject unknown/duplicate fields.
- [x] An additive migration preserves populated lead/viewing/auth data and gives existing leads no inferred tasks; API documentation and frontend snapshots match verified delivery before completion.

## Validation

- Implemented suites are `tests/tasks.test.ts` (validation, dates, list/count/DTO), `task-lifecycle.test.ts` (eligibility, edit, transitions), `task-ownership.test.ts` (all access surfaces), `task-recovery.test.ts` (receipts/versioning), `task-concurrency.test.ts` (assignment/write races), and feature-local `tests/task-fixture.ts`.
- Injected-clock coverage passed for before/equal/after dueAt, Dubai midnight, completed/cancelled exclusion, past-date rejection, preserved overdue dates and offset-equivalent unchanged instants.
- Recovery coverage passed for replay after lead eligibility changes, saved task edit/completion, creator-role/assignment changes and revoked access; replay returns the currently authorized task without reapplying an old payload.
- `tests/migration.test.ts` covers fresh and populated disposable SQLite upgrades and retained relations. `bun run check`, disposable migration checks and `bun run db:check` passed; the local development database was backed up before its additive upgrade.
- Current task browser evidence covers lead-detail creation, role transfer, overdue display/filtering and safe retries. The unchanged serial legacy regression passed 199 cases with 9 conditional skips and no failures.

## Risks and rollout

- Responsibility transfer is intentional; show current assigned Agent in task presentation. Personal checklists would require a separate scope decision.
- Existing open tasks can remain overdue after lead closure. Show them honestly and offer complete/cancel; do not silently discard outstanding actions.
- Back up SQLite before rollout, verify an additive populated upgrade, deploy backend before frontend exposure. Roll back application exposure while retaining task records; do not drop collected tasks.
- No product decision or verification gap remains for this slice. Lead-linked ownership, terminal records, future-date rules and Dubai time were approved on 2026-10-29.

## Implementation evidence

- The task module, API registration, additive migration and OpenAPI contract are implemented. Fresh and populated disposable migration checks passed; they confirmed seven migrations, preserved existing lead/viewing records and created no inferred tasks. The local development database was backed up before its additive upgrade.
- `bun run check` passed: lint, formatting, Prisma generation/typecheck, 119 tests in 33 files and production build. Task coverage includes ownership, lifecycle, receipt recovery, concurrent writes, clock boundaries and migration behavior.
- Frontend/browser verification passed: all 36 task cases have passing evidence across the documented worker/serial reruns, and the unchanged legacy serial regression passed 199 cases with 9 conditional skips and no failures. P1-26/P1-27 are verified.
