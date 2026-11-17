# Lead duplicate detection API contract

Status: Verified contract — 2026-11-17. Backend-owned; not deployed.
Roadmap: P2-05 is complete. This snapshot exactly mirrors the backend-owned narrative contract; executable OpenAPI and generated declarations remain backend-owned artifacts.

## Transport, access and normalization

All staff routes require a live session and no-store responses. POST/PATCH preserve trusted Origin, JSON content type, bounded parsing, current actor and resource authorization. Import routes remain Admin/Manager only with existing UTF-8/body bounds. Frontend writes use feature-owned Server Actions and allowlisted cookie/Origin forwarding. Never log request phone/token/body values.

CanonicalPhone is an E.164 string produced by backend strict libphonenumber-js/max parsing with isValid(). Normalize a leading international 00 to +; otherwise permit + international input or a leading-zero UAE national mobile/fixed-line number interpreted as AE. Use parsePhoneNumberFromString(value, { defaultCountry: "AE", extract: false }) after these prefix checks, require the parsed number's isValid(), reject extensions and use its number property as canonical output. Reject extensions, short codes, bare country-code digits, foreign national input, letters and impossible/unsupported numbers; do not extract digits from prose. Accept formatting allowed by the existing phone input (spaces, brackets, hyphens), maximum 40 characters. Preserve trimmed display phone and current searchPhone behavior. Blank/null means no match if another valid contact exists.

New supplied invalid phones: 400 VALIDATION_ERROR with fieldErrors.phone (CSV domain rows use their existing issue mechanism). Existing uncanonicalizable phone values survive backfill with canonical=null. On PATCH, identical trimmed legacy phone text or omitted phone may survive unrelated edits; changing that text requires a normalizable value or clearing it subject to the existing contact requirement. Formatting-only changes of a recognized number retain its identity and need no duplicate acknowledgement.

Staff scope: Admin/Manager all leads; Agent only current own assigned leads. Scope is independent of the lead list's view/stage/source/search filters. All stages participate. Hidden matches must have no effect on returned counts, reviewToken or acknowledgement requirement.

## Review shapes

Named schemas:

- DuplicateLeadSummary: { id: UUID, name: string, phone: string, stage: LeadStage, assignedAgent: existing LeadStaffSummary | null }.
- DuplicateReview: { canonicalPhone: string, totalMatches: integer >= 0, matches: DuplicateLeadSummary[], truncated: boolean, reviewToken: lowercase SHA256 hex }.
- matches: newest createdAt then id descending, maximum 20; totalMatches counts the entire accessible set; truncated equals totalMatches > matches.length.
- DuplicateAcknowledgement: { reviewToken: lowercase SHA256 hex }. Supplying this field is the caller's explicit acknowledgement, not a capability granting access.

reviewToken deterministically hashes a versioned namespace, live actor ID/role, canonicalPhone, excluded lead ID (or null) and every scoped matching lead ID sorted ascending. Match membership is unbounded in hashing but summaries are capped. Do not include hidden matches, presentation fields or timestamps: ordinary note/stage edits do not invalidate acknowledgement; new/deleted/reassigned accessible matches do. Authorization is always independent. No token is stored on Lead and no review state is stored in browser persistent storage.

## POST /api/v1/staff/leads/duplicate-check

New route; register before /:id. Strict body: { phone: string, excludeLeadId?: UUID }.

200: DuplicateReview. No writes, receipts or activities. If excludeLeadId is present, verify live access first and exclude that lead; inaccessible/missing uses the existing 404 policy, never an existence oracle. Invalid input 400; unauthenticated 401; current scoped matching outage safe 5xx. Use this body-based endpoint rather than placing private phone text in URLs.

The UI checks on phone blur and before save if needed, ignores obsolete responses, and does not automatically retry writes. A failed preview has an explicit retry; the backend still independently enforces the save guard.

## Existing POST /api/v1/staff/leads and PATCH /api/v1/staff/leads/:id

Extend strict create/patch inputs with optional duplicateAcknowledgement: DuplicateAcknowledgement. All current business fields and success shapes remain unchanged. An acknowledgement alone is not a meaningful PATCH.

For a new manual create, or a PATCH that changes the canonical phone, compute live scoped matches in the same existing serialized write transaction as version/resource validation. Exclude the edited lead. No matches: allow without acknowledgement. Visible matches: require the current token.

Absent/mismatched token with visible matches: 409, zero writes:
{ error: { code: "LEAD_DUPLICATE_REVIEW_REQUIRED", message: "Review matching leads before saving a separate lead.", requestId }, duplicateReview: DuplicateReview }.

A known definite duplicate-review conflict is not an uncertain save. Preserve draft/submission ID, show fresh review, clear acknowledgement, then allow explicit resubmission. Changed phone clears acknowledgement locally. If matches disappear, a previous acknowledgement cannot prevent an otherwise valid save. If canonical phone did not change, PATCH needs no acknowledgement even if a match appeared later.

Manual create checks the existing actor/payload receipt before new phone validation/matching, after live authorization and receipt compatibility. Keep the established business-payload hash excluding duplicateAcknowledgement so a receipt retry is not invalidated by a changed review token. Authorization of the replayed lead still applies. Strict transport/shape guards remain first; receipt replay must not be rejected only because an old stored phone fails the new normalization. Existing version conflict/not-found/forbidden policies remain independent. PATCH response loss uses existing version/reconciliation behavior; it must not create a second update or bypass expectedVersion.

## Existing list/detail reads and export

GET /api/v1/staff/leads adds optional duplicates=only; absence preserves current list membership. LeadSummary and LeadDetail add duplicateCount: integer >=0. Count OTHER currently accessible leads with the same non-null canonical phone, across all stages and independent of list filters. The duplicates=only predicate runs before pagination/totals; filters combine with AND. Null canonical returns 0. Exclude self.

Detail review uses duplicate-check with the saved phone and excludeLeadId; an ambiguous legacy phone instead shows a correct-phone hint, not a false "no duplicates" claim. Existing list/detail unreadable states and live authorization remain unchanged. Avoid per-row queries; use indexed scoped set-based queries.

Existing CSV export accepts duplicates=only because it uses lead filters; keep existing fixed export columns unchanged. Duplicate counts are not exported in this slice.

## Existing public property and agency inquiry routes

No duplicate-check endpoint or metadata is exposed publicly. Repeated phones create separate inquiries as today; persist phoneCanonical on new recognizable input. Enforce the agreed new phone format on new supplied phones with ordinary validation errors. Keep success/error shapes independent of database matches. Existing compatible successful receipt replays happen before new semantic normalization and continue to create nothing.

## Lead CSV preview/commit v2

Keep six template columns and all existing size/row/encoding/permission/atomicity rules. Property import is unchanged. New lead preview returns schemaVersion=2. Digest becomes SHA256 of UTF-8 "lead-import:v2" followed by a NUL byte and exact CSV UTF-8 bytes. Existing malformed requests/errors retain their codes.

Extend the preview with duplicateReview: ImportDuplicateReview:
{ affectedRows: integer, existingMatchRows: integer, withinFileRows: integer, warningCount: integer, warnings: ImportDuplicateWarning[], truncated: boolean, reviewToken: lowercase SHA256 hex }.

ImportDuplicateWarning:
{ rowNumber: integer, canonicalPhone: string, existingMatchCount: integer, matches: DuplicateLeadSummary[], sameFileRowNumbers: integer[], sameFileRowCount: integer }.

- Warnings sorted by logical CSV rowNumber, max 100. Each matches array max 5; sameFileRowNumbers excludes self, ascending, max 20; sameFileRowCount is the complete count excluding self. Counts refer to the entire file/database and never just displayed rows.
- Affected/warningCount counts each valid phone row with either kind of match once. existingMatchRows/withinFileRows may overlap. All rows in a repeated-number group are flagged. Email-only rows never match.
- Existing matches use the same staff scope; imports require Admin/Manager. Invalid domain rows remain blocking errors; warnings are computed for normalizable valid rows and never make valid=false themselves.
- Batch reviewToken hashes version namespace, actor ID/role, exact v2 digest, the complete per-row scoped existing match IDs and complete same-file groups, in deterministic row/ID order. Exclude truncated summaries and presentation fields from identity.
- valid/issueCount keep validation meaning. UI requires valid AND explicit duplicate acknowledgement when affectedRows>0.

Commit extends the current strict body with optional duplicateAcknowledgement: DuplicateAcknowledgement. schemaVersion=2 and v2 digest required for new batches. Acquire write reservation, live-authorize, check receipts, validate every row and recompute all matches before first lead insert.

Missing/stale acknowledgement with affected rows: 409 { error: { code: "IMPORT_DUPLICATE_REVIEW_REQUIRED", message: "Preview and acknowledge matching phone numbers before importing.", requestId }, duplicateReview: ImportDuplicateReview }. Zero inserts, activities or receipts. UI re-previews the same file, resets acknowledgement and requires explicit confirmation; preserve submission identity for a definite no-write failure.

Accepted warnings create ALL valid rows as separate New/unassigned/unlinked leads, including same-file duplicates. No automatic skip, merge or update. Existing result/status shapes (201 new, 200 replay), created activities and aggregate receipt atomicity remain unchanged.

Compatibility: an already-committed schemaVersion=1 request with matching original v1 digest/content/actor/submission replays its saved result before v2-only validation or duplicate checks. A new/uncommitted v1 request returns existing 409 IMPORT_PREVIEW_STALE and must preview using v2. An incompatible receipt remains 409 IMPORT_CONFLICT without revealing other results. v2 successful receipt replay also precedes current duplicate checking and is independent of acknowledgement token; later-created leads must not turn safe retry into a new batch.

Keep browser recovery metadata limited to existing actor-scoped submission ID/digest/version; support versions 1 and 2 for committed receipt recovery without storing phones, CSV, match IDs or acknowledgement tokens. For pending v2 recovery, reselect and preview the same file while preserving its identity. For pending v1 recovery, use this explicit path before any v2 preview can replace metadata:

1. Reselect the file and locally verify its exact v1 digest against stored metadata using the historical v1 digest algorithm. A mismatched file cannot resolve that identity; ask for the matching file or the existing explicit duplicate-risk acknowledgement before discarding recovery.
2. Explicitly retry the stored v1 commit request (original submissionId, schemaVersion=1, digest and exact CSV). This request is replay-only in the upgraded backend: a compatible committed receipt returns 200 and the original result, including for phones invalid under the new normalizer. No receipt means 409 IMPORT_PREVIEW_STALE with zero writes; incompatible receipt means 409 IMPORT_CONFLICT.
3. A 200 resolves recovery and never previews/imports again. A transport/5xx result remains uncertain: retain v1 metadata and offer the same retry, never v2 fallback. A definitive stale/conflict response shows the existing recovery explanation and requires explicit duplicate-risk acknowledgement before clearing the old identity and starting a new v2 preview/batch. Never relabel an uncertain result as stale.

Do not run the new phone validator before compatible historical receipt replay. Stale-warning/no-write conflicts and uncertain transport/5xx results must stay distinct. Property-import recovery remains unchanged.

## Persistence, performance and compatibility

Add nullable indexed Lead.phoneCanonical, backfill recognized existing values through the exact runtime normalizer before changed services accept writes. No unique index, stored duplicate booleans, review table, queue or external service. Update manual/import/public writes and changed phone patches; leave raw display/history untouched.

Extend backend leads OpenAPI and frontend snapshot/generated types only at implementation. Coordinated rollout is required: optional input fields are additive, but acknowledgement enforcement, new phone validation and v2 imports change older client behavior. Retain v1 replay support until a separately reviewed retirement decision.

Verify maximum 500-row preview <=5s and atomic commit <=15s against 10,000 disposable leads on a recorded environment. Batch canonical lookup, bounded summaries and indexed membership prevent N+1 reads and unbounded response bodies. These are local acceptance targets, not a deployed SLA.

Implementation evidence is recorded in the feature specification. Browser/runtime and cross-repository acceptance passed; this contract does not claim deployment or a normal-database migration.
