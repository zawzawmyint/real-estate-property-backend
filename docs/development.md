# Development

## Setup and configuration

Follow README installation steps from the backend working directory. `.env.example` documents every supported variable. Copy it to `.env`, replace `BETTER_AUTH_SECRET` and `INQUIRY_RELAY_SECRET` with independently generated random values of at least 32 characters each, then run `bun run db:generate`, `bun run db:migrate` and `bun run db:check`. Runtime scripts use Node's environment-file loader.

- `NODE_ENV`: development, test or production.
- `HOST`: defaults to loopback `127.0.0.1`; set appropriately for a container deployment.
- `PORT`: integer 1–65535, default 4311.
- `LOG_LEVEL`: Pino level or silent.
- `DATABASE_URL`: SQLite `file:` URL; relative paths resolve from backend working directory.
- `STORAGE_ROOT`: disk directory, default `./var/uploads`.
- `PUBLIC_ORIGIN`: absolute HTTP(S) backend origin, default `http://localhost:4311`, no path or credentials. This controls public image URLs, not API authorization.
- `APP_ORIGIN`: exact frontend origin permitted to make native auth POST requests; default `http://localhost:3100`.
- `BETTER_AUTH_URL`: exact public auth base URL, `${APP_ORIGIN}/api/v1/auth`.
- `BETTER_AUTH_SECRET`: server-only random secret, at least 32 characters; never commit it.
- `INQUIRY_RELAY_SECRET`: server-only random secret, at least 32 characters and independent of the auth secret. It must exactly match the trusted frontend relay configuration; never commit it.
- `PUBLIC_CHAT_ENABLED`: defaults to `false`. Enable only for the approved demo after the frontend has also set its own server-side flag to `true`.
- `OPENROUTER_API_KEY`: server-only provider key for the public chatbot. Never expose it to the browser or commit it.
- `OPENROUTER_CHAT_MODEL`: defaults to `nvidia/nemotron-3.5-lightning:free`.
- `OPENROUTER_EMBEDDING_MODEL`: defaults to `nvidia/nemotron-3-embed-1b:free`. Rebuild the FAQ index before changing it.
- `PUBLIC_CHAT_INDEX_PATH`: absolute-or-relative JSON index path, defaulting to `./var/public-chat/faq-index.json`.
- `PUBLIC_CHAT_UPSTREAM_CALLS_PER_DAY`: provider-call limit per application instance in a rolling 24-hour period, defaulting to 45.
- In production, public inquiry identity is accepted only from a complete valid signed relay. Missing, partial, malformed or invalid relay headers return the safe 403 response before limiter consumption or persistence. Outside production, absence of both headers uses the hashed socket fallback; supplied invalid headers never fall back. The backend does not trust arbitrary `X-Forwarded-For` values.

Redis, BullMQ and Nodemailer support the disabled-by-default website-enquiry email worker; see [Website enquiry email worker](#website-enquiry-email-worker). S3 integration is not installed. The inquiry limiter is in-process: five attempts per identity in 15 minutes, capped at 10,000 live identities; restart resets it and a multi-instance deployment requires a shared limiter decision. Staff auth, property/photo and lead models are implemented. Environment validation names invalid fields without printing input values.

## Public chatbot demo operations

Keep `PUBLIC_CHAT_ENABLED=false` in both repositories until the demo is intentionally enabled. Add an `OPENROUTER_API_KEY`, verify the selected models are available, then run `bun run chat:index` from `backend/` whenever approved FAQ content, embedding model or embedding configuration changes. The command writes the JSON index atomically. Restart Express after a successful index because it reads and validates the index at startup. The public route applies trusted-ingress identity and permits five requests per client per minute. The provider budget is 45 calls per rolling day per process instance, so multi-instance deployments need an explicit shared-budget decision.

The FAQ catalog can only expose the public `/contact` and `/properties` source routes. OpenRouter receives bounded questions and relevant public FAQ passages. Use synthetic prompts in demo verification and direct visitors to the inquiry form for personal details. For the opt-in browser fixture, set `STAFF_E2E_PUBLIC_CHAT=1`. This flag configures the disposable test backend. Before real-business publication, approve FAQ text and visitor-data wording, provision trusted ingress, and decide provider availability, quota and multi-instance operations.

## Database maintenance and browser fixtures

For an existing database, migrations require a maintenance window: stop the backend and all operator writes, back up SQLite (including any WAL files) and its matching media, then deploy the updated source and run `bun run db:generate`, `bun run db:migrate`, and `bun run db:check` before restarting. The migration command also backfills NFC/lowercase property, lead and staff search fields plus recognizable `Lead.phoneCanonical` values in bounded batches without changing business timestamps; running `prisma migrate deploy` alone does not complete these data migrations. Keep writes stopped until the updated application starts. The backfills are idempotent, so a failed run can be retried while offline. Startup independently verifies canonical phone backfill and exits before serving writes if verification fails. Restore the compatible database/media/application backup together if rolling back. This is a single-process offline migration, not a rolling-deployment procedure.

The CRM notifications migration is additive: it creates the persistent notification inbox and does not backfill historic workflow events. Apply it through the same `db:generate`, `db:migrate`, `db:check` sequence before deploying the matching frontend bell. On startup, the application wires the active signal adapter and begins the reminder scan; graceful shutdown stops scans and closes notification streams. The current adapter is process-local, so do not run multiple API instances for shared live delivery until a shared transport is configured.

The disposable browser fixture includes fictional featured demo listings by default so public photo tests do not depend on other tests. Set `STAFF_E2E_SEED_PROPERTIES=0` only for targeted suites that do not require public property media. Ordinary application startup never seeds data.

## CRM CSV export use

Authenticated CRM staff can use **Export CSV** on the Leads and Properties inventories. The export contains all authorized rows matching the applied filters and sort, not only the visible page. It is a report rather than an import template or complete CRM backup: it omits descriptions, photos, notes, activities and other excluded data; Agent property files omit owner contact columns.

Exports are limited to 5,000 rows and 10 MiB. On `EXPORT_LIMIT_EXCEEDED`, narrow the filters and try again; do not expect a partial file. A successful browser message means the download was started, not that it was saved to a particular disk location. CSV has no reliable cell-type guarantee: when opening an export with international or leading-zero phone numbers, choose the spreadsheet application's text-column import option to preserve the displayed digits. The exact routes, query rules, columns and error contract are in the [CSV export contract](../specs/csv-import-export/contract.md).

## CRM CSV import use

After applying the receipt migration with `bun run db:migrate`, an Admin or Manager can open **Properties → Import CSV**, download the header-only template, select one UTF-8 CSV (up to 1 MiB and 500 data rows), preview it, and explicitly commit the resulting drafts. Every row must be valid: confirmation is all-or-nothing, creates new draft properties only, and does not update existing records, publish properties, attach photos, or match duplicates. Exported reports are not templates.

Use plain decimal values for price and area, and use the spreadsheet application's text-column import option for phone values so leading zeroes are retained. Preview and commit require the same file/version. If a request outcome is uncertain, use **Retry confirmation** on the current page. After a reload, reselect the same file and preview again to recover the saved retry identity. If the browser warns that reload recovery is unavailable, keep the page open for safe retries. Do not start a fresh batch without acknowledging its duplicate risk. A changed staff session requires reloading before importing. The receipt records retry metadata and created IDs, never the raw CSV or owner-contact values.

For rollback, disable the import UI/routes but retain created business records and receipts; do not remove either as an automatic rollback. The exact endpoints, limits, error responses and retry contract are in the [property import contract](../specs/property-import/contract.md).

## Lead CSV import use

After applying the lead receipt and phone-canonical migration with `bun run db:migrate`, an Admin or Manager can open **Leads → Import CSV**, download the header-only template, select one UTF-8 CSV (up to 1 MiB and 500 data rows), preview it, and explicitly commit New/unassigned/unlinked leads. Use the six-column template `name,phone,email,purpose,budget_aed,source`: name, purpose, source and at least one valid phone or email are required; sources are `call` or `walk_in`. A supplied phone must be a valid UAE number beginning with `0` or explicit international `+`/`00` number; phone fields should be imported as spreadsheet text to preserve leading zeroes. Every row must be valid; confirmation is all-or-nothing and creates one actor-attributed creation activity per lead. It does not update or deduplicate existing leads, assign agents, link properties, create notifications, or accept website as an import source.

Preview now uses schema version 2 and reports scoped existing-phone matches and within-file repeats. When warnings exist, review them and explicitly acknowledge before commit; acknowledgement allows every valid row to be created as a separate lead. It never merges, skips, updates or makes phone unique. Preview and commit require the same file/version. For an uncertain outcome, use **Retry confirmation** with the same file. After a reload, reselect the exact file: pending version-2 work re-previews it, while pending version-1 recovery first retries its stored original identity and file digest. Do not replace an uncertain identity with a fresh batch. Changed staff sessions require a reload. Receipts retain retry metadata and created IDs, never raw CSV/contact values. The migration is additive: for an existing database, stop writes, make a consistent database/media backup, deploy matching frontend/backend source, then run `bun run db:generate`, `bun run db:migrate`, `bun run db:check`, and verify clean startup before restarting operator writes. Rollback disables matching UI/routes but retains leads, activities, receipts and the nullable non-unique index; assess newer writes before restoring a backup. See the [lead import contract](../specs/lead-import/contract.md) and [duplicate-detection contract](../specs/lead-duplicate-detection/contract.md) for exact endpoints, recovery and errors.

## Lead temperature rollout

The additive lead-temperature migration follows the same maintenance sequence. It supplies `unassessed` for existing and new leads and adds nullable transition fields to activity history. Deploy matching frontend/backend source together so staff consumers understand the additive lead/activity fields and temperature route. Repository validation never migrates a normal database or deploys the feature; use the backup and offline procedure above.

## Feature development

1. Create `specs/<feature-name>/spec.md` before code changes.
2. Agree observable behavior, data exposure, permissions, errors and exclusions.
3. Implement a small working slice under `src/modules/<feature>/`: routes attach middleware, controllers handle HTTP, services enforce business/resource permissions and coordinate transactions, and repositories contain Prisma queries. Pass transaction clients explicitly when required. Keep Better Auth native and do not create empty business modules to demonstrate the convention.
4. Add meaningful boundary tests and update the OpenAPI contract.
5. Verify acceptance criteria and reconcile documentation before marking implemented.

## Verification

Run `bun run check`, then `bun run db:generate`, `bun run db:migrate` and `bun run db:check` against the intended SQLite URL. CI performs a frozen install followed by code checks on Node 24.14.1. Tests use real Express requests and disposable filesystem directories/databases. Avoid reusing production files in tests. Check SQLite and storage remain ignored with `git status`.

Raw HTTP auth body-limit tests use non-pooled connections for ordinary requests and own their cleanup: handle response and JSON-parse failures, then deterministically destroy the request and server connections they created. The intentional exception is an owned keep-alive agent for the unfinished chunked-upload regression; it verifies that an oversized request receives the existing 413 response before upload termination, then destroys that agent. This is test reliability coverage only; retain the 100 KiB limit, native response headers, exact-boundary assertions and five-second timeout, and do not change production authentication configuration or API behavior.

For the frontend browser suite, do not start a manually provisioned database on port 4311. Run `bun run db:generate`, set a temporary 12–128 character `STAFF_E2E_PASSWORD` with PowerShell `Read-Host -MaskInput`, then start `bun run test:auth:e2e-server`. The fixture creates a disposable SQLite database, applies migrations and provisions Admin, Manager, Agent, a dedicated transition-test Agent, and separate desktop/mobile navigation Manager accounts; Ctrl+C removes it. Set the same temporary password and `API_URL=http://127.0.0.1:4311` in the frontend test terminal before `bun run test:e2e`. The frontend runs this suite with four workers. Do not use a production password or database for this suite.

Dashboard acceptance uses a separate disposable fixture so its exact ten-lead agency population cannot be changed by legacy tests. Set `STAFF_E2E_DASHBOARD_ONLY=1` together with the temporary `STAFF_E2E_PASSWORD` before starting `bun run test:auth:e2e-server`; in the frontend terminal set both variables and run `bun run test:e2e -- tests/e2e/dashboard.spec.ts --workers=1`. The dashboard suite is skipped without this flag, and the normal legacy suite must run without it.

Agent-performance browser coverage uses the normal disposable fixture with `STAFF_E2E_AGENT_PERFORMANCE=1` and the existing `STAFF_E2E_STATE_FILE` state path. It seeds only synthetic report identities and historical activity; use a separate backend/proxy/SQLite state for each full desktop or mobile project. The dashboard-only fixture excludes the report seed, so retain `STAFF_E2E_DASHBOARD_ONLY=1` for its dedicated exact-data run. These flags are test-fixture controls, never application configuration.

The test-only `E2E_BACKEND_PORT` selects the proxy's strict `127.0.0.1` upstream and defaults to `4311`. For an alternate port such as `14311`, set `E2E_BACKEND_PORT=14311` and `PORT=14311` before starting this backend fixture, then set `E2E_BACKEND_PORT=14311` in the frontend test terminal. The fixture derives its test `PUBLIC_ORIGIN`, including media URLs, from that port. This is fixture/proxy configuration only; it does not change production environment configuration.

For manual checks, start the migrated backend on 4311 and sibling frontend on 3100, bootstrap an Admin using `bun run staff -- bootstrap-admin`, then sign in at `/login` and confirm `/crm` protection. `bun run staff -- deactivate` reports assigned-lead count; redistribute through the lead workflow before or after deactivation as appropriate. Build before `bun run start`; clean builds generate the ignored Prisma client automatically. Use a coordinated HTTPS deployment to validate production `__Host-` cookie behavior; local HTTP uses the development cookie name.

## Demo data

After applying migrations to a local or demo database, run `bun run demo:seed -- --confirm-demo`. The command refuses `NODE_ENV=production`, refuses missing or unknown arguments before connecting, adds only missing deterministic demo records, and never resets or overwrites existing records. It creates 15 fictional published listings from the versioned fixture library in `fixtures/demo-properties/photos`; all stored runtime copies receive generated keys. The fixture [README](../fixtures/demo-properties/README.md) records image provenance and reuse. Demo records and images are illustrative and must remain visibly labelled in the frontend.

## Public agency catalog and portraits

The public Contact/Agents catalog is authored in [`src/modules/agency/agency.catalog.ts`](../src/modules/agency/agency.catalog.ts), not in a live CMS or Better Auth. Edit only approved public fields and each profile's `published` flag; the catalog has no automatic synchronization with staff accounts. Direct phone, email, address and map values stay `null`, and office hours stay an empty array, until approved for public use. The shipped catalog is fictional demo content (`isDemo: true`), so the public pages remain noindex.

Deploy catalog changes together with matching frontend portraits at `frontend/public/images/agents/`. Every referenced portrait must be a local 800×1000 WebP file, and its provenance must be recorded in the frontend directory's `README.md`. Coordinate the two repository deployments so a published catalog path never points to a missing asset. Before real-business publication, obtain approved agency contact details, profile/portrait approval and inquiry usage wording, set the relevant demo flags correctly, and verify the catalog/asset pair. See the [public contact and agent feature specification](../specs/public-contact-and-agents/spec.md) and [contract](../specs/public-contact-and-agents/contract.md).

## Media reconciliation

Use this procedure only in a maintenance window after a property cleanup log reports a `storageKey` and `requestId`. It handles a successful database commit followed by a failed physical deletion. Do not delete a file while the database outcome is uncertain.

1. Stop writes, then back up the matching SQLite database and the complete `STORAGE_ROOT` directory together. Work only on copies until the final removal step.
2. Inventory database references against the same database copy. From `backend/`, use the existing Prisma factory in a read-only one-off `tsx` session or an approved SQL client to list keys: `SELECT storageKey FROM PropertyPhoto ORDER BY storageKey;`. Save this reference list with the request IDs and timestamps from the cleanup failures.
3. Enumerate only regular files directly under the copied `STORAGE_ROOT`; do not traverse symlinks or directories. Compare their literal filenames with the reference list. The dry-run orphan set is files present on disk but absent from `PropertyPhoto.storageKey`.
4. Preserve every referenced file and every unexpected entry (including directories, symbolic links, malformed names and files that cannot be inspected). Record those entries for review. Do not infer that an unexpected entry is safe to remove.
5. For each logged key, query `PropertyPhoto` again immediately before retrying. If it is referenced, retain it: a failed attachment may have committed and an unknown database outcome must keep media. If it is absent and appears in the dry-run orphan set, remove that exact literal path from the copied/in-service storage only after the operator confirms the matched backup is restorable. Database deletion always precedes physical cleanup.
6. Re-enumerate the copied storage and reference list after removal. Keep an operator log of each retained/removed key, request ID, timestamps, database query outcome and filesystem error. Escalate unresolved keys rather than broadening a deletion glob.

## Website enquiry email worker

This worker now serves shared transactional email delivery through the `transactional-emails` queue. See [transactional email operations](#transactional-email-operations) for group switches and migration from the old queue name. Existing acknowledgement v1 records remain compatible.

P2-01 is implemented but disabled by default. After an additive migration, configure the backend-only email variables in ignored `.env`; the API needs only the enabled producer configuration, while the separate worker also needs Redis and SMTP configuration. Start it with `bun run email:worker` during development or `bun run email:worker:start` after `bun run build`. API and worker must use the same existing SQLite database file on one supported host; worker startup never creates or migrates it. Health endpoints bind to loopback: `GET /health` reports process liveness and `GET /ready` requires payload keys, Redis, an unpaused consumer and a successful dispatch tick within 30 seconds.

Configure the full key list in [.env.example](../.env.example): a project-specific `EMAIL_QUEUE_PREFIX`, AES key map/active key ID, approved `SMTP_FROM` address and monitored `SMTP_REPLY_TO`, plus Redis/SMTP connection settings. Keep old encryption keys while records still need them; there is no separate deduplication secret. Nodemailer supplies its own TypeScript declarations. Redis needs persistence and `noeviction`; production requires authenticated verified TLS. The queue-wide `EMAIL_RATE_LIMIT_MAX`/duration budget is shared across workers of this queue, not across other applications. Allocate account-wide per-window/daily headroom before enabling; the reference credentials are copied locally, but current reference Redis availability is not verified.

Backend `bun run check` includes real Redis integration tests. Start a disposable Redis service (the local compose file is `compose.email.yaml`) or set `EMAIL_TEST_REDIS_URL` to an isolated endpoint; tests otherwise use the ignored local `REDIS_URL`, then loopback port 6379. They use random prefixes and delete only those test keys, never flush Redis, and use captured/fake SMTP without provider credentials. CI supplies its own Redis service. Override `EMAIL_WORKER_HEALTH_PORT` if the default 4312 conflicts with a local fixture proxy.

Use `bun run email:inspect -- --id <uuid>` for redacted metadata. `bun run email:replay -- --id <uuid>` is read-only; applying a replay requires both `--apply` and `--acknowledge-duplicate-risk`. Disable `EMAIL_ENQUIRY_NOTIFICATIONS_ENABLED` to stop creating new records; keep a compatible worker running to drain, or stop it to pause delivery. Never flush a shared Redis namespace or delete ledger rows to roll back.

Before live activation, verify an authorized sender and monitored reply-to, provider limits and a conservative account-wide quota allocation, production Redis/worker hosting, and a controlled-recipient SMTP/inbox check. These are not completed by the local test suite. No live SMTP email, normal-database migration or deployment is recorded. For fixture browser runs, `STAFF_E2E_EMAIL=1` and an absolute `STAFF_E2E_EMAIL_CAPTURE_FILE` opt the disposable auth E2E server into local captured SMTP; it never uses live SMTP. Set `EMAIL_TEST_REDIS_URL` for an isolated Redis service. `E2E_APP_ORIGIN` and `E2E_BACKEND_PORT` may select isolated alternate origins/ports; they are test controls, not production configuration. The new frontend `tests/e2e/enquiry-emails.spec.ts` runs only with that capture fixture.

## Operation

### Transactional email operations

The API records encrypted intent in the business transaction; only the separate email worker connects to Redis/SMTP. Shared delivery owns schemas, templates, encryption, scheduling, retries and recovery. Producers in `leads.emails.ts`, `viewings.emails.ts` and `tasks.emails.ts` own eligibility and deduplication; no browser connection is required.

`GET /ready` is intentionally stricter than `/health`: a failed queue publication makes readiness unavailable even if Redis connections are up. Idle or skipped passes cannot clear that publication failure; a successful publication can. If publication succeeds but its ledger acknowledgement is lost, that pass is unhealthy without forgetting publication success. A later healthy pass, including retained-job reconciliation or an idle pass, can restore readiness. On shutdown the worker stops new ticks and waits for the actual in-flight maintenance/dispatch pass within its drain budget before closing queue, Redis and SMTP dependencies.

Configure identical group settings on API and worker:

- `EMAIL_ENQUIRY_NOTIFICATIONS_ENABLED`: produces website enquiry acknowledgements. Switching it off stops new acknowledgements; existing v1 records still drain as before.
- `EMAIL_STAFF_NOTIFICATIONS_ENABLED`: produces assignment/reassignment, staff enquiry alerts, viewing reschedule/cancellation and task due-soon emails. Default false.
- `EMAIL_CUSTOMER_VIEWING_NOTIFICATIONS_ENABLED`: produces viewing confirmation, reschedule, cancellation and one reminder. Default false. Also requires `EMAIL_CUSTOMER_VIEWING_ACTIVATED_AT`, a fixed UTC ISO timestamp for the rollout, retained across restarts.

New group switches are checked again by the worker. Disabling a group suppresses its pending work, including future reminders; re-enabling does not replay suppressed records. Customer reminders are recorded at booking/reschedule with a due time 24 hours before the viewing. Short-notice schedules receive confirmation/change only. No historical backfill is performed; pre-cutoff viewings never gain reminders. Task email production is an independent bounded startup/60-second scan, alongside the existing inbox scan, with database uniqueness and cursor progression.

Before sending, live recipient, staff role/assignment, schedule and lifecycle checks can terminally mark a record `SUPPRESSED` without an SMTP attempt. Real viewing changes suppress obsolete pending work. Customer contact changes never retarget an existing encrypted snapshot. Database claims end before SMTP; a business change after the claim can still race with sending. `UNCERTAIN` outcomes are never retried automatically. Operator replay retains context and rechecks expiry/eligibility; suppressed records cannot be replayed.

The queue name change from `enquiry-emails` requires a maintenance window:

1. Pause business writes and reminder scans; gracefully stop all old API/worker processes. Preserve the existing queue prefix and encryption keys during this transition.
2. Back up SQLite, apply the additive migration through `bun run db:migrate`, and run `bun run db:check`. Deploy matching multi-kind API/worker binaries with new groups disabled. Worker startup checks the new ledger columns; it never migrates automatically.
3. Wait at least `EMAIL_RATE_LIMIT_DURATION_MS` since the last old send and confirm account-wide provider headroom. The new Redis queue has no old limiter history.
4. Start the compatible worker: its dispatcher reconciles eligible nonterminal ledger IDs into `transactional-emails`, including IDs previously published only to the old queue. Future-due reminders remain in the ledger until due. Let existing send leases recover through normal maintenance; never reset terminal/uncertain states.
5. Verify `/ready`, ledger outcomes and controlled-recipient delivery before resuming writes and enabling each new group. Retain old Redis jobs until ledger reconciliation is verified; never flush Redis.

For rollback, disable the new groups and keep the additive schema plus a compatible multi-kind worker. An enquiry-only old binary cannot consume the new kinds. Any queue reversal also needs stopped workers, ledger reconciliation and limiter cooldown. Shared concurrency/rate settings cover all kinds; monitor backlog age and reminder lateness before changing provider allocation or adding queues.

For captured browser verification, `STAFF_E2E_TRANSACTIONAL_EMAILS=1` enables both new groups in the disposable auth fixture and starts its captured-SMTP worker. Supply `STAFF_E2E_EMAIL_CAPTURE_FILE` and isolated `EMAIL_TEST_REDIS_URL`; it never contacts live SMTP. The fixture omits production periodic task scanning, which is covered by backend scan tests.

The server logs safe startup failure codes, returns generic unexpected error responses and stops accepting requests on SIGINT/SIGTERM with a 10-second connection shutdown window. Windows process termination may not deliver Unix signals; exercise deployment shutdown on its actual process manager.

The authenticated notification stream is `GET /api/v1/staff/notifications/stream`. It emits payload-free `notifications.changed` events, with a 15-second authorization heartbeat; clients reload the inbox after a change or reconnect. Its response explicitly sets `Cache-Control: no-store, no-transform` to prevent the current Next rewrite from buffering the stream, and `X-Accel-Buffering: no` for compatible reverse proxies. Verify the production ingress forwards the stream promptly before release. Redis Pub/Sub is not configured. The separately implemented transactional-email worker remains disabled by default; follow the email activation and queue-transition procedures above before enabling it.

Use persistent storage and database backups before deployment. There is no deployment automation yet. Remove disposable development data only when intentionally resetting local work; database files and public assets are not source code or reproducible migrations.

## Pull request branch naming

For pull requests into main, use one of these prefixes followed by lowercase alphanumeric words separated by single hyphens: feat/, fix/, refactor/, docs/, test/, chore/ or ci/. Examples: feat/property-favorites, fix/contact-validation and ci/frontend-checks. Names such as feature/example, feat/Uppercase, fix/under_score or feat/a/b fail.

The [Branch naming workflow](../.github/workflows/branch-name.yml) reports a **Branch name** check when a PR is opened, synchronized, reopened or edited. It validates the source branch without checking out PR code or installing dependencies. This is a merge gate when required; it does not prevent creating or pushing a branch. Existing feature/... branches and automation branches have no exemption and must follow the same policy before merging.

After publishing the workflow, open a PR into main and let the check run. In Settings → Rules → Rulesets → Protect main, enable required status checks and add **Branch name** from GitHub Actions alongside the existing **verify** CI check. Save the ruleset with Active enforcement. Repository settings are a manual step and have not been activated by this local delivery. If rolling back, remove Branch name from required checks before removing the workflow. See the [branch naming specification](../specs/branch-naming/spec.md).
