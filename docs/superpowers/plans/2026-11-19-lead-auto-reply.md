# 📧 P2-01 Website Enquiry Emails Implementation Plan

> **Goal:** Acknowledge new website enquiries through a reusable database outbox, Redis/BullMQ and an independent SMTP worker without coupling enquiry success to email availability.

---

## 🎯 Objective

Historical implementation plan. The P2-01 scope is implemented locally as of 2026-11-20: website visitors who provide email receive a receipt acknowledgement; staff retain their existing in-app alerts. The delivery record does not authorize production activation or live sending.

**Delivery record (2026-11-20):** Backend `bun run check` passed with 72 files/332 tests. Frontend API parity, lint, typecheck and 440 unit tests passed; the prior production build remained valid because no frontend product code changed. Final Edge browser coverage passed 23 tests with five expected skips, including four captured acknowledgement cases, against isolated frontend port 3110, backend port 4341, proxy port 4312 and Redis port 16381. Focused email tests passed 22 cases. Fresh migration/rerun/database checks passed. No live SMTP email, normal-database migration, deployment, reference-Redis availability, authorized sender/reply-to validation, provider-quota validation or inbox-delivery observation is claimed.

**Execution record:** The task list below preserves the original implementation sequence; unchecked procedural boxes are historical planning steps, not remaining feature work. Local acceptance and the delivery evidence above record completion. Live provider/quota/hosting gates remain unchecked intentionally. Tests were consolidated into the actual files named below rather than duplicating assertions across test files.

**Execution:** Use `superpowers:executing-plans` for inline implementation or `superpowers:subagent-driven-development` if the user chooses delegated execution. Read both repository specs and the backend-owned contract before starting. Each task follows a failing meaningful test, minimal implementation, passing verification and a reviewable commit when commits are authorized.

---

## 📦 Scope

**In scope**

- Both existing public enquiry routes; optional email; one acknowledgement per new eligible enquiry.
- Shared typed email delivery, encrypted ledger, database-owned retries, Redis reconciliation, independent worker and operator inspection/replay.
- Additive migration, safe configuration, email text/HTML, disposable integration and public-form compatibility checks.

**Out of scope**

- Manual/imported leads, historical backfill, assignments, viewing/auth/marketing emails, public registration and WhatsApp.
- New CRM delivery UI, Redis notification fanout, provider webhooks, public email-status APIs and actual deployment.

---

## ⚙️ Assumptions & Constraints

**Technical**

- Independent repositories on `feat/website-enquiry-emails`; Express owns persistence and delivery. Use existing Node 24.14.1, Bun 1.3.14, Prisma/SQLite and transaction conventions.
- Backend implementation uses BullMQ 6.7.8, ioredis 6.0.0 and Nodemailer 10.6.0. Nodemailer supplies its own TypeScript declarations; no separate Nodemailer types package is installed.
- API writes email intent but never connects to Redis/SMTP for email. Worker and API access the same SQLite file on a supported local filesystem on one host; worker never creates/migrates/seeds a database. Additional worker processes share that boundary. Multi-host database scaling requires a separate verified migration; Redis alone does not provide it.
- Preserve existing inquiry relay, rate limits, validation, receipt replay, lead ownership, staff notifications and optional contact fields.
- Database ledger owns retries; BullMQ `attempts:1`. Terminal and uncertain records do not automatically resend. No exactly-once inbox-delivery promise.

**Product / Business**

- Both property and general agency enquiries are included. Email confirms receipt only, without a response deadline or booking/availability promise.
- Reusable delivery has one concrete kind/template and queue now. Future features supply their own producer/payload/template and tests; do not add unused extension scaffolding.

**Dependencies**

- Authorized reference Redis/SMTP connection credentials are available locally. Copy values only into ignored backend environment configuration during implementation; never print or commit them.
- New application-specific encryption keys and a unique Redis prefix are required. Confirm authorized sender, monitored reply-to, provider quota and production hosting before activation.
- Planned tools remain listed as planned in both TECH_STACK copies until manifests/lockfile and implementation are verified.

---

## 🧩 Proposed Approach

**Chosen architecture:** public enquiry transaction → encrypted email ledger → worker dispatcher → Redis/BullMQ ID-only job → worker consumer → SMTP → ledger outcome. Dispatcher and consumer run in the same independent process. The database survives Redis interruptions and decides what may send.

**Alternatives considered:** synchronous SMTP would make enquiries depend on the provider; enqueueing directly after commit leaves a crash window that loses email intent. Follow the book-store outbox/worker approach, adapting it to Prisma and one enquiry kind. Retain its uncertain-send safety, omit order sequencing and auth token rules.

**Specifications:** [repository-local feature spec](../../../specs/lead-auto-reply/spec.md). Frontend contract snapshot: `docs/contracts/lead-auto-reply.md`. Backend authority: `backend/specs/lead-auto-reply/spec.md` and `contract.md` (workspace paths); the same plan is stored inside each repository so neither checkout depends on sibling source imports.

**Existing files affected:** backend `prisma/schema.prisma`, a generated migration under `prisma/migrations/`, `src/modules/leads/leads.service.ts`, `leads.routes.ts`, `src/app.ts`, `src/config/env.ts`, `scripts/check-database.ts`, `package.json`, `bun.lock`, `.env.example` and operational docs. Frontend existing public form files are compatibility review targets; change product code only if verification finds a contract/copy defect.

**Implemented backend units:** `src/modules/email/email.types.ts` (kind/payload/state), `email.config.ts` (role-specific configuration), `email.crypto.ts` (payload protection), `email.repository.ts` (Prisma claims/state), `email.outbox.ts` (transactional recording), `email.queue.ts` (Redis/BullMQ), `email.dispatcher.ts`, `email.consumer.ts`, `email.sender.ts` (SMTP), `email.templates.ts` (v1 content), `email.worker.ts` (process lifecycle), and `email.operator.ts` (trusted CLI). The immutable encrypted snapshot includes `publicOrigin`, `brand` and `replyTo`; the active SMTP sender remains worker configuration. No generic entity infrastructure, template registry or unused future kind was added.

**Data/API:** add the contract's `EmailNotification` ledger with an optional restrictive lead relation and unique replay-parent ID. The enquiry producer requires a lead; future non-lead producers reuse delivery without speculative subject tables. Stable kind/lead and replay-parent keys provide uniqueness without a deduplication secret; existing public HTTP schemas/responses remain unchanged. No generated HTTP email DTO or new OpenAPI endpoint is necessary. Store the backend-owned contract verbatim in frontend `docs/contracts/lead-auto-reply.md`.

**Review focus:** concurrent/stale claims and replay commands; SMTP cancellation and accepted-send crashes; expired/missing-key backlogs and maintenance; Redis publish/ack races and two-worker throttling; optional-email and receipt-replay compatibility. The tasks below explicitly test each.

---

## 🚀 Execution Plan

1. **Verify the SMTP transport boundary** — _(role: backend)_ — prove cancellation/deadline behavior before implementing the worker. This is a future implementation task, not permission to run a spike during this documentation delivery.

   Files: proposed `tests/email-transport.test.ts`, `src/modules/email/email.sender.ts` as needed, backend manifest/lockfile during implementation.

   - [ ] Resolve current Nodemailer documentation and pin a supported version. Write a captured local SMTP fixture that stalls before DATA, during DATA and after accepting DATA, including two concurrent sends.
   - [ ] Begin with failing tests and prove a supported abort mechanism terminates/observes the underlying send, not only its Promise. Aborting one must not silently abort another. Assert the 30-second deadline, UNCERTAIN outcome when acceptance is ambiguous, ignored late results and bounded shutdown. Implement only the smallest sender boundary needed.
   - [ ] Run `bun run test -- tests/email-transport.test.ts`. If active-send cancellation cannot be proven, revise the sender/deadline design before implementing the worker; do not assume ordinary transporter close cancels an active send.

2. **Durable email intent and configuration** — _(role: backend)_ — deliver encrypted, deduplicated records that can participate in existing business transactions.

   Files: `prisma/schema.prisma`, generated migration, `src/modules/email/email.types.ts`, `email.config.ts`, `email.crypto.ts`, `email.repository.ts`, `email.outbox.ts`, `src/config/env.ts`, `scripts/check-database.ts`, backend manifest/lockfile and `.env.example`. Tests: proposed `tests/email-outbox.test.ts`, `email-config.test.ts`, `email-migration.test.ts`.

   Interfaces: `EnquiryEmailInput` and `recordEnquiryAcknowledgement(tx, input): Promise<string>` as specified by the contract; `EmailSender.send(message): Promise<{messageId?:string}>`; repository operations accept explicit transaction/client, clock and claim token. Persist contract field/state names consistently.

   - [ ] Write real disposable-database tests for atomic rollback, unique kind/lead intent, encrypted payload validation, tamper rejection, key rotation/missing keys and populated migration preservation. Add role-specific config tests: disabled API works without email settings, enabled producer needs keys but no Redis/SMTP, worker needs delivery settings but no unrelated auth/chat secrets. Assert no EMAIL_DEDUPE_KEY is required. Test the ledger permits null lead linkage while the enquiry producer rejects a missing lead; do not invent another kind for this test.
   - [ ] Run `bun run test -- tests/email-outbox.test.ts tests/email-config.test.ts tests/email-migration.test.ts`; confirm missing-feature failures, then implement schema, migration, config, crypto and writer with explicit Prisma fields.
   - [ ] Re-run focused tests and `bun run db:check` on fresh/populated disposable databases. Verify worker database-open precondition without changing normal local data; review the generated migration and eligible producer contract.

3. **Connect new website enquiries to the outbox** — _(role: backend)_ — atomically acknowledge only eligible public creation.

   Files: `src/modules/leads/leads.service.ts`, `leads.routes.ts`, `src/app.ts`; extend `tests/inquiries.test.ts`, `tests/agency-inquiries.test.ts` and proposed `tests/email-enquiry.test.ts`.

   Interface: inject an email producer into lead service composition, defaulting safely to disabled for existing callers. Invoke it only from shared fresh public inquiry persistence with the existing `Transaction`; no Redis/provider dependency enters the request.

   - [ ] Write failing route tests asserting one ledger row for property and general enquiries; replay returns 200 without new work; parallel identical requests do not duplicate; no-email/disabled/manual/imported/edit/assignment flows produce no work.
   - [ ] Add a failure-injection test proving outbox failure rolls back lead, receipt, created activity and staff alerts together. Assert both existing response shapes and staff in-app alerts remain unchanged.
   - [ ] Run focused tests, implement producer wiring and snapshot capture, then rerun `bun run test -- tests/email-enquiry.test.ts tests/inquiries.test.ts tests/agency-inquiries.test.ts`. Confirm no historical backfill when enabling later.

4. **Queue dispatch and independent worker execution** — _(role: backend)_ — recoverable Redis execution with database-controlled retries.

   Files: `email.queue.ts`, `email.dispatcher.ts`, `email.consumer.ts`, `email.worker.ts`, `email.repository.ts`; tests: proposed `tests/email-queue.test.ts`, `email-worker.test.ts`. Add local-only `compose.email.yaml` with a tested pinned Redis image, loopback port binding, AOF volume and noeviction.

   Interfaces: `dispatchDueEmails(): Promise<void>` performs bounded ticks; `consumeEmail(notificationId:string): Promise<void>` claims by token; inject repository, sender and clock. Queue payload is exactly `{notificationId}` and uses UUID `jobId`. Worker uses role-specific config and a separate Prisma client for the same file.

   - [ ] Write failing integration tests with real isolated Redis for two-worker contention, stale dispatch acknowledgements, lost Redis jobs, duplicate and removed terminal jobs, Redis outages, ledger retry delays and malformed jobs. Test lease expiry and SQL conditional updates across separate clients, not only a single in-memory mutex.
   - [ ] Implement 50-row/one-second dispatch, 30-second reconciliation/dispatch leases, 60-second send leases, four SMTP-attempt budget and 60/300/1800-second delays. Keep BullMQ `attempts:1`; move retry jobs to delayed using the worker token and `DelayedError`.
   - [ ] Test and implement worker health/readiness, missing-key pause, expired work, disconnected Redis, paused consumer, no missing-database creation and bounded SIGTERM drain using the verified sender from Task 1. All deadlines and shutdown behavior must match the contract.
   - [ ] Add `runEmailMaintenance(now): Promise<void>` to worker/repository responsibilities: run at startup and before each one-second dispatch tick, at most 100 rows per recovery/expiry/payload-purge/metadata-purge category. Index queries; exclude expired or missing-key rows before the 50-row due limit. Test backlogs larger than both batch sizes, send-lease recovery to UNCERTAIN, seven-/90-day retention boundaries, restart continuation and database failures without starving eligible work.
   - [ ] Configure queue-wide throttling and test combined throughput with two real workers. This queue limiter does not allocate the SMTP account budget across book-store.
   - [ ] Run `bun run test -- tests/email-queue.test.ts tests/email-worker.test.ts` against a unique test prefix. Confirm outage recovery without flushing shared Redis; document compatible client/package and Redis versions.

5. **SMTP acknowledgement, delivery outcomes and operator recovery** — _(role: backend)_ — send safe receipt content and expose redacted operational controls.

   Files: `email.sender.ts`, `email.templates.ts`, `email.consumer.ts`, `email.repository.ts`, `scripts/email-operator.ts`, `package.json`; proposed `tests/email-worker.test.ts` and `tests/email-transport.test.ts` (combined delivery/template/operator assertions).

   Interfaces: sender accepts validated `{to,subject,text,html}` plus trusted sender configuration. Inspection returns allowlisted metadata only. Replay takes original ID, preview/apply mode and duplicate-risk acknowledgement; unique replay-parent/dedupe keys permit at most one child per original attempt. Repeated apply returns that child, including after lost output. Further deliberate replay targets a failed/uncertain child with the same checks. Eligibility and creation are atomic; original expiry is retained.

   - [ ] Test fixed subjects, escaped long/non-Latin names/property titles, text alternative, safe public URLs, no private fields/message echoes, unsupported kind/version and HTML injection. Review rendered narrow/wide email captures.
   - [ ] Test SMTP accepted, explicit 4xx/5xx, auth/envelope error, provable pre-DATA failure, ambiguous DATA timeout, total deadline, and crash after SMTP success before ledger finish. Reuse the verified cancellation boundary from Task 1; implement conservative classification and ignore late results without resending uncertain work.
   - [ ] Test inspection redaction, read-only preview, required acknowledgement, ineligible/expired/purged rows and audited replay linkage. Concurrent apply and retry after lost output must return one child. Implement CLI controls on database uniqueness; reuse Task 4 maintenance rather than adding another scheduler or HTTP management route.
   - [ ] Run `bun run test -- tests/email-worker.test.ts tests/email-transport.test.ts`. Use captured SMTP and no real recipients. Before live activation, document the total provider allowance and reserved per-window/daily real-estate budget with headroom for book-store/other senders, quota-exhaustion owner/alert and provider rejection handling. Use separate credentials/subaccounts if budgets cannot be allocated reliably; do not build cross-project quota infrastructure.

6. **Public compatibility, operations and documentation reconciliation** — _(role: fullstack)_ — verify the complete proposed scope and record its actual delivery status.

   Files: frontend `tests/e2e/property-inquiry-recovery.spec.ts`, `tests/e2e/public-directory-enquiries.spec.ts`, fixture tooling as needed; backend `docs/development.md`, environment examples and worker commands; both feature specs, contract copies, spec indexes, ROADMAP.md and TECH_STACK.md.

   - [ ] Extend disposable integration fixtures with unique Redis prefix, fake/captured SMTP and trusted fixture-side ledger assertions. Keep public responses free of queue metadata and do not add a test-only production email-status route.
   - [ ] Verify property/general submissions, phone-only input, duplicate-click/lost-response recovery, worker downtime and preserved staff notifications on desktop/mobile. Form confirmation remains enquiry receipt, never guaranteed email delivery.
   - [ ] Run backend `bun run check` plus fresh/populated migration and disposable `bun run db:check`. Run frontend `bun run lint`, `bun run format:check`, `bun run typecheck`, `bun run test`, `bun run build`, then focused `bun run test:e2e -- tests/e2e/property-inquiry-recovery.spec.ts tests/e2e/public-directory-enquiries.spec.ts` with fixture backend on 4311. Isolate build/dev processes and use project-identified Next runtime tools with the affected page open.
   - [ ] Document same-file SQLite hosting, producer-off deployment order, worker health checks, provider limits, controlled-recipient smoke and rollback/drain steps. Local credentials remain ignored; actual activation is separate from feature verification.
   - [ ] After implementation and checks settle, delegate final documentation reconciliation to `spec-updater` with exclusive ownership of affected docs; review its diff/gaps. Edit shared documents frontend-first, synchronize backend copies, and check P2-01 only after complete acceptance evidence exists.

---

## ✅ Acceptance Criteria

**Functional**

- [x] Both website enquiry routes create one durable acknowledgement intent when enabled and email exists; excluded triggers and replays do not.
- [x] Separate Redis/BullMQ worker sends the captured receipt and recovers eligible pending work without blocking public capture.
- [x] Shared delivery has an optional restrictive lead relation for later typed non-lead producers; the only implemented producer remains lead-backed.

**Non-functional** (performance, security, accessibility, reliability)

- [x] Bounded dispatch/concurrency/rate limits, encrypted payloads, ID-only jobs, redacted operations and fenced multi-process claims pass.
- [x] In-flight cancellation, SMTP uncertainty, Redis loss, shutdown, scheduled bounded maintenance, expiry and duplicate-job behavior follow the backend-owned contract.
- [x] Concurrent/repeated operator replay creates one child; two-worker rate limiting passes.
- [x] Existing forms, privacy/authorization, in-app alerts and production-disabled behavior retain verified compatibility.
- [ ] Provider account-wide quota allocation, sender/reply-to authorization, live controlled-recipient/inbox checks, production Redis readiness and deployment remain activation gates.

---

## 🧪 Validation Plan

**Manual tests**

- Inspect text/HTML email and worker health/readiness; run controlled outage/restart scenarios in an isolated environment. Confirm actual sender/reply-to and provider limits before an explicitly controlled live-recipient check.

**Automated tests**

- Tasks 1–5 cover transport cancellation, ledger/config/migrations, trigger boundaries, real Redis/worker recovery, maintenance, two-worker throttling, SMTP classification and idempotent replay. Task 6 covers full quality gates and focused cross-repository/browser/runtime evidence.
- Verify exact backend/frontend contract parity and shared document synchronization; no checklist completion from tests that only mock away Redis/database claims.

**Rollback / mitigation**

- Disable new enquiry email production, keep compatible workers to drain; stop workers to pause delivery. Retain additive schema/ledger and original public APIs. Never revert by deleting a shared Redis namespace or existing enquiry data.

---

## ⚠️ Risks & Open Questions

**Risks**

- **Risk:** SMTP acceptance and ledger completion cannot be atomic, and a Promise timeout does not stop SMTP — _Mitigation:_ prove per-attempt cancellation first, UNCERTAIN state, no automatic resend and idempotent reviewed replay.
- **Risk:** Worker/API point to different SQLite files or contend — _Mitigation:_ shared absolute database path, short token-fenced writes and real multi-client tests.
- **Risk:** Shared reference Redis/SMTP settings interfere with book-store — _Mitigation:_ application prefix, separate encryption keys/branding, isolated capture and allocated per-window/daily account budgets.
- **Risk:** Public email field can target an unrelated address — _Mitigation:_ preserve signed ingress/rate limits, fixed acknowledgement-only content, no arbitrary message echo and queue-wide provider throttling.

**Open questions** _(blockers for implementation)_

- No product-scope blockers remain. Sender/reply-to verification, reserved account-wide per-window/daily quota and production Redis/worker hosting block live activation.
- Retry/expiry/concurrency/retention defaults are implemented in the contract. Normal-database migration and deployment remain unperformed.
