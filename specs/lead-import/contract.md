# Lead CSV import contract

Status: Verified implementation contract — 2026-11-13.

## Access and transport

All three routes require live Admin/Manager staff and no-store responses. Agents cannot bulk import, even though their existing manual self-assigned lead creation remains available. POST guards run in order: manager session, trusted Origin, JSON content type, UTF-8 charset validation, bounded import JSON parsing. Keep ordinary lead JSON limits unchanged. Frontend writes use Server Actions with allowlisted cookie/Origin forwarding and expected rendered-actor checks; Express remains the authorization authority.

## CSV format

Template: `name,phone,email,purpose,budget_aed,source`, header-only UTF-8 BOM with CRLF, filename `lead-import-template.csv`.

- Required headers: `name`, `purpose`, `source`, plus at least one of `phone`/`email`. `budget_aed` and the other contact header may be omitted. Reordering is allowed. Trim header whitespace; reject unknown, duplicate and empty headers, inconsistent columns or empty batches.
- `name`: existing trimmed 1–120 characters. `purpose`: `sale`/`rent`. `source`: `call`/`walk_in`, matching manual creation; `website` is not accepted in this slice. Trim/lowercase enum values; do not infer source or create an `import` source.
- `phone`: optional blank-to-null; otherwise use existing 3–40 character phone rules, permitted digits/plus/parentheses/spaces/hyphens and at least one digit. New values must also be a valid UAE national number beginning with `0`, or an explicit international number beginning with `+`/`00`, under backend `libphonenumber-js/max` validation. Normalize whitespace as existing creation does; preserve plus signs and leading zeroes. Do not coerce to a number or strip spreadsheet apostrophes automatically.
- `email`: optional blank-to-null; otherwise existing valid email/max-254 rule, trimmed and lowercased. Every row must have at least one valid contact. Invalid supplied contact values fail even when the other contact is valid. Missing both produces a `phone` column issue: `Provide a phone number or email address.`
- `budget_aed`: optional blank-to-null; positive plain decimal, at most two decimal places, no grouping/currency/exponent notation. Convert with integer arithmetic to 1–1,000,000,000,000 fils and persist through the existing BigInt mapping.
- Unknown columns such as IDs, assignees, properties, stages, historical timestamps, messages or audit fields reject the batch. All leads start `new`, version 1, unassigned/unlinked, with current creation timestamps and live actor attribution. No emails, notifications or assignment events are generated.
- Repeated phone/email values and identical rows can create distinct new leads. Schema-version 2 previews report scoped existing-phone and same-file matches; a current explicit acknowledgement is required before committing a warned batch. There is no matching-based update, merge, silent skip or deduplication. Export reports contain extra fields and are not accepted as import templates.
- Limits: 1,048,576 UTF-8 CSV bytes, 500 data records, 65,536 bytes per raw record including quotes and any terminating CRLF; JSON transport at most 6 MiB. Reject invalid UTF-8, unpaired surrogates and NULs. Ignore empty lines; logical nonempty CSV records count from header row 1, with quoted multiline values staying one record.

## Endpoints

### GET `/api/v1/staff/leads/imports/template`

200 CSV attachment with the same safe headers/BOM/CRLF policy as the existing template writer. Does not write data.

### POST `/api/v1/staff/leads/imports/preview`

Strict request `{ csv: string }`.

200 `{ schemaVersion: 1, digest: string, valid: boolean, totalRows: number, validRows: number, issueCount: number, issues: ImportIssue[], columns: string[], previewRows: ImportRow[] }`.

`ImportIssue = { rowNumber: number, column: string, message: string }`; `ImportRow = { rowNumber: number, values: string[] }`. Columns and each six-value row follow template order. Show normalized strings/blank nulls, at most 20 rows and 100 issues; validate every record and report accurate total counts. Invalid domain rows return 200 with `valid=false`, and confirmation remains blocked. Preview writes no leads, activities, notifications or receipts.

Digest: lowercase SHA-256 of UTF-8 `lead-import:v1\0` followed by the exact CSV UTF-8 bytes, including any BOM. The namespace differs from property import. Digest binds reviewed content, not permissions.

### POST `/api/v1/staff/leads/imports/commit`

Strict request `{ submissionId: UUID, schemaVersion: positive integer, digest: lowercase SHA256 hex, csv: string }`; current schema version is 1. Reject actor IDs, normalized-row arrays and persistence fields.

- New batch: 201 `{ submissionId, createdCount, leadIds: UUID[], replayed: false }`.
- Same actor/ID/exact content/version replay: 200, identical count/IDs and `replayed: true`. No new leads, activities or notifications; later lead edits/assignments remain intact.
- Invalid domain rows: 422 `{ error: { code: "IMPORT_VALIDATION_FAILED", message: "Fix every invalid row before importing.", requestId }, issues, issueCount }`, bounded as preview, zero inserts.
- Unsupported positive schema version or mismatched digest: 409 `IMPORT_PREVIEW_STALE`, safe instruction to preview again.
- Existing ID bound to another actor/content/version: 409 `IMPORT_CONFLICT`, generic response without other actor/results. Check incompatible existing receipts before disclosing stale-preview details.
- Structural/header/empty/malformed encoding input: 400 `IMPORT_INVALID_CSV`; malformed request shape: 400 `VALIDATION_ERROR`; file/row/record/JSON limits: 413; unsupported JSON/charset: 415; unauthenticated: 401; Agent: 403; persistence failure: safe 5xx. Preserve existing request-ID/error conventions.

Acquire a write reservation before fresh actor/receipt reads. All new lead/search fields, one existing actor-attributed `created` activity per row and the aggregate receipt commit together. Validate all rows before inserts. Any lead, activity, receipt or authorization failure rolls back the batch. Do not call the normal HTTP/create service N times or reuse single-lead receipts as a batch receipt.

## Durable recovery and privacy

`LeadImportReceipt`: UUID `id`, `actorId`, `contentDigest`, `schemaVersion`, `createdCount`, JSON `leadIdsJson`, `createdAt`; no raw CSV, phone/email/name snapshots or contact-bearing logs. Retain aggregate receipts independently of later lead changes. Existing lead/activity tables hold their normal business data.

Before confirm, store only submission ID/digest/version under the lead namespace and current rendered staff ID. Retry explicitly with the same file/identity. Reload requires reselecting/repreviewing that exact file. Starting over with a different file or unrecoverable metadata requires duplicate-risk acknowledgement. Catch storage failures, preserve in-memory retry identity and explain when reload recovery is unavailable. Clear file and pending metadata on confirmed success. Expected actor mismatch must stop dispatch and ask for reload, preserving prior pending identity.

For schema version 2, the digest is SHA-256 of `lead-import:v2`, a NUL byte and exact UTF-8 CSV bytes. Preview includes bounded `duplicateReview` warnings; commit carries an optional `duplicateAcknowledgement.reviewToken` and rechecks it under the write reservation. A missing/stale acknowledgement when warnings exist returns `409 IMPORT_DUPLICATE_REVIEW_REQUIRED` with zero writes. Compatible committed version-1 receipts replay before v2 validation/matching; an uncommitted v1 identity is `409 IMPORT_PREVIEW_STALE`. A pending v1 reload must verify its historical v1 digest and retry the original commit before discarding it or creating a v2 preview. The authoritative details are in the [duplicate-detection contract](../lead-duplicate-detection/contract.md).

## Compatibility and ownership

Existing template columns, source enum, notification behavior and role permissions remain unchanged. The version-2 preview/commit extension adds phone validation and acknowledgement behavior; backend leads OpenAPI owns the implemented operations and the frontend snapshot/generated types include them. Share the parser, neutral import transport guards, common file inputs and CSV presentation; keep entity-specific rules and persistence in each feature. `libphonenumber-js` is a backend-only installed dependency; no shared cross-repository source module is added.
