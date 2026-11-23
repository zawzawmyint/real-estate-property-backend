# Shared transactional email notifications

Status: Implemented locally — closeout verified 2026-11-23. Local verification is complete; production migration, activation, live SMTP/inbox observation and deployment remain separate gates.

## Goal

Extend the verified enquiry acknowledgement delivery into a small shared transactional email system for customers and staff, using one queue and one worker runtime.

## Scope and exclusions

- Include existing customer enquiry acknowledgements; staff lead assignment/reassignment, viewing reschedule/cancellation, due-task and new website enquiry alerts; customer viewing confirmation, reminder, reschedule and cancellation emails.
- Reuse the encrypted database ledger, dispatcher, Redis/BullMQ, SMTP sender, fencing, recovery, rate limits, operator commands and retention. Keep feature eligibility in its owning business module.
- Exclude marketing, WhatsApp, auth emails, attachments, customer accounts, calendar integration, preferences UI, delivery-status UI, provider webhooks, bulk backfill, separate feature queues and a generic event bus.
- No frontend behavior or public/staff HTTP contract changes. Backend owns this contract; frontend records a repository-local compatibility spec.

## Behavior and contracts

### Structure and ownership

- Keep `src/modules/email/` as shared delivery infrastructure. Rename the Redis queue from `enquiry-emails` to `transactional-emails`; retain job name `send-email` and ID-only payload `{ notificationId: string }`.
- `email.types.ts` owns the supported kind union and strict, versioned payload schemas. `email.templates.ts` selects a renderer by kind and template version. Retain the existing acknowledgement v1 format so queued encrypted records remain readable.
- Make `email.outbox.ts` a shared transactional writer accepting an explicit kind, templateVersion, dedupeKey, nullable leadId, scheduling timestamps, typed payload and optional staff/viewing/task context. It validates and encrypts; it does not decide business eligibility or contact Redis/SMTP.
- Rename the existing enquiry-specific producer to `createEnquiryEmailProducer` in `leads.emails.ts`. Add focused `viewings.emails.ts` and `tasks.emails.ts` producers; keep recipient/event rules near their owning services. Do not introduce producer classes, plugin registries or base services.
- Reuse encryption internals, but validate seal/open payloads by `(kind, templateVersion)`, not the current enquiry-only schema. Reject unknown kinds/versions without sending.
- Add a small `email.eligibility.ts` for worker-side live eligibility reads and cancellation decisions. Use explicit kind cases and existing repositories/transaction clients; do not build a generic policy engine.
- Preserve the existing database-led retry/lease model and `UNCERTAIN` behavior. SMTP acceptance is `SUBMITTED`, never proof of inbox delivery.

### Events and recipients

- `WEBSITE_ENQUIRY_RECEIVED`: preserve existing acknowledgement eligibility, snapshot, dedupe key and 24-hour expiry exactly.
- `LEAD_ASSIGNED`: new active Agent after assignment/reassignment or assigned manual creation. Match existing inbox rules: no same-assignee save, unassignment or agent self-create. A later return to the same Agent is a new occurrence.
- `STAFF_WEBSITE_ENQUIRY_RECEIVED`: one email per active Admin/Manager for a newly accepted public enquiry. No manual/imported leads, receipt replay or historical backfill; skip if already assigned before send.
- `STAFF_VIEWING_RESCHEDULED` and `STAFF_VIEWING_CANCELLED`: current active assigned Agent, excluding the actor, matching existing inbox triggers. No staff confirmation email in this scope.
- `TASK_DUE_SOON`: current active assigned Agent for an open task due within the existing next-30-minutes window. Preserve inbox scan semantics; skip completed, cancelled, overdue and unassigned tasks.
- `CUSTOMER_VIEWING_CONFIRMED`: once for a fresh scheduled viewing. Authorized booking receipt replay creates no new email.
- `CUSTOMER_VIEWING_RESCHEDULED`: when start or end actually changes, once per committed change. Include the new schedule and a short rescheduling message.
- `CUSTOMER_VIEWING_CANCELLED`: once per committed cancellation, showing the cancelled schedule. Completion produces no email.
- `CUSTOMER_VIEWING_REMINDER`: one reminder per viewing schedule and customer address, eligible during the 24 hours before startsAt and expiring at startsAt. A booking/reschedule inside that window receives confirmation/change email only, avoiding an immediate duplicate reminder.
- Customer emails require the lead's current valid email; phone-only workflows continue successfully. Staff addresses come from the current active staff record, never client input. No fallback to a former agent or arbitrary manager.

### Transactions, deduplication and scheduling

- Save each immediate email and its business mutation in the same SQLite transaction. Outbox failure rolls back that mutation; Redis/SMTP outages do not. Use the same transaction for inbox and email creation without making email depend on SSE publishing or inbox read state.
- Use deterministic keys with kind, occurrence and recipient identity. Occurrences: existing enquiry key unchanged; lead ID + committed assignment version; viewing ID + committed change version; task ID + dueAt + assignment-ownership occurrence; staff enquiry lead ID. A task's ownership occurrence counts actual assignment/unassignment transitions in its lead activity history, so reassignment away and back creates a new event while unrelated lead edits do not. Staff recipient identity is user ID. Customer reminder schedule identity is viewing ID + schedule-event version + startsAt + endsAt + hashed normalized recipient (completion must not create a reminder).
- Define these keys centrally in each feature producer and enforce unique ledger dedupeKey. Hash normalized customer addresses before including them in plaintext dedupe keys. Never use lead ID alone for repeatable assignment/viewing events. Reminder keys also include the actual schedule-event version: restoring an earlier slot after a real reschedule is a fresh schedule occurrence; a no-op save produces no new reminder.
- Keep the existing bounded 60-second inbox task scan in `tasks.reminders.ts`; run an independent email scan from `tasks.emails.ts` beside it. Existing inbox deduplication cannot suppress first email delivery.
- Customer reminder production occurs in the booking/reschedule transaction: write a future-due ledger record with nextAttemptAt = startsAt minus 24 hours and expiresAt = startsAt. The existing dispatcher handles due work and restart catch-up. No separate viewing scanner is needed. Suppress pending viewing work on real reschedule/cancel/complete; no-op saves preserve it.
- The task email scan handles oldest due candidates first, at most 100 per transaction, using a `(dueAt, id)` cursor. Keep progression across ticks and reset after completing a pass or restarting. Read clock/state after the SQLite write reservation. Multiple scanners rely on database uniqueness; no overlapping local scheduler run. Catch up only within the existing reminder window.
- Immediate new kinds expire after 24 hours; staff task reminders expire at dueAt. Customer/staff viewing confirmation or reschedule emails expire at the earlier of startsAt and creation + 24 hours. Cancellation emails expire after 24 hours. The reminder expires at startsAt. All send paths require now < expiresAt.

### Live eligibility and stale messages

- Recheck business context and recipient address in the database immediately before the send claim. Suppress if the recipient changed, staff became inactive, ownership changed, task closed/moved, viewing schedule changed, or relevant lifecycle no longer matches.
- Confirmation/reschedule/reminder require a currently scheduled viewing with matching schedule. Cancellation requires a cancelled viewing; completion invalidates pending schedule messages. Staff viewing emails also require current lead assignment to their recipient.
- On reassignment, suppress old queued assignment/task/viewing emails; do not silently retarget them. New eligible events/scans may produce a new record for the new recipient.
- Add terminal `SUPPRESSED` with an allowlisted reason and no SMTP attempt. Include it in terminal fencing, inspection and retention. Operator replay must revalidate eligibility; suppressions are not replayable and replay never bypasses expiry or current access.
- Couple the eligibility read and fenced send claim in a short database transaction. Release it before SMTP. A change after claim can still race with sending; document that boundary without holding database locks across SMTP.
- Customer recipient changes suppress pending snapshots; no automatic resend/backfill to a new address in this scope. Any lead email contact edit, including an edit that later restores the same address, terminally suppresses all pending customer-viewing records for that lead in the same transaction. Do not recreate those prior messages from a later matching address; a new viewing event may create new work under its own occurrence key. Replay cannot generate another recipient for a reminder occurrence after it was submitted or became uncertain.

### Payload and persistence contract

- Keep the optional restrictive lead relation and encrypted immutable content snapshots. Add only required queryable context to EmailNotification: nullable `recipientUserId`, `viewingId`, `taskId`, `sourceVersion`, `scheduledStartsAt` and `scheduledEndsAt`. Internal identifiers/times support live guards; addresses and message content stay encrypted. Specify indexes from actual reminder/eligibility queries in implementation, without a polymorphic entity framework.
- Common encrypted content: `to`, recipient display name, brand, replyTo and validated application origin. Kind-specific content contains only necessary property title/location, viewing start/end or minimal staff summary and an application-origin CRM link.
- Preserve existing enquiry payload names and renderer unchanged through explicit v1 support. Staff links remain authenticated and resource-scoped; possessing an email never grants access. Customer emails contain no CRM links, feedback, original enquiry text, private owner details or internal notes.
- Use fixed subjects per kind, escaped HTML, plain-text alternatives and origin/path-validated URLs. Render customer appointment times explicitly in Asia/Dubai with a timezone label; persist UTC instants.
- No new routes, request fields, DTOs or dependencies. Additive migration only; existing records remain readable and do not acquire new eligibility automatically.

### Configuration and queue transition

- Keep SMTP, encryption, queue prefix, concurrency and global rate settings shared. All kinds consume the same provider allowance. Default concurrency remains 2; no priorities or separate queues initially.
- Preserve `EMAIL_ENQUIRY_NOTIFICATIONS_ENABLED` for acknowledgements only. Add `EMAIL_STAFF_NOTIFICATIONS_ENABLED` and `EMAIL_CUSTOMER_VIEWING_NOTIFICATIONS_ENABLED`, default false. Check these switches at production and send time; disabling a group suppresses its pending work. Existing acknowledgement behavior is preserved.
- When customer viewing emails are enabled, require `EMAIL_CUSTOMER_VIEWING_ACTIVATED_AT`, an explicit ISO 8601 UTC deployment cutoff. Keep it stable across restarts; only viewings created at/after it are reminder-eligible. A reschedule of an older viewing may produce its new change email, but does not backfill a reminder. Enforce 24-hour lead time when the schedule event creates the intent, without treating no-op updatedAt changes as a new schedule. Invalid/missing cutoff fails configuration when this group is enabled.
- New groups are enabled only after migrations, compatible API/worker deployment and controlled-recipient verification. No auth/account settings UI is required.
- Queue rename is a coordinated maintenance operation: pause business writes and reminder scans, gracefully stop/drain old workers, deploy migration and compatible producers/consumer, then reconcile eligible nonterminal ledger IDs into the new queue before reopening writes. Resolve active send leases through existing maintenance; do not reset terminal/uncertain rows.
- New queue lacks old Redis rate history: wait at least the configured limiter duration since the final old send and verify provider allowance before resuming. Preserve old Redis jobs until ledger reconciliation is verified; never flush Redis.
- Old workers must not run beside new workers. Rollback uses a compatible multi-kind release with new groups disabled; an old enquiry-only binary cannot consume new payload kinds. Retain additive data and reconcile ledger IDs to the selected queue on any coordinated switch.

## Acceptance criteria

### Closeout review — suppression diagnostics

- [x] Proactive reschedule, cancellation and completion suppression uses `EMAIL_VIEWING_CHANGED`, matching send-time eligibility and operator inspection. Existing terminal records are retained unchanged.

### Review follow-up — worker lifecycle and maintainability

- Keep the actual active maintenance/dispatch promise when a timer tick is skipped. Graceful shutdown must wait for that work within the existing drain budget before closing dependencies; a stopped tick must not start further dispatch work.
- A queue-command publication failure makes worker readiness unavailable even while Redis connections report ready. Idle or skipped passes cannot clear it. A successful queue publication clears the publication failure. If publication succeeds but its ledger acknowledgement is lost, mark that pass unhealthy without forgetting publication success; a later healthy reconciliation or idle pass can restore readiness. Preserve lease release, database retry/reconciliation and redacted failure logging.
- Keep lead-write suppression helpers in `leads.emails.ts`; shared `email.eligibility.ts` owns send-time validation. Reuse one task-domain 30-minute reminder-window constant across inbox scanning, email scanning and send-time validation.
- [x] A delayed maintenance pass spanning multiple timer intervals cannot escape shutdown's drain.
- [x] A simulated queue-command rejection yields readiness 503 across idle passes, retains retryable ledger work and recovers after a successful publication.
- [x] Existing suppression, reminder boundaries and all email delivery contracts remain unchanged after cleanup.

### Delivered notification behavior

- [x] All listed kinds follow their recipient, trigger, exclusion and expiry rules; existing acknowledgement v1 delivery remains compatible.
- [x] Each event produces at most one record per occurrence/recipient; rollback, request replay, concurrent scans and duplicate jobs produce no extra sends.
- [x] Stale ownership, recipient, lifecycle and schedule changes suppress eligible pending emails without SMTP; completed/cancelled viewings never receive a reminder.
- [x] Durable reminder restart/catch-up, short-notice bookings, schedule changes and task batches exceeding 100 candidates behave as specified without starvation.
- [x] All kinds share one queue, worker runtime and rate limit; payloads/addresses stay out of Redis jobs and logs.
- [x] Unknown kinds/versions, unavailable keys, duplicate jobs, SMTP uncertainty and operator replay preserve existing delivery guarantees.
- [x] Group switches, queue cutover, additive migration and compatible rollback are verified with disposable services; captured SMTP is used instead of external customer mail.
- [x] Existing business APIs, inbox/SSE behavior and phone-only workflows remain compatible. Documentation records verified evidence separately from deployment gates.

## Validation

- Backend `bun run check` passed lint, formatting, typecheck, build and 348 tests in 75 files. Focused delivery coverage used disposable SQLite, dedicated Redis prefixes and captured SMTP, including all customer viewing kinds, due-task delivery, two-worker/rate-limit behavior, queue cutover, replay, suppression, legacy ciphertext compatibility and fresh/populated migration checks; `bun run db:check` passed.
- The worker lifecycle follow-up passed `bun run check` with 350 tests in 76 files, including the delayed-tick shutdown and publication/acknowledgement-reconciliation regressions. The disposable migrated-database check passed; no migration was added. A final targeted audit found no actionable issues.
- Frontend API parity, lint, formatting, typecheck, build and 440 tests in 62 files passed. Eighteen selected Edge desktop/mobile cases are covered across an initial 17/18 run and an exact mobile retry that passed twice; the initial mobile staff-sign-in TCP reset remains unexplained. Runtime inspection of the isolated active session reported no configuration/session errors.
- No external SMTP, normal-database migration, provider quota validation or deployment was performed. Live activation still requires controlled-recipient inbox observation, sender/reply-to authorization, provider allowance and production Redis/worker hosting.

- Closeout verification on 2026-11-23 reran the complete backend gate after the suppression-diagnostic correction: lint, formatting, typecheck, 350 tests in 76 files and production build passed. The regression first failed for proactive reschedule/cancellation/completion records, then passed 10 focused transactional-email tests after the correction; independent review found no remaining issue. A fresh disposable migration, rerun and database check passed. The frontend gate passed API parity, lint, formatting, typecheck, 440 tests in 62 files and production build. One clean captured-SMTP Edge run passed 18 selected desktop/mobile enquiry, assignment, viewing and task cases; runtime inspection of `/properties` had no configuration, session or browser errors. No external SMTP, normal-database migration, activation or deployment was performed.

## Risks and rollout

- This expands message volume and shares FIFO capacity. Measure backlog age and reminder lateness; tune within SMTP allowance before considering priorities or separate queues.
- Retain the current SQLite same-host/shared-file API/worker constraint and all existing encryption/SMTP activation gates. Redis does not remove that constraint.
- Product defaults are one 24-hour customer reminder, no short-notice reminder and group-level switches rather than individual preferences.
- The existing acknowledgement spec remains authoritative for P2-01; its shared-delivery compatibility is reconciled below without broadening its business scope.
