# Record activity log coverage inventory

Status: Locally verified on 2026-11-26. This inventory describes application writes covered by P3-04 version 1; it is not a claim of historical completeness.

## Producers

- **Properties:** create, patch (including publishing state, availability, archive/restore and featured changes), delete, photo add/remove and photo reorder emit `property.*` events from `properties.service.ts`. `tests/property-audit-log.test.ts` and `tests/property-audit-identity.test.ts` cover committed changes, no-op/denied paths, transactional actor revalidation and failure rollback.
- **Leads:** staff create/patch/assignment/stage/temperature/note/call operations and public Website enquiry creation emit `lead.*` events from `leads.service.ts`. `tests/lead-audit-log.test.ts` covers source attribution, redaction, snapshots (including clearing context while identifiers remain null), stale/no-op rejection and preserved lead activity behavior.
- **Viewings and tasks:** create/reschedule/cancel/complete and create/update/complete/cancel emit `viewing.*` and `task.*` events from their feature services. `tests/viewing-task-audit-log.test.ts` covers the supported state changes, safe feedback/title/notes markers and transaction behavior.
- **CSV imports:** lead and property commit paths create one per-record `*.created` event and one `import.completed` summary in their existing transaction. `tests/import-audit-log.test.ts` covers 500-row property batches, failure rollback, replay, and the server-generated audit import UUID. The audit UUID is independent of the client receipt `submissionId`, so lead and property batches that reuse a receipt UUID do not merge.

## Read and persistence proof

- `tests/record-audit-log.test.ts`, `tests/record-audit-log-read.test.ts` and `tests/record-audit-log-contract.test.ts` cover the protected list/actor reads, validation, redaction and stable ordering.
- `tests/record-audit-log-migration.test.ts` exercises fresh and populated disposable migrations, all 15 migrations, explicit coverage metadata, no history backfill and an indexed 10,000-event / 9,800-offset read.
- `bun run check` passed with 89 files and 390 tests; disposable `db:migrate` and `db:check` passed. These are local verification results only: no normal database migration or deployment occurred.

## Exclusions

This inventory excludes staff administration, authentication attempts, reads/searches/exports, notification/email delivery, untracked direct SQL, seeds, migrations, operator scripts, historical backfill and application purge. A production retention/backup decision remains required before activation.
