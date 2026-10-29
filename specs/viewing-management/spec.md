# Viewing management

Status: Verified — 2026-10-29. Backend, frontend, browser and live-runtime evidence is recorded below.

## Goal

Deliver P1-23–P1-25: arrange a property visit for an assigned lead, review appointments in a calendar and record feedback afterward.

## Scope and exclusions

- In scope: create, read, reschedule, cancel and complete viewings; one lead and one property per appointment; role-scoped date-range reads; post-viewing feedback.
- Out of scope: public booking, client portal, notifications, recurring appointments, external calendars, travel/resource scheduling, follow-up tasks and reporting.
- These are the delivered product defaults. No new dependencies were selected.

## Behavior and contracts

### Access and ownership

- Require a live staff session for every route. Admin/Manager can access all viewings; Agent can access only viewings whose lead is currently assigned to that Agent. Apply this predicate before filtering, counting, pagination and returning feedback.
- The responsible agent is derived from the lead's current assignment, not an independently editable viewing owner. Reassignment transfers viewing access immediately; a stale former-owner request returns 404. An unassigned lead's history remains manager-visible, but new bookings/rescheduling require an active assigned Agent.
- Recheck ownership, expected versions, lead assignment and property eligibility inside the write transaction. Disabled/banned identities cannot act or receive new bookings. Do not accept an actor or assignee supplied by the client.
- Return 401 for no live session, 404 for missing/inaccessible resources, 400 for invalid input and 409 for stale versions or incompatible lifecycle state. Use existing structured errors, trusted-Origin, JSON-size and no-store protections.

### Appointment rules

- Persist instants in UTC; the UI enters and displays Asia/Dubai time with an explicit label. Require ISO 8601 timestamps with an offset; reject offset-free timestamps. End must follow start, with a duration of 15–240 minutes; UI default is 60 minutes. Creation/rescheduling requires a future start relative to the server clock.
- New appointments require a nonterminal lead (not Won/Lost), an active assigned Agent and a published, available property. The selected property may differ from the lead's original inquiry property. Never overwrite that inquiry context.
- States: scheduled -> completed or cancelled. Only scheduled records can be rescheduled/cancelled/completed. Completion is allowed once startsAt <= server now, and requires trimmed feedback of 1–4000 characters. Completed feedback is read-only in this slice; cancelled appointments retain their history. No hard delete or reopen endpoint.
- Existing appointments remain visible when a property is archived, sold/rented or a lead changes stage. Cancellation and completion remain possible for authorized staff; rescheduling must satisfy current booking eligibility. Any viewing history restricts property hard deletion; archive remains available.
- Booking, rescheduling, cancellation and feedback do not automatically change lead stage. The existing manual Viewing Scheduled stage remains available and does not guarantee an appointment exists. This feature does not extend the lead activity response; viewing history appears in the lead's separate Viewings section.
- Overlapping appointments are allowed in this first slice. The calendar makes them visible; no claim of conflict detection or conflict-free scheduling is made.

### Persistence

Add a Viewing model with UUID id, leadId, propertyId, startsAt, endsAt, status, nullable feedback, version (initially 1), nullable createdById, createdAt and updatedAt; retain propertyTitleSnapshot and propertyLocationSnapshot for historic presentation. Lead/property relations restrict deletion; creator can be set null. Index startsAt/id and leadId/startsAt/id. No copied phone, email, owner details or independently persisted assignee.

For create deduplication, accept a client-generated UUID submissionId and persist a unique submissionId, creator identity scope and canonical payload hash with the viewing. An identical replay by the same authorized actor returns the existing record without another insert; a changed payload or actor scope returns 409. After current authorization and same-actor checks, a changed payload returns code VIEWING_RECEIPT_CONFLICT with error.existingViewingId for explicit review of the saved appointment. Other-actor conflicts remain generic and expose no receipt identifier. The client retains the same submissionId during explicit corrections after an uncertain result, preventing delayed original and corrected requests from inserting separate records. Recheck current authorization before replaying any existing record. Do not reuse lead submission receipts, which are tied to lead/note operations.

### API contract (backend owned)

Base: /api/v1/staff/viewings.

- GET /?from=<instant>&to=<instant>&page=1&pageSize=50&leadId=<uuid>&status=<state>: from inclusive/to exclusive filter on startsAt; required range <= 42 days; pageSize 1–100. Optional leadId/status. Return { items, page, pageSize, total }; stable startsAt/id ascending, all states by default. No agent filter in this slice; manager calendar includes all authorized appointments.
- GET /:id: return one authorized ViewingDto.
- POST /: { submissionId, leadId, propertyId, startsAt, endsAt, expectedLeadVersion }; return 201 ViewingDto, or 200 on an identical authorized replay. The initial version guard also detects assignment changes since lead selection.
- PATCH /:id: { expectedVersion, expectedLeadVersion, startsAt, endsAt }; reschedule, returning 200 ViewingDto.
- PATCH /:id/status: { expectedVersion, status: cancelled } or { expectedVersion, status: completed, feedback }; return 200 ViewingDto. Reject extra fields and illegal transitions. Each successful update increments version atomically.
- ViewingDto: { id, lead: { id, name }, property: { id, title, location, bookable }, assignedAgent: { id, name } | null, startsAt, endsAt, status, feedback: string | null, version, createdAt, updatedAt }. Property title/location use snapshots if necessary; bookable reflects current publishing/availability. Never return staff email, owner contacts, receipt hashes or raw database records.
- Write the machine-readable contract in docs/api/viewings.openapi.yaml and merge into docs/api/openapi.yaml during implementation, before frontend integration. The frontend receives a local snapshot, with no sibling-source imports.

## Acceptance criteria

- [x] P1-23: authorized staff schedule a viewing for a currently assigned eligible lead/property; separate properties and repeat visits remain distinct records.
- [x] Date validation, current lead version, lifecycle rules and property eligibility are enforced transactionally; lead inquiry context and stage remain unchanged.
- [x] Agent list/detail/write/replay access follows current lead ownership, including reassignment races, unassignment and inactive accounts; counts do not leak other leads.
- [x] Create replay inserts once; changed replay fails; concurrent/stale updates cannot overwrite one another. Unknown write outcomes can be reconciled without blind retries.
- [x] P1-24: bounded, stable paginated calendar reads respect Dubai day/week boundaries and return all matching authorized records across pages.
- [x] P1-25: authorized staff complete a started viewing with feedback, and read its persisted feedback afterward; terminal records reject further mutations.
- [x] Archive/availability changes preserve historic reads, cancellation and completion; hard delete cannot erase viewing relations.
- [x] Additive migration preserves existing leads, properties and authentication; contracts and documentation match verified behavior.

## Validation

The delivered backend suite is [tests/viewings.test.ts](../../tests/viewings.test.ts), [tests/viewing-ownership.test.ts](../../tests/viewing-ownership.test.ts), [tests/viewing-concurrency.test.ts](../../tests/viewing-concurrency.test.ts), [tests/viewing-lifecycle.test.ts](../../tests/viewing-lifecycle.test.ts) and [tests/viewing-recovery.test.ts](../../tests/viewing-recovery.test.ts), with shared fixtures in [tests/viewing-fixture.ts](../../tests/viewing-fixture.ts). It covers range boundaries, malformed offsets, 15/240-minute limits, past starts, lifecycle transitions, field allowlists, private-field exclusion, ownership reads/counts/writes/replays, identical submissions, stale versions and simultaneous reassignment. [tests/migration.test.ts](../../tests/migration.test.ts) and property lifecycle coverage verify retained relations and hard-delete restriction. Time-sensitive coverage uses an injectable clock.

`bun run check` passed with 105 tests in 28 files; a populated disposable SQLite upgrade and `bun run db:check` passed; the local development SQLite database was backed up before the additive migration was applied and checked. The final browser coverage used two final-source runs: the viewing suites passed 34/34 desktop/mobile cases in 3.7 minutes, and the remaining existing suites passed 165 cases with 9 conditional project/viewport skips in 12.9 minutes. Together, the runs cover 199 passing cases, 9 skips and 208 registered cases, with no failures; they are not represented as one combined suite.

## Risks and rollout

SQLite was backed up before applying the additive migration; a populated disposable upgrade was verified first. Roll back exposure/application code while retaining viewing data; do not drop collected history. No environment or package change was introduced. Existing leads keep their current stages and acquire no inferred appointments.

The delivered defaults are assignment-derived ownership, manual stages, fixed Dubai time, permitted overlaps and immutable completed feedback. Changing any of them requires a new contract/specification decision.
