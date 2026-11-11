# CRM notifications

Status: Verified, 2026-11-10

## Goal

Alert staff to changes that need their attention, with a persistent inbox and live updates while the CRM is open.

## Scope and exclusions

- First slice: lead assignment and reassignment (P2-02), notification persistence, unread state and server-sent events (SSE).
- Subsequent slices: viewing reschedule/cancellation, follow-up task reminders and staff alerts for website inquiries. These extend the existing workflows and have separate acceptance criteria.
- Email delivery is a separate follow-up. A staff inquiry alert does not satisfy P2-01, which is a reply to the prospective client. Future email can reuse the relevant trigger and recipient rules, with separate templates, durable delivery state and retries. Provider selection, preferences and sending policy belong in that follow-up spec.

## Behavior and contracts

### Triggers and recipients

- **Lead assigned.** Notify the new active agent when Admin/Manager assigns an existing lead, reassigns it or creates a manual lead already assigned to that agent. No alert for agent self-create, unassignment or a same-assignee save. A new assignment after a lead returns to a previous agent produces a fresh alert; earlier alerts from their previous ownership period stay retired.
- **Viewing changed.** Notify the current active lead assignee when a scheduled viewing's time actually changes or it is cancelled. Skip when that agent made the change or the lead has no active assignee. Viewing creation and feedback are outside this slice.
- **Task due soon.** Every 60 seconds, scan open tasks due within the next 30 minutes, using UTC instants. Notify the current active lead assignee once per task, due time and recipient. Skip unassigned, completed, cancelled and already overdue tasks. An upcoming task can be picked up after restart. A completed, cancelled, rescheduled or reassigned task retires the affected alert; reopening with the same due time and recipient does not send a duplicate.
- **Website inquiry received.** Notify active Admin and Manager users when a new property or general website inquiry successfully creates a lead. Use the shared public inquiry persistence path. Manual leads, rejected inquiries and receipt replays produce no website-inquiry alert. Retire the inbox item when the inquiry is assigned.

### Persistence and authorization

Use an additive SQLite migration. Store a notification ID, recipient ID, type, lead ID, optional viewing/task ID, source occurrence key, creation timestamp, nullable read timestamp and nullable retirement timestamp. Use uniqueness on recipient plus occurrence key, and index inbox reads. Use committed lead/viewing versions or the created inquiry lead ID as occurrence keys, and use task ID plus due time for reminder occurrences. Keep message copy and contact data out of the stored payload.

Write notification rows and retire obsolete rows inside the business transaction. Task scanning is bounded and rechecks ownership, status and due time in the transaction before inserting. Retries and conflicts must not produce extra rows or signals. Publish inbox change signals only after commit, including for former owners whose rows were retired. Recheck current staff and resource access on inbox reads and read mutations. Active staff can access only their own rows, including Admin and Manager. Lead-linked rows are suppressed when the recipient loses access; assignment-specific rows are visible only for the relevant ownership period.

### Live signal transport

Keep a small backend interface for publishing recipient IDs and subscribing to inbox changes. Wire one in-process implementation at startup. The notification service publishes committed changes through this interface, and the SSE handler uses it to refresh the affected recipients' connections. SQLite remains the source of truth for the inbox and unread state. Transport failures are logged and leave committed operations successful. A fresh inbox read recovers missed signals.

If multiple API instances need to exchange live signals later, add a Redis Pub/Sub implementation at the same boundary. Keep the browser SSE contract, inbox records and workflow rules independent of that choice. Select the transport at startup when the second implementation exists.

### Implemented backend-owned API

All endpoints are authenticated and no-store under `/api/v1/staff/notifications`. Session identity determines the recipient. The list request may include `X-Staff-Account`; when supplied it must equal the live session account, preventing a stale browser account from receiving that account's inbox. The read request does not accept that header.

- `GET /` accepts optional opaque `cursor`. Returns `{ items, unreadCount, nextCursor }`. Up to 20 visible items, newest first by creation timestamp then ID. The unread count covers all visible unread rows, independent of cursor. Each item returns `{ id, type, leadId, viewingId, taskId, createdAt, readAt }`, with nullable viewing/task IDs and read timestamp. Timestamps are ISO 8601 UTC. Types are `lead_assigned`, `viewing_rescheduled`, `viewing_cancelled`, `task_due_soon` and `website_inquiry_received`.
- `PATCH /{id}/read` accepts no body and returns 204. Setting read is idempotent and preserves the first read timestamp. Unknown, retired or other-user IDs return 404. Invalid cursor or path input returns 400. Use the existing 401/403 staff authorization responses.
- `GET /stream` returns `text/event-stream` with `Cache-Control: no-store, no-transform` and `X-Accel-Buffering: no`. Send an initial `notifications.changed` event after subscribing and the same event after a committed inbox change for that user. Its data is `{}`. Use a 15-second heartbeat comment and check live access at each heartbeat. End expired/revoked connections and clean up on client disconnect or API shutdown. End a connection that cannot accept writes so it can reconnect and reload; never queue an unbounded backlog. Snapshot reads handle reconnects, so event replay is unnecessary.

## Acceptance criteria

- [x] Assign/reassign and assigned manual creation produce one unread item for the correct agent. No-op, receipt replay, conflict and rollback create no duplicate alerts.
- [x] Two agents cannot read or mark each other's alerts, observe each other's stream events or use stale alerts to bypass resource access. Reassignment and unassignment remove stale items from the old inbox and unread count.
- [x] Active clients receive committed changes without polling. Offline clients can recover via an inbox read; disconnect, revocation and shutdown release streams.
- [x] A test signal transport can replace the in-process transport through app wiring. A failed publish leaves the committed notification available on the next inbox read.
- [x] Reschedule and cancellation notify the current responsible agent once per committed change. Self changes and unchanged times produce no alert.
- [x] A reminder is considered on a successful scan in the due window, subject to the earliest-due-first 100-candidate cap. Repeated scans, stale candidates, edits, status changes, reassignment and restart follow the reminder rules.
- [x] Both public inquiry entry points notify eligible recipients once. Receipt replay, failed writes and manual leads do not create alerts. Assigning the inquiry clears the actionable staff alert.

## Validation

The backend passed 173 tests in 43 files with Node Vitest threads (`maxWorkers=2`, `testTimeout=15000`), ESLint, `tsc --noEmit`, production build, a disposable migrated `db:check`, and fresh/populated migration tests. The reminder scan caps each pass at 100 task candidates and obtains the clock after the SQLite lock, preventing a queued scan from treating an already-overdue task as due soon. The transport adapter starts with the application and the scheduler/streams stop on graceful shutdown. Frontend verification independently covered the same-origin CRM path. A prior cold concurrent full run had one public-chat timeout; the final configured full run passed. Repository formatting passed with Prettier's EOL-auto check; inherited checkout CRLF differences remain outside this feature.

## Risks and rollout

Start with one long-running Express process. The first version uses an in-process signal fanout and a bounded scheduler; production ingress must preserve streaming. Revisit signal distribution before multi-instance deployment. Roll back application code while retaining the additive table. The lead assignment API and existing stored records remain compatible, with no notification backfill. Redis Pub/Sub and email delivery are not implemented.
