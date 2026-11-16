# Lead CSV import

Status: Verified delivery — 2026-11-13.

## Goal

Create new leads from reviewed CSV batches, rejecting the whole batch if any row is invalid. The user chose New/unassigned leads without property links. Reuse the property importer's shared CSV mechanics while keeping lead validation, creation history and persistence in the leads module.

## Scope and exclusions

- Included: Admin/Manager template/preview/commit; strict bounded CSV parsing; lead contact/budget validation; atomic lead/activity/receipt creation; durable actor/content-bound replay.
- Columns: `name,phone,email,purpose,budget_aed,source`. Required name/purpose/source; at least one contact. Existing manual sources `call`/`walk_in`; no inferred source or new source value.
- Forced defaults: stage `new`, version 1, no assignee/property/snapshots/original message; `createdById` is the live importing actor. Each row gets an existing `created` activity with current actor ID/name, without an assignment transition.
- Excluded: Agent bulk import, updates, duplicate detection, assignment/property/history columns, website-source backfills, notes, notifications/auto-replies, new infrastructure or dependencies. Existing manual lead, public inquiry, assignment, notification and property-import contracts remain compatible.

## Behavior and contracts

The backend owns [contract.md](contract.md). Add `/imports/template`, `/imports/preview` and `/imports/commit` before dynamic lead routes. Named Admin/Manager authorization must run before consuming POST bodies; trusted Origin, JSON type and import-only UTF-8/body guards follow. Services independently check fresh staff, including replay.

Reuse `src/shared/csv/parse-import.ts` and installed `csv-parse`/`csv-stringify`. Extract the existing neutral property import HTTP parser/charset guards into `src/shared/csv/import-middleware.ts`, used by both features, without changing other route limits. Keep property/lead validators, controllers and transaction coordinators separate.

Reuse the existing lead name/contact/purpose/source/budget validation and `leadSearch` mapping without weakening single-lead schemas or repeatedly invoking the public create service in independent transactions. Contact absence is a row error. Reject structural/header/encoding errors, limits and any invalid record; never skip a row. Exact decimal AED-to-fils conversion must precede the existing BigInt persistence mapping, preserving phone text/leading zeroes and existing email normalization.

Preview creates no records of any kind. Commit revalidates the CSV/version/digest rather than trusting browser rows. For a new batch, validate every row before inserts, acquire SQLite's write reservation as the first transaction write, then validate the live actor and batch receipt. Create all leads, normalized search fields, one `created` activity per lead and the receipt in one `serializedTransaction`. Any failure rolls back the entire batch. No assignment or website-inquiry notifications are generated.

Propose a lead-owned `LeadImportReceipt` with UUID primary key, actor ID, content digest, schema version, created count, serialized lead IDs and creation time. It stores no raw CSV/contact fields. Existing `LeadSubmissionReceipt` describes single-lead mutations and is not repurposed into an aggregate result or populated once per import row. Same actor/ID/exact content/version replays original IDs/count without new activities or changes to existing leads; another actor/content receives a generic conflict. Use an additive migration and include the table in database verification.

The shared limits are 1,048,576 CSV bytes, 500 data records, 65,536 raw UTF-8 bytes per record including quoting/terminating line ending, 6 MiB JSON transport, 20 preview records and 100 displayed issues with accurate totals. File/raw-record guards run before CSV materialization; the row cap runs before business mapping/persistence. Keep the current 15-second transaction timeout and four-worker test configuration.

## Acceptance criteria

Replay validation clarification (2026-11-13): validate the incoming CSV before returning an existing receipt. Reject invalid lone-surrogate input even when its replacement UTF-8 bytes hash identically to valid U+FFFD content; keep live authorization/conflict precedence and valid same-ID replay intact.

- [x] Only current Admin/Manager sessions can template/preview/commit/replay; Agent, revoked, expired, banned/disabled, credential-invalid and demoted identities fail before writes.
- [x] Strict headers/UTF-8/byte/row limits and lead contact/source/budget rules produce bounded deterministic diagnostics with zero preview writes.
- [x] Valid imports create exactly N correctly normalized New/unassigned leads, one creation activity each and one batch receipt, with no links, notifications or existing-record changes.
- [x] Invalid final rows and injected mid-lead, activity or receipt failures roll back all batch data.
- [x] Same-ID concurrent calls/retries return one batch; actor/content conflicts are private and replays preserve subsequent edits/assignments.
- [x] The maximum supported batch completes within the existing transaction budget, including history writes.
- [x] Fresh/populated migrations and disposable `db:check`, full backend checks, OpenAPI parity and cross-repository acceptance pass.

## Validation

Tests first: parser/header/lead mapping and contacts, exact money/BigInt/search behavior, counts/diagnostics, HTTP media/charset/body ordering, permission freshness, no-write preview, invalid final row, concurrent replay, conflicting actor/content, rollback at each persistence stage and no notification side effects. Use disposable real SQLite databases for migration, transaction and 500-row measurement. Run `bun run check` and migrated disposable `bun run db:check`; do not mutate a user's normal database for acceptance tests.

## Risks and rollout

Migration precedes use or deployment; no configuration/package changes are expected. Reusing syntax/UI does not make property draft rules apply to leads. Duplicate matching stays P2-05; fresh IDs and identical rows create new leads. The 500-row measurement completed in 294 ms within the existing 15-second budget. Rollback disables import routes/UI and retains receipts/business records. P2-04 is verified across both entities' complete import/export acceptance.

## Implementation evidence

Full backend check passed: 53 files / 263 tests, lint, formatting, Prisma generation/types and production build. Fresh/populated migrations and disposable database checks passed. The 500-row batch created 500 leads, 500 activities and one receipt in 294 ms. OpenAPI parity, frontend acceptance, focused browser coverage and independent source review passed. The normal local database migration was applied after a consistent backup and passed `db:check`, with existing record counts preserved; this is local operational verification, not production deployment.
