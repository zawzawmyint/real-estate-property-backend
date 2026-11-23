# Website enquiry acknowledgement emails

Status: Implemented locally — closeout verified 2026-11-23. Production activation remains gated on SMTP/Redis hosting, sender authorization and account-wide quota allocation.

## Goal

Automatically acknowledge newly accepted website enquiries by email without delaying enquiry capture, using reusable database-backed email delivery through Redis, BullMQ and an independent worker.

## Scope and exclusions

- Include both property-specific and general agency enquiry routes, including Contact, directory and chatbot handoffs that use those routes. Email remains optional; phone-only enquiries continue to work without creating email work.
- One acknowledgement kind, `WEBSITE_ENQUIRY_RECEIVED`, on the shared `transactional-emails` queue. Reusable delivery owns encryption, claims, dispatch, SMTP, retries, recovery and operational inspection; the lead feature owns eligibility and the acknowledgement snapshot.
- Exclude manual and imported leads, updates, assignments, historical backfill, WhatsApp, marketing, viewing emails, auth emails, public registration, provider webhooks and a queue-management UI from this acknowledgement slice. The separately delivered [transactional email feature](../transactional-emails/spec.md) owns other email kinds without broadening this P2-01 contract.
- Adapt the book-store design, not its Drizzle persistence or order/auth workflows. Reference: `C:/Users/ZACK/ZZM/tuts/book-store/backend/src/modules/email/`, its email-notifications spec and README. No cross-repository source imports or runtime dependency on that checkout.

## Behavior and contracts

The [backend-owned contract](contract.md) defines exact persistence, delivery and configuration requirements. The coordinated [implementation plan](../../docs/superpowers/plans/2026-11-19-lead-auto-reply.md) covers both repositories; frontend holds an identical contract snapshot.

### Capture and eligibility

Use the shared `persistPublicInquiry` path in `src/modules/leads/leads.service.ts`. On a fresh accepted enquiry, when enabled and email is supplied, persist the lead, existing created activity, submission receipt, existing staff notifications and encrypted email snapshot in the same SQLite transaction. Roll back all writes if recording the email fails. Do not contact Redis or SMTP in this transaction or public request. Existing receipt replay returns its existing response and creates no new email; enabling later does not backfill replays. A new deliberate enquiry with a new submission ID is independently eligible, subject to the existing inquiry limiter.

Do not infer eligibility solely from `source=website`: imports/manual operations must never call the acknowledgement producer. Existing origin, signed-relay, validation, rate limits and manager notifications remain intact. A database outage is an enquiry failure; a Redis or SMTP outage is not.

### Delivery architecture

The backend-owned `src/modules/email/` module provides typed payloads/templates, outbox writer, repository, dispatcher, consumer, SMTP sender, config, worker entry and operator CLI. It reuses Prisma and the existing transaction boundary; conditional database writes, not in-memory locks, fence separate processes. The shared ledger has an optional restrictive lead relation; this enquiry producer requires it, but a future non-lead producer needs no delivery-schema redesign. No transaction spans Redis or SMTP.

The independent worker runs dispatcher and BullMQ consumer together. Only it connects to Redis/SMTP for email. Database state is authoritative; BullMQ uses `attempts: 1`, notification UUID job IDs and ID-only job payloads. The dispatcher scans bounded due batches and periodically reconciles lost Redis jobs. A consumer must claim the row before sending and cannot resend terminal records even if Redis jobs were removed or duplicated.

Keep `UNCERTAIN` for SMTP outcomes where acceptance cannot be excluded and for expired send leases. Do not automatically resend these. `SUBMITTED` means SMTP accepted responsibility, not delivery to an inbox. Operator replay is a separate audited record with explicit duplicate-risk acknowledgement and at most one child per attempt, enforced atomically by database uniqueness. Repeating a command returns the existing child. A bounded startup/one-second maintenance pass owns lease recovery, expiry and retention, with eligible dispatch filtering preventing expired work from starving the queue.

### Message and privacy

Template v1 contains plain text and HTML: agency identity, escaped visitor name, acknowledgement, optional property title and public property URL, and monitored contact details. State that the team will follow up; promise no response deadline, availability, booking or assigned agent. Never echo the visitor's original message, phone, budget, private property owner information or CRM links. Fix the HTML structure; escape all snapshot text and allow only application-origin public URLs. Use a fixed subject per general/property variant so untrusted content cannot enter headers.

Encrypted payload snapshots prevent later lead edits from silently changing a queued acknowledgement. Keep payloads and SMTP credentials out of logs, Redis and inspection output. Do not expose delivery records publicly or add broad CRM access. Application-specific encryption keys must not be copied from the reference project. Deduplication uses a stable internal kind/lead identifier, without a separate secret.

## Acceptance criteria

- [x] Both public routes create exactly one email record per fresh eligible enquiry and preserve existing success/replay/error contracts.
- [x] No email record is created for phone-only submissions, disabled mode, historical leads, receipt replay, manual/imported leads, edits or assignments.
- [x] Lead, receipt, activity, staff notifications and email creation are atomic; Redis/SMTP outages cannot prevent a committed enquiry.
- [x] Database uniqueness and fenced claims prevent concurrent workers, duplicate jobs and stale dispatch completions from resending or overwriting outcomes.
- [x] Retry budgets, expiry, Redis reconciliation, crash recovery and uncertain-send handling match the contract under isolated Redis integration tests.
- [x] Text/HTML templates, public links, encryption/key rotation, redaction, retention and operator controls pass privacy checks; concurrent/repeated replay creates one child, including after lost command output.
- [x] Nodemailer 10.6.0 active-send cancellation is covered against a stalled test server; deadline/late-result handling cannot create another send or change a terminal state.
- [x] Maintenance/due filtering works past a 100-row batch; two-worker queue-wide limits are covered. Provider/account quota allocation remains an activation gate, not a test result.
- [x] Worker config, health/readiness, bounded shutdown, paused-consumer behavior and existing-database startup are covered.
- [x] Fresh/populated migrations, backend quality gates, frontend contract parity and disposable public-to-worker checks passed.
- [x] Both roadmap copies record locally verified P2-01 completion; normal-database migration, deployment and provider validation remain separate.

## Validation

Use isolated SQLite and a dedicated real Redis prefix with captured/fake SMTP. Exercise both HTTP routes, rollback on outbox failure, replay races, no-email and excluded producers, source labels, Redis unavailability/loss, two consumers, terminal-job replay, delayed retry and expired send claims. Include a post-SMTP-acceptance/pre-database-update crash as `UNCERTAIN`, not automatic retry. Test explicit SMTP 4xx/5xx, connection failures, ambiguous DATA timeouts, malformed jobs and unknown template versions. Tests must never use real customer addresses or flush a shared Redis instance.

Run `bun run check` and disposable `bun run db:check`; verify fresh/populated migrations preserve current data and startup with email disabled. Frontend runs its required gates and focused property/general enquiry recovery browser checks against disposable services. Test required lead validation in the enquiry producer while permitting a null lead relation in the shared ledger. Test concurrent/repeated operator replay, bounded expiry/retention passes beyond 100 rows, worker restart and two-worker queue-wide rate limiting. Prove transport cancellation with two concurrent captured sends so aborting one cannot silently terminate the other. A live SMTP check is a separate operation using an explicit controlled test recipient; document SMTP acceptance independently from inbox observation.

## Risks and rollout

Deploy the implemented additive migration with production disabled, then compatible API and worker, verify worker readiness and a controlled-recipient smoke, and only then enable new-enquiry production. Existing staff credentials and resource authorization are unchanged. SQLite requires the API and worker to access the same database file on the same host and a SQLite-supported local filesystem; do not assume independent container files are shared. Worker startup does not seed, create a missing database or migrate it. Multiple worker processes share this host/database constraint; Redis does not make SQLite horizontally scalable across independent hosts. A later database migration requires its own verified design.

Disable production of new records to roll back while draining compatible work; stop the worker as well to pause sending. Do not delete the ledger or drain another application's Redis prefix. Reuse authorized reference Redis/SMTP credentials only in ignored local environment configuration during implementation; use a unique queue prefix and real-estate sender display name, and verify the authorized sender/reply-to before live activation. Live activation is outside this local implementation delivery.

Open operational gates: monitored reply-to address, authorized sender/domain, actual provider limits and reserved account-wide quotas across book-store/other senders, and production Redis/worker hosting must be confirmed before activation. The local Redis integration used an isolated instance; the reference Redis service was unavailable after interruption. No live SMTP email, normal-database migration, deployment or provider-quota validation is claimed.

## Implementation evidence

Verified on 2026-11-20: backend `bun run check` passed lint, stock formatting, typecheck, 332 tests in 72 files and production build. Frontend API parity, lint, typecheck and 440 tests in 62 files passed; its production build also passed with no frontend product-code change. The final isolated Edge run passed 23 desktop/mobile cases with five configured skips, including all four new captured-email cases. Focused email tests passed 22 cases; fresh migration/rerun/database checks and compiled standalone worker/readiness/inspect smoke passed. The isolated enquiry page was inspected with an active browser session and no reported runtime/configuration errors; 390px/800px email captures were reviewed. No live SMTP/inbox observation, normal-database migration or deployment is claimed.

Closeout verification on 2026-11-23 passed the post-fix backend gate with lint, formatting, typecheck, 350 tests in 76 files and production build. Fresh disposable migration, rerun and database checks passed. The frontend gate passed API parity, lint, formatting, typecheck, 440 tests in 62 files and production build; one clean captured-SMTP Edge run passed 18 selected desktop/mobile enquiry, assignment, viewing and task cases. No live SMTP/inbox observation, normal-database migration, activation or deployment is claimed.

Original delivery logs are retained locally under backend `.delivery-work/lead-auto-reply/`. November 23 closeout logs are under `.delivery-work/email-closeout/` in each repository. Generated logs and captures are ignored, not source artifacts.
