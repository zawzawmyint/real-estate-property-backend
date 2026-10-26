# Property management and public discovery API

Status: Verified on 2026-10-22.

## Goal

Provide the first business flow: staff creates a property, attaches photos and publishes a privacy-safe listing for public discovery. Express owns persistence, permissions, publishing rules, validation and image storage; frontend owns the agreed Property Finder-inspired Avenor interface.

## Scope and exclusions

- In scope: P1-11/P1-12/P1-13 property management, bounded image uploads, public filtered listings/detail, featured query support and explicit public/staff DTOs.
- Frontend uses the maroon/ivory/charcoal homepage reference, simple search, photographic cards, a gallery detail and a practical CRM table/form. shadcn/ui Base Nova reuse is specified in its corresponding feature spec.
- Out of scope: inquiry/lead records, property-agent assignment, saved favourites, maps, private documents, contact/agent management, bulk operations and PostgreSQL/S3 migration. P1-19 seed data is specified separately in `../demo-property-data/spec.md`.

## Behavior and contracts

### Ownership and module structure

The [contract](contract.md) is the authoritative property API narrative. `docs/api/openapi.yaml` is the implemented HTTP contract; the frontend keeps its snapshot and generated types in sync with it.

Create real code under `src/modules/properties/`: routes -> controller -> service -> repository -> Prisma. Routes attach live `requireStaff` guards, origin checks and body limits. Controller parses HTTP; service enforces workflows and resource access; repository uses explicit Prisma selects. Add feature-local schema and DTO helpers when needed, not a generic repository or DI framework. Mount through `src/app.ts`; reuse existing auth/error/storage infrastructure without rewriting Better Auth.

### Proposed access

- Anonymous: public eligible listings/detail only, with allowlisted public fields.
- Agent: staff inventory/details without owner name/phone; cannot mutate any property or photo.
- Manager: all staff property fields and create/edit/upload/reorder/publish/unpublish/archive/restore; cannot permanently delete.
- Admin: Manager capabilities plus permanent deletion of archived properties.
- Current database session and current role are checked on every protected request. Mutations require exact `Origin === APP_ORIGIN` before processing body bytes; fail closed for missing/null/untrusted Origin. Return business 401/403 envelopes, preserving native auth responses on auth routes.
- No property ownership restriction is implied by lead ownership P1-03. Staff user management remains the trusted operator workflow.

### Persistence and lifecycle

- Add `Property` and `PropertyPhoto` models and a real SQLite migration without replacing existing auth tables. Field constraints and API representations are pinned in the contract; database money is integer fils and area integer hundredths of sqft.
- Property carries opaque UUID, timestamps, title, purpose, type, description, price, city/community, bedroom/bath counts, area, publishing state, availability, featured flag and private owner contact. `PropertyPhoto` owns UUID, property FK, generated storage key and integer ordering position.
- Create as draft with title/purpose. Draft fields may be incomplete but supplied values must be valid. Publishing requires the complete field set and at least one attached photo. Published edits remain publicly visible immediately and must continue satisfying completeness.
- Publishing state is `draft | published | archived`; availability is `available | sold | rented`. Sold is sale-only; rented is rent-only. Public eligibility is exactly published AND available. Marking sold/rented hides fresh public reads without changing publishing state.
- Archive hides a property while preserving fields/photos. Restore means draft, never automatic republishing. Archived records cannot otherwise be edited or receive photo uploads. Hard delete requires Admin and archived state; missing records return 404.
- Transitions to draft/published/archived occur through PATCH with explicit rules. Draft->archived and published->archived are valid. Archived->draft is valid; archived->published is rejected. No direct state change to erase a published listing without backend checks.
- Transactions protect max-photo count, last-photo removal, complete photo ordering and publishing eligibility under concurrent requests. Ordinary scalar field edits use last committed write wins; UI warns that published edits go live and does not auto-retry writes after ambiguous failures. No revision-history subsystem.
- Add indexes for public eligibility, purpose/type/location as justified by list queries; stable sort always uses ID as tie-breaker. Public search never queries owner fields.

### Photo pipeline and storage

- One raw JPEG/PNG/WebP per upload, max 5 MiB (5,242,880 bytes), max 25 million decoded pixels, max 12 photos/property. Check session, role, property existence/state and trusted Origin before buffering. Enforce streamed and declared byte limits; global JSON remains 100 KiB.
- `sharp` 0.35.5 decodes actual content, rejects malformed/animated/SVG input, normalises orientation, strips metadata and re-encodes WebP capped at 2400px longest side without enlargement. Declared MIME must match decoded input format. Do not trust extension or client filename.
- Save through existing `Storage.save`, `.delete` and `.resolveUrl`; never accept arbitrary storage keys or remote image URLs from clients. First ordered photo is cover. Photo mutations confirm property membership.
- Save file before DB attachment; on attachment failure remove the unreferenced file. Commit DB photo removal/deletion before deleting files. A cleanup failure must not resurrect records or expose filesystem details: log generated key/request ID and provide a documented retry/reconciliation procedure in `docs/development.md` during implementation.
- A crash can leave orphan public files; reconciliation compares DB keys and storage files in a maintenance window after backup, never deletes referenced files, and has a dry-run step. No speculative background job framework is required.
- Existing `/media/:key` serves public listing assets, including draft photos by direct URL. Hide listings via API filtering; do not claim archival revokes shared files. Private documents are excluded. Include this disclosure in the upload UI.

### Errors, read behavior and rollout

Business errors keep `{error:{code,message,requestId}}`. Validation returns 400 `VALIDATION_ERROR`; field-level messages may be mapped from the failing input locally without changing the shared envelope. All property responses use `Cache-Control: no-store`, including public responses initially, so fresh requests reflect visibility changes. Distinguish 404 from infrastructure 500/503; no fallback fake listing responses. See contract for exact request/response cases and bounds.

## Acceptance criteria

- [ ] Real SQLite migration creates property/photo persistence without damaging users/sessions; records survive restart.
- [ ] Every protected operation applies current-role/session and trusted-origin policy. Agent never receives owner contact; anonymous visitors never receive staff DTO fields.
- [ ] Create/update/archive/restore/delete follow the proposed role/lifecycle rules and exact contract, including invalid transition/unknown field rejection.
- [ ] Publish and public eligibility work across list/detail/featured queries; public DTOs have explicit selects and exclude private fields in success/error responses.
- [ ] Filters combine safely, pagination/sort are deterministic and invalid values return 400 rather than broadening search.
- [ ] Upload validation/bounds, complete ordering, cover changes, last-photo protection, membership checks and compensation pass, including concurrency and storage/DB failures.
- [ ] OpenAPI and frontend snapshot/types agree with runtime; backend `bun run check`, `bun run db:check` and cross-repository browser smoke tests pass.
- [ ] Operational cleanup, backups, new installed tools and verified delivery evidence are reconciled; no business feature is marked delivered from specs alone.

## Validation

- Service tests for state transitions, publish completeness, monetary/area boundaries, availability-purpose compatibility and role matrix.
- Supertest + real temporary SQLite/media directories: all routes/roles, revoked/disabled sessions and role changes, strict filters, privacy allowlists, malformed JSON, invalid Origin and declared/chunked oversized image streams.
- Image tests use actual tiny valid/invalid files, corrupt headers/content, metadata removal, dimension/animation rejection and mismatched MIME. Exercise cross-property photo IDs, concurrent 12-photo limit/publish/remove, failed save/attachment/delete and recoverable orphan cleanup.
- Migration test starts from existing auth schema; verify existing staff still logs in. Run `bun run check` and `bun run db:check` against an isolated migrated database, then desktop/mobile frontend integration on ports 3100/4311.

## Risks and rollout

The role matrix, AED/year/sqft units, draft lifecycle and Admin-only archived deletion are implemented product decisions. The design remains a reference and does not authorise unrelated Property Finder features.

Deploy the backend migration before the frontend; generated frontend types must not require sibling source imports. Do not commit runtime databases/uploads or generated build assets. Roll back application/database/media as one compatible snapshot after evaluating data written since backup. Disk cleanup is eventually recoverable, not an atomic DB/filesystem transaction.

Implementation evidence: backend `bun run check` passed (56 tests in 13 files), and three migrations plus property-aware `db:check` passed against an isolated database. Frontend lint, typecheck, API drift check and 51-unit-test run passed; its production Webpack build passed. The final browser run passed 40 desktop/mobile checks, including 12 property checks.
