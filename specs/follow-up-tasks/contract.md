# Follow-up task API contract

Status: Verified 2026-10-29 — backend owned implemented contract.

## Transport and access

Base: `/api/v1/staff/tasks`. Every route requires a live staff session and no-store responses. Writes use the existing trusted-Origin, JSON content-type and 16kb body protections. Apply [feature ownership rules](spec.md#ownership-and-eligibility) transactionally. Strict schemas reject extra body/query fields and duplicate query keys. IDs/submissionId are UUIDs; expected versions are positive integers.

## Responses

TaskDto contains `{ id, lead: { id, name }, assignedAgent: { id, name } | null, title, notes: string | null, dueAt, status, isOverdue, completedAt: string | null, cancelledAt: string | null, version, createdAt, updatedAt }`. Dates are UTC ISO strings; status is `open | completed | cancelled`. assignedAgent is the current lead assignment, not the creator. Omit lead phone/email, staff email, property owner fields, creator credentials, receipt hashes and actorScope.

Single-record success returns `{ task: TaskDto, asOf: string }`. List success returns `{ items: TaskDto[], page, pageSize, total, asOf: string }`. All isOverdue values and overdue predicates use that response's single asOf instant. Read and write DTOs use the same projection.

## Endpoints

- **GET /**: optional `leadId`, `status=open|completed|cancelled|all` (default open), `due=all|overdue|today|upcoming` (default all), `page` (default 1; 1–1000000), `pageSize` (default 20; 1–100). Stable order dueAt ascending then id ascending. SQL applies authorization and filters before count/skip/take; items and total share a transaction/clock. Explicit inaccessible leadId returns 404, not an empty result. No agent filter, free-text search or arbitrary ordering in this slice.
- **GET /:id**: return the current authorized task.
- **POST /**: `{ submissionId, leadId, expectedLeadVersion, title, notes?: string | null, dueAt }`. Return 201 on creation, 200 on identical authorized receipt replay. Notes omitted or blank normalize to null; titles trim; date offsets normalize to UTC before hashing. Include expectedLeadVersion in the canonical payload hash.
- **PATCH /:id**: `{ expectedVersion, expectedLeadVersion, title, notes: string | null, dueAt }`. Full editable-field replacement; no partial field ambiguity. leadId, status and creator/assignment are not accepted. Return 200.
- **PATCH /:id/status**: `{ expectedVersion, status: completed | cancelled }`. No other fields. Return 200; no expectedLeadVersion requirement because existing open tasks can be resolved after eligibility changes. Current identity, ownership, task state and version still apply transactionally.

## Due filters

- `all`: no dueAt predicate; status filter still applies.
- `overdue`: requires effective status open (explicit all/completed/cancelled returns 400); dueAt < asOf.
- `today`: dueAt within [Dubai midnight, next Dubai midnight), including already-overdue tasks today; status filter applies independently.
- `upcoming`: dueAt >= asOf; status filter applies independently. At equality a task is upcoming, not overdue.
- No date-range requirement; all history remains reachable through bounded pages. A task may be both Today and Overdue; these are separate views, not mutually exclusive statuses.

## Creation recovery and write races

Persist submissionId, actorScope and canonical payload hash with the task in one serialized transaction. Recheck live identity and current task/lead access before returning a receipt result. An identical same-actor retry returns the current authorized task even if its state, lead version or due time has since changed; do not rerun creation eligibility for an already committed receipt. A changed payload for the same actor returns 409 `TASK_RECEIPT_CONFLICT` with `error.existingTaskId` only after current authorization. An other-actor receipt conflict is a generic 409 without identifiers; an inaccessible receipt resource is 404. Never copy the viewing receipt code without preserving this authorization order.

The client retains a single submissionId across uncertain retries and corrections. A delayed original and corrected request must compete for that same unique receipt, allowing at most one insert. A new deliberate task after a known successful save uses a new submissionId. Do not automatically retry writes. Versioned mutations use conditional version/state/ownership writes, so two competing updates yield one success and one 409 (or 404 when access was revoked).

## Errors and privacy

Use the existing `{ error: { code, message, requestId, ... } }` transport envelope; only the authorized receipt-conflict extension adds existingTaskId. 400 `VALIDATION_ERROR`: malformed fields/UUID/date/query, invalid combination, title/notes limits or nonfuture new/changed due date. 401 `UNAUTHENTICATED`: absent/expired/revoked staff session. 404 `NOT_FOUND`: missing/inaccessible lead/task. 409 `CONFLICT`: stale expected version, ineligible lead, terminal task mutation or generic receipt conflict. 409 `TASK_RECEIPT_CONFLICT`: authorized same-actor changed creation payload. Existing transport middleware retains its established content/body-size/Origin errors; do not remap them to business conflicts.

The machine-readable contract is `docs/api/tasks.openapi.yaml`, registered in the aggregate API document and copied verbatim to frontend `docs/contracts/tasks.openapi.yaml`; frontend `src/lib/api/generated/tasks.d.ts` is generated from that snapshot. This document explains the implemented contract; the OpenAPI file is the schema source for generated consumers.
