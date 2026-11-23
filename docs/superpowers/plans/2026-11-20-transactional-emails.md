# 📨 Shared Transactional Emails Plan

> **Goal:** Extend existing email delivery to the agreed customer and staff notifications with one queue, one worker runtime and small feature-owned producers.

---

## 🎯 Objective

Replace enquiry-specific infrastructure naming and payload handling with a compact shared design while preserving verified acknowledgement delivery. Implemented locally on 2026-11-20; production activation remains separate.

---

## 📦 Scope

**In scope**

- Existing acknowledgement; staff assignment, viewing changes, due-task and enquiry emails; customer viewing confirmation, reminder, reschedule and cancellation.
- Multi-kind payloads/templates, transactional producers, live eligibility, bounded reminders, configuration and coordinated queue transition.

**Out of scope**

- Marketing, auth emails, WhatsApp, preferences UI, event bus, separate feature queues, provider webhooks and historical backfill.

---

## ⚙️ Assumptions & Constraints

**Technical**

- Preserve SQLite, encrypted ledger, BullMQ, SMTP and existing failure/lease semantics. API and worker share the same local database file.
- Existing acknowledgement v1 records and dedupe keys remain compatible; no new packages or HTTP endpoints.

**Product / Business**

- Reminder default: once 24 hours before a viewing; short-notice bookings receive confirmation/change only. Customer email is optional.
- Group switches, default off for new groups; no individual preferences in this delivery.

**Dependencies**

- Existing verified acknowledgement code must pass baseline checks. Sender authorization, provider allowance and production Redis/worker hosting remain deployment gates.

---

## 🧩 Proposed Approach

- Authoritative behavior and internal data contract: [feature spec](../../../specs/transactional-emails/spec.md). Frontend compatibility is documented in its own repository; no cross-repository source imports.
- Keep [email delivery](../../../src/modules/email/) flat: types/schemas, templates, outbox, crypto, repository, eligibility, queue, dispatcher, consumer, sender, worker, config and operator. Reuse existing files; add only `email.eligibility.ts` where it has real behavior.
- Add `leads.emails.ts`, `viewings.emails.ts`, `tasks.emails.ts` beside their business services. Customer reminders are future-due outbox records captured with the booking/reschedule, reusing dispatcher scheduling instead of adding a viewing scanner.
- Business transaction → encrypted email ledger → dispatcher → `transactional-emails` queue with notification ID → live eligibility + fenced claim → template + SMTP → terminal outcome/retry.
- Extend [Prisma schema](../../../prisma/schema.prisma) additively with minimal staff/viewing/task context and `SUPPRESSED` handling. Keep immutable encrypted payloads and legacy acknowledgement v1 support.
- Reuse current inbox trigger rules, not its SSE transport or read state. Alternatives considered: feature queues add operational overhead; a generic event bus adds indirection. One shared queue with explicit producers meets the current scope.
- No public API/data-contract changes; internal payload/context and environment changes are specified in the feature spec. Queue rename is an operational compatibility change requiring coordinated cutover.

---

## 🚀 Execution Plan

1. **Establish baseline** — _(role: backend)_ — review existing uncommitted acknowledgement delivery without reverting it; run backend checks and isolated email integration coverage. Confirm proposed reminder defaults and document baseline limitations before feature code.
2. **Generalize delivery** — _(role: backend)_ — extend `email.types.ts`, `email.crypto.ts`, `email.templates.ts` and `email.outbox.ts`; move existing acknowledgement eligibility/snapshot construction to `leads.emails.ts`. Prove encrypted v1 compatibility and unchanged dedupe/expiry. Keep old queue name until coordinated cutover.
3. **Add context and eligibility** — _(role: backend)_ — additive Prisma migration; implement `email.eligibility.ts`, repository claim integration and `SUPPRESSED` terminal handling. Update operator/retention/replay and kind switches. Suppress pending customer-viewing records transactionally on every lead email edit, even when an address later returns to the prior value. Verify current-access races, expiry and suppression without SMTP.
4. **Deliver staff events** — _(role: backend)_ — wire `leads.service.ts`, `viewings.service.ts`, feature producers and `tasks.reminders.ts` inside existing transactions. Cover assignment/reassignment, viewing changes, staff enquiries and due tasks, including no-op and self-action rules. Key task reminders by task schedule, recipient and an assignment-ownership occurrence derived from assignment/unassignment history so an away-and-back reassignment is a new event but unrelated edits are not. Email creation must remain independent of existing inbox deduplication.
5. **Deliver customer viewing events** — _(role: backend)_ — add confirmation/reschedule/cancellation producers and text/HTML templates. Test booking replay, no email, changed contact, Asia/Dubai formatting and suppression after lifecycle/schedule changes.
6. **Deliver customer reminders** — _(role: backend)_ — record future-due reminders transactionally on booking/reschedule and apply the activation cutoff. Wire the independent bounded task email scan in `server.ts` alongside existing inbox task scans. Prove catch-up, short-notice exclusion, unchanged-schedule dedupe and task progression beyond 100 already-recorded candidates.
7. **Transition the shared queue** — _(role: backend)_ — change `email.queue.ts` to `transactional-emails`; update tests/config examples/runbook. With disposable services verify old Redis job reconciliation from the ledger, lease recovery, limiter cooldown and compatible rollback. Production cutover is a separate controlled operation.
8. **Validate and reconcile** — _(role: fullstack)_ — run required backend/frontend gates and focused cross-repository smoke coverage; synchronize affected specs, environment examples, development docs and shared roadmap. Final documentation reconciliation records evidence and leaves unverified acceptance unchecked.

---

## ✅ Acceptance Criteria

**Functional**

- [x] Every agreed kind follows the spec's recipients, event keys, expiry and suppression rules.
- [x] Existing acknowledgement, phone-only workflows, business APIs and inbox behavior remain compatible.
- [x] Reminders survive restart, avoid duplicates and skip stale schedules or closed tasks/viewings.

**Non-functional** (performance, security, accessibility, reliability)

- [x] One queue and shared rate allowance; bounded scans progress through more than 100 records.
- [x] Encrypted payloads, private-data exclusions, authenticated staff links and existing uncertainty fencing are preserved.
- [x] Queue transition, additive migration, group disable and compatible rollback pass isolated checks.

---

## 🧪 Validation Plan

**Manual tests**

- Controlled captured-recipient checks covered content, time labels, authenticated links, cutover/restart and group switches. Actual external inbox arrival remains an activation check.

**Automated tests**

- Backend `bun run check` passed lint, formatting, typecheck, build and 348 tests in 75 files; disposable `bun run db:check` and fresh/populated migration coverage passed. Real isolated Redis/captured SMTP covered all ten kinds, duplicate jobs, concurrent workers, uncertainty, stale claims, replay, cutover and restart.
- Frontend API parity, lint, formatting, typecheck, 440 tests, production build and 18 selected desktop/mobile browser cases passed across the recorded initial run and exact retry.

**Rollback / mitigation**

- Disable new groups; keep a compatible multi-kind worker and additive schema. Do not roll back to an enquiry-only consumer after new kinds exist.
- Coordinate any queue switch with stopped producers/workers, ledger reconciliation and limiter cooldown; never reset terminal or uncertain records or flush Redis.

---

## ⚠️ Risks & Open Questions

**Risks**

- **Risk:** More recipients exhaust provider allowance or delay reminders — _Mitigation:_ measure combined volume/backlog, enforce shared limits and expire late reminders.
- **Risk:** Stale schedule/ownership email — _Mitigation:_ live guards and transactional claims; document the unavoidable post-claim SMTP race.
- **Risk:** Queue rename strands jobs or resets rate history — _Mitigation:_ coordinated stop/reconcile/start and provider-aware cooldown.

**Open questions** _(blockers for implementation)_

- _N/A_ — the 24-hour reminder and short-notice exclusion were implemented as the accepted defaults.
