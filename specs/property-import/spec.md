# Property CSV import

Status: Verified delivery — 2026-11-12. Shared CSV mechanics now also serve the verified lead importer.

## Goal

Import new draft properties from a CSV after preview, rejecting the entire batch if any row is invalid. Reuse CSV mechanics with the delivered lead importer while keeping property business rules separate.

## Scope and exclusions

- Included: Admin/Manager template, preview and confirmation; bounded CSV parsing; explicit property validation; atomic creation; durable idempotency receipts; accessible reusable import UI.
- Excluded: Agent imports, updates/upserts, publishing, photos/URLs, automatic duplicate matching/merging, XLSX, arbitrary column mapping, jobs and deployment.
- Backend-only `csv-parse` 7.0.3 is installed; `csv-stringify` generates the template. No frontend CSV package or multipart package is needed.
- Limits: UTF-8 CSV at most 1,048,576 bytes, 500 data records, 65,536 bytes per record. API JSON transport is bounded to 6 MiB to allow escaped CSV strings; CSV bytes are checked independently. Keep existing global/other-route limits unchanged.

## Behavior and contracts

The backend owns [contract.md](contract.md). Add routes under `/api/v1/staff/properties/imports` before `/:id`. Both mutations require the existing manager middleware, trusted Origin, JSON content type and bounded parsing; services independently validate current staff. Agents receive 403 before upload-body consumption.

Use one shared `src/shared/csv/parse-import.ts` helper for UTF-8/BOM handling, strict headers/column counts, bounded records and structured diagnostics. The neutral HTTP guards live in `src/shared/csv/import-middleware.ts` and are consumed by both import routes. Parsing returns strings; preserve phone zeroes and use property-owned conversion. Do not build an importer registry, generic persistence service or generic receipt model.

Property-owned validation reuses `createSchema`, `toData` and search normalization. All rows are validated before any property insert. Unknown/duplicate headers, malformed CSV, empty batches, oversized records/files or more than 500 records reject the batch. Domain failures produce row/column errors; none are silently skipped. Blank lines may be ignored; quoted multiline values are single records. Reject invalid UTF-8 and NUL bytes. Do not evaluate formulas or fetch URLs.

Every created record is `draft`, `available`, `featured=false`, `isDemo=false`, without photos. No user column can set IDs, publishing state, availability, featured/demo flags or audit fields. Existing properties remain unchanged. Matching/duplicate detection is explicitly absent; the UI warns that confirmation creates new records.

Preview performs no writes. It returns all validation counts, at most 100 issues, and at most 20 normalized preview rows. Commit resubmits the same CSV and preview digest, revalidates it and all permissions, and creates all rows plus one receipt in one serialized transaction. Acquire a SQLite write reservation before reading a possibly missing receipt, following the existing lead receipt locking pattern. Any validation, permission or database failure rolls back every inserted draft and receipt.

Add a property-owned `PropertyImportReceipt` persistence model/migration with submission UUID primary key, actor ID, content digest, schema version, created count, created property IDs (serialized JSON) and creation time. Do not persist uploaded CSV, owner contacts or preview rows in the receipt. A submission UUID is bound to its actor and exact content/version. A valid same-actor retry returns the original result without more inserts; different content or actor cannot reuse it. Fresh live permissions apply to replay too. Deleted properties are not recreated by replay.

## Acceptance criteria

Replay validation clarification (2026-11-13): validate the incoming CSV before returning an existing receipt as well as before new inserts. An invalid lone-surrogate string must not replay a valid U+FFFD-containing file merely because lossy UTF-8 encoding produces the same digest. Preserve live authorization and incompatible-receipt conflict precedence; valid retries remain idempotent.

- [x] Only current Admin/Manager identities can template/preview/commit; revoked, expired, disabled/banned, credential-invalid or demoted identities cannot import or replay.
- [x] Parser handles BOM, commas/quotes/newlines and phones as text; duplicate/unknown headers, malformed input and byte/row/record limits are deterministic errors.
- [x] Every invalid batch produces zero property/receipt inserts, including an invalid final row after otherwise valid rows.
- [x] Valid confirmation creates exactly N drafts with correct property/search mappings and forced defaults, without modifying/publishing existing records or adding photos.
- [x] Preview binds the exact file/version; changing the file requires a fresh preview. Commit revalidates rather than trusting preview rows from the browser.
- [x] Same-ID retries, concurrent confirmations and uncertain-response recovery create one batch; mismatched actor/content returns a safe conflict.
- [x] Injected mid-batch persistence failure rolls back all drafts/receipt; HTTP errors do not expose private database internals.
- [x] Fresh/populated migrations, full backend check, disposable database verification, contract parity and cross-repository acceptance pass.

## Validation

Write parser and property validation tests first; exercise max boundaries, scalar conversion, header errors, last-row invalidation and bounded issue/preview responses. Use real disposable SQLite service/HTTP tests for authorization, stale identity, parallel same-ID calls, payload conflicts, rollback injection and idempotent recovery after a lost response. Keep the existing four-worker test budget and timeouts. Run `bun run check`, fresh/populated migration checks and disposable `bun run db:check`; never use the running user's database for mutation tests.

## Risks and rollout

Draft-only creation preserves existing publishing requirements. A maximum 500-row transaction needs measured validation within the current 15-second transaction budget; lower the row cap with synchronized contract/docs if measurements require it, rather than raising timeouts by default. Receipts must migrate before endpoints are deployed. No automatic file retention or new infrastructure. Rollback disables import entry/endpoints; retain receipts and created business records unless an explicit data rollback is separately authorized.

## Implementation evidence

`csv-parse` 7.0.3 is installed only in this repository; `csv-stringify` remains the template writer. The full `bun run check` passed (49 test files / 222 tests, lint, formatting, generated Prisma types, and production build). Parser/service/HTTP tests cover raw 1 MiB and 64 KiB record boundaries, including an 11-fail/12-pass raw-record boundary matrix, malformed UTF-8, atomic invalid-final-row handling, receipts, authorization and rollback. Fresh and populated migration tests and a disposable `bun run db:migrate` plus `bun run db:check` passed. Final browser and frontend contract acceptance is recorded in the companion frontend property-import specification.
