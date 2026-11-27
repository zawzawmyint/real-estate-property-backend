# Record activity log — P3-04

Status: Locally verified — 2026-11-26. The additive implementation and declared local acceptance evidence are complete; no production migration, deployment or retention decision is claimed.

## Goal

Let Admins and Managers investigate who changed agency business records, what changed and when. Both roles see the full agency log, including actions performed by Admins; Agents cannot access this new log. Existing authorized lead timelines remain unchanged.

## Scope and exclusions

- Include successful application changes to properties, leads, viewings and tasks, plus committed CSV import summaries and their per-record creation events. See the exact event coverage below.
- Include a read-only, bounded, filtered investigation API and historical actor choices. Express owns persistence, redaction, actor attribution and authorization.
- Exclude staff account/role administration (not confirmed), authentication monitoring, failed attempts, reads/searches/exports, notification/email delivery, client portal, private documents, commissions, real-time streaming and audit export.
- Exclude historic backfill and untracked direct SQL, seeds, migrations and operator scripts. Preserve existing LeadActivity and reporting semantics; do not present their partial historical data as complete agency audit coverage.
- This locally verified feature remains subject to the earlier release gates in ROADMAP.md. Phase 3 deployment does not bypass them.

## Behavior and contracts

### Access

- Both read endpoints require a live staff session and transaction-scoped `requireCurrentStaff` revalidation. Only current `admin` and `manager` roles may read any event or actor choice. Return 401 for an absent/expired/revoked/disabled/banned session and 403 for an authenticated Agent. Apply authorization before data queries, filters and counts, including malformed queries.
- Admin and Manager have identical agency-wide visibility, including each other's actions, Agent actions and Website/System sources. No creator/assignee scoping applies to the log. Existing business-write permissions do not change.
- No audit create/update/delete endpoint, client-supplied actor, or UI mutation controls. Append-only means application-level immutability, not protection against a database administrator modifying SQLite.

### Event coverage

- **Properties:** `property.created`, `property.updated`, `property.deleted`, `property.photo_added`, `property.photo_removed`, `property.photos_reordered`. Updates include publish/unpublish, archive/restore, availability and featured changes through existing patch operations. Record publishingState/availability before and after; do not invent separate lifecycle writes. Preserve existing deletion restrictions and upload authorization/body ordering.
- **Leads:** `lead.created`, `lead.updated`, `lead.assigned`, `lead.stage_changed`, `lead.temperature_changed`, `lead.note_added`, `lead.call_logged`. Assignment includes unassignment/reassignment. Website property enquiries, agency enquiries and chatbot enquiry handoff use `lead.created` with Website attribution. Notes and calls have metadata only; existing notes cannot be edited in this release.
- **Viewings:** `viewing.created`, `viewing.rescheduled`, `viewing.cancelled`, `viewing.completed`. Completion records that feedback was supplied, not its text. Do not introduce feedback editing, deletion or reopening.
- **Tasks:** `task.created`, `task.updated`, `task.completed`, `task.cancelled`. Record title/notes changes as redacted field changes and due-date changes as before/after instants. Responsibility continues to follow the lead; no independent assignment, delete or reopen operation is introduced.
- **CSV:** `import.completed` for each committed lead/property batch, plus `lead.created`/`property.created` per imported record, all with a shared importId. Store import kind and created count, not filenames, CSV bytes, previews, rejected-row contents or content digests. Preview, validation failures and rolled-back imports create no success events. An authorized identical receipt replay creates no additional events.
- One event per committed operation/record, even when a patch changes several fields. A true no-op with no persisted business-field change produces no event; exclude technical version/updatedAt churn from meaningful changes. Preserve existing response/version behavior. Internal cleanup, retirement of notifications and email ledger writes are not separate business events.

### Persistence, attribution and consistency

- Additive `RecordAuditEvent` model in `prisma/schema.prisma`: UUID id; schemaVersion=1; server-generated occurredAt UTC; actorKind (`staff`, `website`, `system`); nullable actorId/name/role snapshots; entityType (`property`, `lead`, `viewing`, `task`, `import`); entityId; safe entityLabel; action; changesJson; nullable importId/importKind/createdCount. A singleton coverage row records migration-set startedAt and coverageVersion=1.
- Entity IDs and actorId are retained scalar identifiers, not cascading relations. Deletion/renaming of a staff account or business record must not erase or rewrite evidence. Actor role/name reflect the moment of action. System and Website have null staff identity/role; public input must never supply actor identity. Do not add user contact details to snapshots.
- Staff producers revalidate the live actor inside their existing transaction and pass the resulting id/name/role. Property mutation services currently receive only a role: change their internal controller/service signatures to receive the staff Actor, updating callers/tests while preserving HTTP contracts and pre-upload guards. Do not fabricate an actor from role alone.
- Use a feature-owned append function accepting the caller's Transaction. Append and business mutation/receipt writes commit or roll back together, including existing notification/email ledger transactions. Audit failure fails the business write; no detached/background audit queue. Preserve post-commit file cleanup and unknown-outcome upload reconciliation.
- Existing create/receipt replay and concurrency rules remain authoritative. A rejected stale update or known replay adds no event. Distinct committed operations may legitimately produce separate events; do not claim new retry deduplication for property endpoints that do not already support it.
- Index `(occurredAt, id)`, `(entityType, entityId, occurredAt, id)`, `(actorId, occurredAt, id)`, `(action, occurredAt, id)` and `(importId, occurredAt, id)`. No new dependency or environment variable is proposed.

### Privacy and field policy

- Build event payloads from explicit field allowlists and actual persisted before/after values; never serialize raw request bodies, Prisma records or error objects. Each changed field is represented once; use null for absent values and preserve false/0.
- **Before/after values allowed:** property title/type/purpose/priceFils/city/community/bedrooms/bathrooms/areaHundredths/publishingState/availability/featured/isDemo; lead purpose/budgetFils/source/propertyId/assignedAgentId/stage/temperature; viewing leadId/propertyId/startsAt/endsAt/status; task leadId/dueAt/status. Monetary values are decimal integer fils strings, never floating-point AED or JSON BigInt. Area remains integer hundredths of the existing area unit, formatted consistently with property details.
- **Changed field name only:** lead name/phone/email/originalMessage, property owner name/phone/description, task title/notes, viewing feedback and note/call bodies. Lead propertyTitleSnapshot/propertyLocationSnapshot/assignedAgentNameSnapshot are metadata-only changes too: clearing retained context must record these field names even when propertyId/assignedAgentId stays null; a marker omits before/after contents and must not display a misleading null-to-null ID change. Redacted entries have `redacted: true` and no before/after properties; do not store the omitted text in changesJson. Safe labels are property title (max 160 chars), `Lead <id>`, `Viewing <id>`, `Task <id>` and `<kind> import <id>`; never use a lead/customer name or task body as an audit label.
- Photo events store photo IDs/order only, never storage keys, filesystem paths, filenames, URLs or bytes. Metadata-only note/call events use a redacted `body` change marker. Creation/deletion includes only the allowed values; redacted fields may be marked as present without content. Event text renders as escaped plain text.
- Retain events without application purge in v1. This is a proposed default, not an approved production retention policy. Production activation requires the agency's retention/backup decision; no automatic deletion command is added. Database/backup access remains operationally restricted.

### Read API

The backend-owned [contract](contract.md) defines the delivered DTOs, validation and errors. Machine-readable OpenAPI and frontend snapshots are maintained as source in their respective repositories.

- `GET /api/v1/staff/audit-log`: required offset-aware from/to instants, `[from,to)` up to 93 days; optional actorId or actorKind, entityType/entityId, action and importId; page/pageSize. Stable occurredAt/id descending order with transaction-consistent page/count reads.
- `GET /api/v1/staff/audit-log/actors`: paginated historical staff identities found in this log, including disabled/deleted accounts, with bounded name search. Do not expose the entire current staff directory.
- Return explicit coverage start/version, not a claim of all historical changes. Do not backfill LeadActivity: it lacks complete historic role and field-value evidence. Retain its existing endpoints/UI.
- No server free-text event/body search. Record-ID filtering, field changes and actor filtering support investigation without indexing sensitive prose.

## Acceptance criteria

- [x] A01: Admin and Manager see identical agency-wide events, including Admin actions; Agent/public/expired/revoked access exposes no events, actor options or counts.
- [x] A02: Every listed supported operation records correct actor, source, action, timestamp, target and selected changes; unsupported lifecycle actions remain unavailable.
- [x] A03: Mutation, audit and receipt/notification/email database work are atomic; audit insertion failure rolls back business data; stale/denied/no-op/replayed operations add no spurious events.
- [x] A04: Property services receive a transaction-validated Actor; upload guards, media cleanup and existing business HTTP responses remain compatible.
- [x] A05: Committed imports produce one summary and exactly one creation event per inserted record with a common importId; failed/replayed imports produce none additionally.
- [x] A06: Event rows and APIs omit sensitive contents and raw internal data; money/null/false/zero, redaction and HTML-like strings serialize safely.
- [x] A07: Filtering, validation, pagination and historical actor selection match contract.md; deletion/renaming preserves evidence and unavailable targets do not produce misleading links.
- [x] A08: Additive migration preserves populated data; coverage start is explicit; no invented history, destructive rollout or tamper-proof claim.

## Validation

- Backend tests cover all A01–A08 using real disposable SQLite transactions, not only mocked append calls. Include raced demotion/revocation, same-timestamp ordering, import receipt replay, failed insertion, deletion snapshots and property upload failure/unknown outcomes.
- Validate narrative/OpenAPI parity and generated frontend snapshot parity during implementation. Exercise maximum import size and representative high-volume date-filter pages; confirm indexed query plans without claiming unmeasured latency targets.
- Run backend `bun run check`, fresh/populated migration checks and `bun run db:check` against an explicitly disposable database. Run frontend checks and cross-repository browser coverage as described in the frontend companion spec. No normal database migration or deployed verification is authorized by this document delivery.

## Risks and rollout

- Broad producer coverage can silently omit a path: require an operation-to-test inventory across routes, service callers, public handoffs and imports before declaring P3-04 complete.
- Deploy additive migration, all producers and read API together while normal mutation traffic is stopped; coverage begins at migration and no unaudited traffic may run between migration and producer activation. Show planned exclusions in UI/help. No feature flag that silently skips writes after coverage begins.
- Rollback hides/disables the log UI/read routes while retaining producers, schema and events. In v1, if producers are rolled back, business writes must remain stopped until all producers are restored; resuming unaudited writes is unsupported. Coverage-gap intervals/API/UI are outside v1, so never resume writes while silently claiming uninterrupted history. Restore backed-up data only through a separately reviewed recovery procedure.
- The user authorized these implemented scope defaults: no staff administration, no historic backfill and metadata-only sensitive changes. Retention remains a production decision. Earlier-phase deployment prerequisites remain tracked in ROADMAP.md.

## Implementation evidence

The operation-to-test mapping is in [coverage.md](coverage.md). Backend `bun run check` passed on 2026-11-26 (89 files, 390 tests); the disposable fresh/populated migration tests, explicit disposable `db:migrate`/`db:check`, and focused producer/read tests passed. The migration was not applied to normal data, and no deployment or production retention/backup decision is claimed.

## Development skill conformance review — 2026-11-26

Status: Verified after the 2026-11-26 development-skill conformance review. The review changed no feature scope, permissions or HTTP contracts. The audit controller defers query parsing until the service has revalidated current access in its transaction; the repository owns reads and `audit-log.dto.ts` owns the explicit public response mapping.

- [x] Route/controller, service and repository ownership, authorization-before-read/query parsing, and pure public DTO mapping are reconciled with the backend development guidance.
- [x] Final backend `bun run check` passed after the maintenance corrections (89 files, 391 tests; lint, format, typecheck and build included).
- [x] Changed code has readable logical grouping; meaningful regression checks and required quality checks pass.

The original local delivery evidence remains historical; fresh maintenance verification is recorded above.
