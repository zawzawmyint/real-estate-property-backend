# Inquiry capture and lead management

Status: Verified — delivered and reconciled, 2026-10-26.

## Goal

Persist property inquiries as unassigned leads, let Admin/Manager distribute them, and enforce agent ownership throughout follow-up.

## Scope and exclusions

- In scope: website inquiries, manual creation, scoped list/detail/edit, active-agent assignment, stage changes, append-only notes/call logs, paginated activity, concurrency/idempotency and safe account/property lifecycle behavior.
- Roadmap coverage: P1-03–P1-09, P1-20–P1-22 and P1-16 are verified by this document.
- Out of scope: Kanban, automated routing/notifications, duplicate-person matching, lead merge/delete, calendar/viewings, tasks, analytics, imports/exports, private documents and general audit-log infrastructure.

## Behavior and contracts

The [backend-owned contract](contract.md) defines every endpoint, DTO, validation rule and error. The delivered routes are included in `docs/api/openapi.yaml`; repository-local frontend Markdown/OpenAPI snapshots and generated types are synchronized without companion-source imports.

### Persistence model

Extend `prisma/schema.prisma` with three feature records and a small submission receipt. Use existing SQLite and native Better Auth staff IDs (opaque strings, not assumed UUIDs). New feature IDs are UUIDs; timestamps UTC.

**Lead**

- `id`; `name` required; `phone`, `email` nullable, at least one required; normalized contact search fields.
- `budgetFils` nullable BigInt; fixed AED, sale total or rent annual. `purpose`: sale/rent, required.
- `propertyId` nullable relation to Property, `onDelete: SetNull`; nullable `propertyTitleSnapshot`, `propertyLocationSnapshot` set from backend property data. Keep snapshot when relation is removed; never snapshot private owner data. Relinking replaces snapshots; explicit unlink clears them.
- `source`: website/call/walk_in; `stage`: new/contacted/viewing_scheduled/offer/won/lost, defaults new.
- `assignedAgentId` nullable User relation, `onDelete: SetNull`; `assignedAgentNameSnapshot` retains last name for display/history. A null FK plus nonnull snapshot means removed assignee, treated as unassigned and labelled accordingly. Explicit unassign clears the current snapshot; historical events retain names.
- `createdById` nullable User relation, `onDelete: SetNull`; null for public submission. `originalMessage` nullable immutable plain text, public inquiry only.
- `version` integer initially 1; `createdAt`, `updatedAt`. Every actual lead mutation, note/call append included, increments version and updatedAt atomically.
- Indexes: `(assignedAgentId, createdAt, id)`, `(assignedAgentId, stage, createdAt)`, `(source, createdAt)`, `(updatedAt, id)`, `propertyId`. Normalize name/email/phone/property-title search at write time using current search conventions; substring searches may scan authorized rows but must paginate/count in SQLite, never fetch all rows into Node. Evaluate query plans with realistic fixture sizes before adding indexes that cannot help contains searches.

**LeadNote**

- `id`, `leadId` required relation, `authorId` nullable User relation SetNull, immutable `authorNameSnapshot`, `kind`: note/call, `body`, `createdAt`.
- No update/delete endpoint in this slice. A call log is a manually entered record, not telephony integration. Index `(leadId, createdAt, id)`.

**LeadActivity**

- `id`, `leadId`, `actorId` nullable User relation SetNull, nullable `actorNameSnapshot`, `type`, `createdAt`.
- Explicit optional fields for relevant events: `noteId` unique nullable reference; `previousStage`, `nextStage`; previous/next assignee ID/name snapshots (opaque historical IDs, no live FK); `changedFields` allowlisted field names for detail edits, no before/after contact values.
- Types: created, assigned, unassigned, stage_changed, details_updated, note_added, call_logged. Public actor displays Website; missing former staff displays retained snapshot or Former staff. Initial public/manual creation produces one created event, including initial assignment context for manual self-owned creation. Note/call event references the existing note instead of duplicating its text. Index `(leadId, createdAt, id)`; no cross-lead activity endpoint.

**LeadSubmissionReceipt**

- `id` is client submission UUID with unique constraint; `operation`: inquiry/create/note; `actorScope` server-derived (public or staff ID); `payloadHash` hashes validated canonical input; `leadId`, nullable `noteId`, `createdAt`.
- Receipt and lead/note/event commit in the same transaction. Matching scope/operation/body replays its safe response; mismatches return 409. Staff replay always rechecks current ownership/session before exposing a response. Receipts have no raw contact fields/IPs; retain for this slice, with a later explicit retention policy. No generic background job or Redis dependency.

### Lifecycle and consistency

Lead data must not cascade away when a property or staff member is deleted. New lead relations to User use SetNull; snapshots keep activity readable. Disabled/banned/demoted assignees retain historical assignment but cannot access it; Admin/Manager see an Unavailable agent label and filter by that identity for redistribution. Existing account deactivation workflow must warn/report assigned-lead count in its operator output without silently redistributing; do not change Better Auth credential/session protocols. Revalidate target agent eligibility inside assignment transactions and test assignment/deactivation ordering.

All writes use explicitly mapped fields. Service owns authorization/resource eligibility, concurrency and transaction boundaries; repository owns Prisma queries. Query ownership at write time, not just in route middleware. Expected-version update and activity append succeed together or roll back. Property snapshots are set from backend data; eligible new links must be draft/published and available, purpose must match. Already linked unavailable properties remain readable and need not be removed during unrelated edits.

### Architecture

Delivered module: `src/modules/leads/leads.routes.ts`, `leads.schema.ts`, `leads.controller.ts`, `leads.service.ts`, `leads.repository.ts`, `leads.dto.ts`, and feature-local `inquiry-limiter.ts`. Mount through the existing app composition. Business module layering and native-auth exception remain as documented.

Public inquiry abuse protection: bounded JSON, trusted Origin, feature-local per-client limiter and idempotency. The delivered [public contact and agent contract](../public-contact-and-agents/contract.md) adds property-independent `POST /public/inquiries`; it shares the same limiter instance and five-attempt rolling 15-minute budget with property inquiries. Use configured proxy trust only; never trust arbitrary forwarded IP headers. If the public Server Action relays a client identifier, strip caller-supplied copies at the trusted ingress and specify this trust boundary in deployment docs. Do not derive every visitor's quota from the single frontend server address. Until that boundary is configured and tested, keep real-customer inquiry rollout blocked. No CAPTCHA, external provider or new infrastructure by default.

## Acceptance criteria

- [x] Eligible property inquiry creates one New/unassigned website lead, safe snapshots, event and receipt atomically; public reply reveals no lead data.
- [x] Invalid contact/budget/property inputs, forged ownership/source/actors, unsupported media, missing/foreign Origin and request limits are rejected with the existing safe error envelope.
- [x] Admin/Manager have global lead access; Agent list/count/detail/notes/activity/mutations/replay are scoped to current ownership; unauthorized resource IDs return 404.
- [x] Manual agent creation assigns self; manager creation supports optional active-agent assignment; only Admin/Manager may change assignment.
- [x] Expected-version conflicts prevent lost updates; reassignment between read/write prevents former-agent writes; note/event and mutation/event never partially persist.
- [x] Repeated inquiry/create/note keys recover uncertain responses; changed payload or operation conflicts; concurrent identical submits create one record.
- [x] Search/filter/sort/pagination/count remain bounded, literal and deterministic; phone formatting and Unicode normalization follow contract behavior.
- [x] Account disable/removal and property deletion preserve leads/history while revoking inappropriate access; stale agent assignment targets are refused.
- [x] No private property-owner data, staff email, credentials, raw IP or submitted contact values enter public replies/logs/error messages.
- [x] Approved OpenAPI and frontend snapshots/generated types agree; migrations pass on populated existing SQLite without changing existing property/auth behavior.

## Validation

Add `tests/leads.test.ts`, `tests/lead-ownership.test.ts`, `tests/inquiries.test.ts`, `tests/lead-concurrency.test.ts`; extend migration and staff-operator tests. Test HTTP permission matrix and real SQLite transactions with two agents, Manager/Admin, active/inactive targets and property lifecycle fixtures. Include literal `%`/`_` search, Unicode names, malformed IDs, zero/decimal/excess budgets, nullable fields, event pagination and exact replay mismatch. Inject transaction failure to verify atomic rollback. Test real proxy/Server Action identity forwarding in cross-repository browser fixtures.

Run `bun run check`, `bun run db:check`; frontend full quality checks and desktop/mobile `bun run test:e2e` against backend fixture port 4311. No acceptance marked verified until outputs and browser evidence exist.

## Risks and rollout

Additive schema/routes are delivered. Back up populated SQLite before migration; test upgrade and foreign-key behavior in a disposable copy. Roll back application exposure before DB changes, retain new lead tables/data for recovery, never run a destructive rollback against collected inquiries. Operational owners must approve real-data retention/privacy wording and trusted proxy configuration before production collection.

Delivered choices: manager-distributed inbox; only active Agent users are assignable; either contact method is accepted; AED rent budget is annual; follow-up is append-only; all stages transition; lead deletion is excluded. Verification on 2026-10-26: backend `bun run check` passed with 78 tests in 20 files, and disposable SQLite migration plus `bun run db:check` passed. Cross-repository browser coverage passed (96 tests and 4 existing viewport skips; focused lead flow 18/18). Production collection remains gated by deployment-owner privacy/retention review and trusted ingress configuration.

## Review remediation — backend verification, 2026-10-27

- [x] Canonicalize every JavaScript whitespace character in supplied phones to ASCII space, then trim before 3–40-character, allowed-character and digit validation; preserve repeated internal spaces.
- [x] Public/staff lead input and catalog contacts share this policy; stored/search input and receipt hashes use normalized values, with equivalent whitespace submissions replaying without duplicate leads/events.
- [x] Public inquiry persistence reuses one small helper while property and submission locks, operation scopes, guards and transaction boundaries remain unchanged.
- [x] Backend OpenAPI and domain contracts document raw-input normalization and canonical public phone responses accurately.

Backend evidence: the new phone/catalog/contract regression suite first failed all three tests; both whitespace-equivalent public inquiry regressions first returned 400 instead of 201. After implementation, the affected Leads, inquiry, catalog, ownership and concurrency suites passed 33/33 tests in seven files. The final backend quality gate then passed with 94 tests in 23 files, including lint, formatting, TypeScript and production build checks. Backend domain and merged OpenAPI phone schemas agree; frontend snapshot/generation also passed. This remediation adds no schema, migration, backend dependency or command change. The full browser run reported 163 passed, 8 intentional skips and one pointer-cancel test synchronization failure. After correcting the test to wait for settled drop-animation geometry and verify an active drag before Escape, that case passed three consecutive isolated reruns. All 164 applicable browser cases are covered across these runs; a single clean full-suite rerun is not claimed.

## Current shared-helper ownership

The [shared-code naming maintenance](../shared-code-naming/spec.md) removed the forwarding-only `leads.middleware.ts`. Routes import generic guards directly from `src/shared/http/middleware.ts` and enquiry protection from feature-owned `inquiry-limiter.ts`. Services use `serializedTransaction` from database infrastructure; repositories and search backfills use shared `normalizeSearchText`. Permissions, middleware order, transaction behavior and API contracts remain unchanged.
