# CSV import/export — export delivery slice

Status: Verified locally on 2026-11-11 as the export-only slice. This historical scope excludes import; property and lead imports are separate verified specifications. P2-04 was completed on 2026-11-13.

## Goal

Let all staff download leads and properties within their existing access for spreadsheet use. This is the export-only slice of P2-04; verified property and lead imports complete the broader roadmap item separately.

## Scope and exclusions

- In scope: authenticated filtered lead/property CSV downloads, stable columns, role-aware field selection, bounded database reads and file size, safe serialization, and browser download integration.
- Out of scope: import, updates through spreadsheets, duplicate detection, XLSX/PDF, column selection, selected-row export, photo files/URLs, property descriptions, inquiry messages, notes/activity, background jobs, saved export files, notifications and deployment.
- Dependency: backend-only `csv-stringify` 6.9.0. No persistence migration or new environment variable was added.

## Behavior and contracts

The authoritative implemented contract is [contract.md](contract.md). Additive routes are `GET /api/v1/staff/leads/export` and `GET /api/v1/staff/properties/export`, registered before `/:id`. Existing JSON APIs retain their current behavior.

All staff can export. Middleware validates the session, then the service uses `requireCurrentStaff(identity, tx)` in the same bounded transaction as record selection. Current role and lead assignment determine access, not a role passed by the browser or cached before the transaction.

Lead exports preserve existing list defaults and validation: Agents default to `mine`; Admin/Manager default to `unassigned`. Agents cannot export `all`, `unassigned` or another agent's leads. Admin/Manager can use their existing views and assignment filter. Property exports include the same staff inventory states, but Agent files omit owner columns entirely; Admin/Manager files include them. Private owner fields must not be selected for Agent exports.

Reuse current SQL search normalization, predicates and stable sort order. Export all matches across pages in one consistent read snapshot; do not loop through separately authorized list-page requests. The browser omits `page`/`pageSize`; direct export requests containing pagination or unknown/duplicate parameters are rejected. Reuse existing validation limits rather than relaxing list page-size schemas.

Read no more than 5,001 selected rows to detect the 5,000-row limit. Select export fields explicitly without loading photos, descriptions, notes or full records. Serialize only after the bounded transaction finishes. The complete UTF-8 CSV, including BOM/header, must not exceed 10 MiB. Reject overflow before sending CSV headers/body; never truncate or return a partial success.

No server-side export file is retained. Exports do not modify records or create activity. They represent access/data at the authorization snapshot; later reassignment cannot recall an already downloaded file.

## Acceptance criteria

- [x] Both routes export every authorized matching record, independent of list pagination, with existing defaults, literal search and stable sorting preserved.
- [x] Anonymous, expired, revoked, disabled/banned and credential-invalid sessions receive no CSV; current-role downgrade cannot expose owner fields or broaden lead access.
- [x] Agents cannot obtain other agents' or unassigned leads; owner columns/data never occur in Agent property files.
- [x] Fixed column order, mapping, CSV headers and error responses match the backend-owned contract.
- [x] Empty exports contain headers only; 5,000 rows pass, 5,001 fail, and byte overflow fails without a partial download.
- [x] Commas, quotes, CR/LF, Unicode, formula-like text, international phones, zero values and nulls serialize safely and predictably.
- [x] No descriptions/photos/activity are fetched, no data writes/migrations occur, and affected list/detail browser regressions pass.
- [x] Isolated backend whole-repository check passes. Disposable database, source-quality, full-suite and cross-repository browser evidence is recorded below.

## Validation

Use Vitest/Supertest against disposable data for role/session matrices, filters/defaults, all-page ordering, duplicate/unknown query errors, exact column selection, row/byte boundaries and safe errors. Inspect repository projections to prove Agent owner exclusion. Exercise current-role/session changes between middleware and service validation. Test the serializer with Unicode and formula variants, quoted newlines, zero and blank fields. Run `bun run check` and `bun run db:check` with disposable database configuration. Frontend-owned Playwright coverage must download both CSVs through the normal same-origin path and inspect their bytes and rows.

The observed 46-worker default Vitest run leaves one pre-existing public-chat fixture timing out at its 5-second test limit; the full serial CSV-era suite passes 189/189. The backend test configuration may cap default workers at 4 for stable bounded concurrent execution while preserving existing test timeouts and allowing an explicit CLI worker override. This changes test-run scheduling only: it does not change application runtime, API behavior, environment configuration, migrations or export limits. The resulting `bun run check` must still pass before final delivery evidence is recorded.

## Risks and rollout

- The row/byte caps and fixed columns are delivered implementation defaults, not production capacity measurements. Narrow filters when exceeded; jobs/streaming are future work if needed.
- Keep shared predicate extraction small and used by list/export; broad module refactoring is excluded. Avoid SQLite parameter-count limits when selecting export IDs.
- Formula escaping intentionally changes risky text, including a leading `+` phone, in the serialized file. CSV cannot force spreadsheet cell types; text-column import is needed to reliably preserve phone formatting.
- The OpenAPI definitions and frontend snapshots are delivered. Roll back routes, UI and the dependency together; no database rollback is required.

## Implementation evidence

The shared writer is `src/shared/csv/export.ts`; feature-local lead/property services map their own columns before passing explicit rows to it. The controller sends headers only after successful serialization. No export file is persisted.

Source review approved the backend implementation, including service-level stale-identity authorization coverage. Recorded evidence is focused export/authorization tests, a passing `bun run check` with lint/full formatting/Prisma type/build and 46 files / 189 tests in 44.57 seconds, and a fresh migrated disposable database check. Cross-repository disposable browser evidence records 8/8 CSV acceptance cases, 14/14 affected regressions, two keyboard cases and four visual cases. The earlier 46-worker default run exposed an existing public-chat fixture timeout; the final bounded four-worker configuration passes while preserving test timeouts and CLI overrides.
