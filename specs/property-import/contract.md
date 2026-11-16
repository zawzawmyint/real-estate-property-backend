# Property CSV import contract

Status: Implemented and verified contract — 2026-11-12. The root OpenAPI document is the transport reference.

## Access and transport

All routes require a current Admin/Manager session, use no-store responses and exclude Agent access. POST routes require trusted Origin and JSON; existing error envelopes/request IDs apply. Root OpenAPI is authoritative for the implemented transport. Frontend mutations use feature-owned Server Actions and the existing safe cookie/Origin transport, not browser-owned persistence or a new upload proxy.

## CSV format and mapping

Template header order: `title,purpose,type,description,price_aed,city,community,bedrooms,bathrooms,area_sqft,owner_name,owner_phone`.

- `title` and `purpose` headers and row values are required. Other listed columns are optional and may be blank. Header order is flexible; trim header whitespace but reject duplicate, empty or unknown names. Exported reports have extra IDs/status columns and are not import templates.
- `title`: existing trimmed 1–160 character rule. `purpose`: `sale` or `rent`; `type`: optional `apartment`, `villa`, `townhouse`, `penthouse`. Trim and lowercase enum values, then use existing property rules.
- `description`, location and owner fields follow existing property creation limits. Blank optional fields map to null. Preserve phone text and leading zeroes; do not strip a leading apostrophe automatically or infer spreadsheet formulas.
- `price_aed`: positive decimal without grouping/currency symbols, at most two decimal places, converted with integer arithmetic to existing `priceFils` limits. `area_sqft` follows the existing positive two-decimal square-foot rule. Bedrooms/bathrooms are integers 0–20, with zero preserved.
- The template contains the header only, encoded UTF-8 with BOM and CRLF. All records become new unpublished drafts; photos must be added later. Existing records and IDs cannot be updated.
- At most 1,048,576 UTF-8 bytes, 500 data records and 65,536 UTF-8 bytes per raw record (including CSV quoting and any terminating line ending). Empty lines are ignored. Data row numbers are logical CSV record numbers including the header as row 1; quoted multiline fields remain one row.

## Endpoints

### GET `/api/v1/staff/properties/imports/template`

200 CSV attachment, filename `property-import-template.csv`, same safe CSV headers as export. The frontend can use the existing same-origin rewrite for this read.

### POST `/api/v1/staff/properties/imports/preview`

Request `{ csv: string }` only. JSON body is capped at 6 MiB, and decoded UTF-8 CSV bytes at 1 MiB. Reject NUL and unsupported/malformed encoding at the upload action/parser boundary.

200 JSON:

```json
{
  "schemaVersion": 1,
  "digest": "sha256-of-version-and-exact-csv",
  "valid": true,
  "totalRows": 1,
  "validRows": 1,
  "issueCount": 0,
  "issues": [],
  "columns": [
    "title",
    "purpose",
    "type",
    "description",
    "price_aed",
    "city",
    "community",
    "bedrooms",
    "bathrooms",
    "area_sqft",
    "owner_name",
    "owner_phone"
  ],
  "previewRows": [
    {
      "rowNumber": 2,
      "values": [
        "Example home",
        "sale",
        "",
        "",
        "1000000.00",
        "",
        "",
        "0",
        "",
        "",
        "",
        ""
      ]
    }
  ]
}
```

Preview rows are the first at most 20 data records in template column order, with normalized display strings and blank nulls. Invalid domain rows return `valid=false`, accurate counts and at most 100 issues `{ rowNumber: number, column: string, message: string }`; `issueCount` reports the total. Preview never writes. File/header/CSV structural errors return a safe 400, and file/row/record overflows 413; unsupported media type returns 415.

Decode uploaded UTF-8 with fatal validation while preserving its BOM in the CSV string; reject unpaired surrogate strings on direct JSON requests. Apply the 64-KiB guard to raw encoded records rather than JavaScript character counts.

Digest is lowercase SHA-256 of UTF-8 `property-import:v1\0` followed by the exact CSV string bytes. It binds the confirmation to the reviewed file/version; it is not an authorization token. Confirmation always revalidates the data and session.

### POST `/api/v1/staff/properties/imports/commit`

Request `{ submissionId: UUID, schemaVersion: 1, digest: string, csv: string }` only. Preview data arrays, actor IDs and property persistence fields are not accepted.

- New successful batch: 201 `{ submissionId, createdCount, propertyIds: string[], replayed: false }`.
- Same actor + same submission ID + same content/version: 200 with the original result and `replayed: true`; zero additional inserts.
- Any invalid data row: 422 `IMPORT_VALIDATION_FAILED`, safe message and bounded row issues, zero inserts. File/structural size errors retain preview status semantics.
- Digest/version mismatch: 409 `IMPORT_PREVIEW_STALE`; obtain a new preview.
- Existing submission ID bound to another actor/content: 409 `IMPORT_CONFLICT`, generic message without other actor/result details.
- Live session failure: 401; current Agent role: 403, including replay. Persistence failure: safe 5xx and full rollback.

Commit row-validation failures use a feature-owned 422 response `{ error: { code: "IMPORT_VALIDATION_FAILED", message: "Fix every invalid row before importing.", requestId: string }, issues: ImportIssue[], issueCount: number }`, with the same 100-issue cap. The controller maps this explicit outcome; do not broaden global error payloads.

## Retry and reload

Generate a submission UUID only for a valid preview and persist pending metadata scoped to staff ID in browser session storage before confirmation: submission ID, digest and schema version only, never CSV/property values. Keep it through network/5xx uncertainty and page reload. Retry confirmation only explicitly, with the same ID and exact file; after reload require reselecting the matching file and re-previewing before retry. A different file cannot replace an unresolved pending batch without an explicit warning/acknowledgement that starting over can create duplicates. Successful confirmation clears pending metadata and file selection; retain completion summary until navigation. Malformed/unavailable storage must not crash the page: keep the in-memory safe-retry state and explain that reload recovery is unavailable. If prior metadata cannot be recovered after reload, require explicit duplicate-risk acknowledgement before assigning a new submission ID.

Idempotency protects retries, not intentional re-import under a fresh ID. The UI states that existing properties are not matched or updated; no property duplicate detection is implied.
