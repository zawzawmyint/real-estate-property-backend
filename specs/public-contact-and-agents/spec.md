# Public contact content, agent profiles and agency enquiries

Status: Verified — demo delivery accepted 2026-10-27; real-business publication remains gated.

## Goal

Support public Contact/Agents pages with an explicit public content boundary and property-independent enquiries that enter the existing staff CRM. This is the backend portion of P1-17; frontend design and acceptance live in that repository's `specs/public-contact-and-agents/spec.md`.

## Scope and exclusions

- In scope: a validated backend-owned editorial catalog, anonymous agency/profile reads, published-profile projection, and one additive public enquiry route using existing lead/receipt/activity persistence.
- In scope: exact input contracts, trusted Origin/relay protection, a shared rate budget with property inquiries, replay/concurrency safety and backend/frontend contract synchronization.
- Out of scope: a profile/content CMS, Better Auth schema or role changes, CRM profile editing, uploads, agent-to-property assignment, automatic lead assignment, outbound messaging, new dependencies or a database migration.

## Behavior and contracts

The backend-owned [contract](contract.md) defines the four implemented endpoints: `GET /api/v1/public/agency`, `GET /api/v1/public/agents`, `GET /api/v1/public/agents/:slug`, and `POST /api/v1/public/inquiries`. Content reads are in the public-agency OpenAPI domain; the enquiry route is in the existing lead OpenAPI domain; frontend snapshots/generated declarations and the merged OpenAPI are synchronized.

Keep editorial profiles independent from Better Auth User records. The catalog holds agency-approved public names, titles, plain-text biographies, languages, specialties and optional contact fields. Only published profiles are returned, with a bound of 24 and stable name/slug sorting. No staff ID/login email, owner contact, leads, credentials or unpublished data can appear in public DTOs. Content changes use reviewed source changes/deployment; no runtime staff editor is implied. Curated portrait paths reference coordinated frontend public website assets, not upload storage or cross-repository source imports.

The new enquiry explicitly requires a sale/rent purpose, name, message and at least one valid contact method. Server-controlled source=website, stage=new, assignee=null, creator=null, property/snapshots=null and budget=null are not client-writable. Persist the lead, one created activity and the `agency_inquiry` receipt atomically. Reuse existing lead validation, normalized search fields, safe receipts, transaction handling and staff visibility. Receipt replays return only acknowledgement, never a public Lead DTO or record ID.

Apply existing no-store, exact trusted Origin, relay verification, JSON content type and 16KiB body limits. General and property inquiry routes share one limiter instance/budget per application factory: five attempts per client in 15 minutes, including invalid/replayed attempts after Origin verification. Preserve the existing bounded-map, Retry-After and single-process limitations. No new third-party service or ingress setting was introduced.

Place public content behavior in an agency feature module with explicit route/controller/service/catalog-read responsibilities. Add inquiry behavior to the existing Leads module; do not duplicate a lead store or expose staff routes publicly. Existing property inquiry contracts and staff business rules remain compatible.

## Acceptance criteria

- [x] Public reads return only validated agency data and published profile projections, bounded/stably sorted, with 404 for invalid/unknown/unpublished slugs and safe outage behavior.
- [x] New enquiries create a New/unassigned Website lead with submitted purpose/message and no property; existing manager assignment and Agent ownership work unchanged.
- [x] An identical submission replays safely; changed payload/cross-operation reuse is rejected; concurrent duplicates create only one lead/activity/receipt.
- [x] Input, source/assignee/property injection, Origin/relay, body limits and shared cross-route rate budgets are tested; public responses never expose internal records or submitted contacts.
- [x] Backend-owned OpenAPI, frontend snapshots and generated types agree while existing property/staff contracts remain compatible.
- [x] Required backend quality gates and the cross-repository public-to-CRM browser journey pass before verification.
- [x] No speculative schema/dependency/command change is introduced; no migration, dependency or command change was required.

## Validation

Use disposable databases and catalog fixtures. Test public projection/publication, stable directory bounds, malformed content/slug, safe errors, both purposes, contact/message validation, JSON/Origin/relay boundaries, atomic replay/conflicts and concurrent writes. Test six mixed general/property attempts to prove a shared five-attempt budget, including Retry-After. Verify a resulting lead through authorized staff reads and assignment, then deny another Agent.

Run `bun run check`; run database-specific checks only if implementation changes persistence/configuration. Run frontend generation/drift checks, unit/build gates and the complete desktop/mobile browser suite against the existing disposable fixture. Include Contact/Agents/Profile states and unchanged property inquiry regressions.

## Risks and rollout

No migration was needed: the new receipt operation uses an existing text column. Do not repurpose the existing property inquiry endpoint with a fake property ID or publish an unauthenticated staff-creation endpoint.

The curated catalog requires reviewed deployment to update or withdraw a profile, and has no automatic link to staff activation/role changes. Portrait assets must deploy with matching catalog paths. Use conspicuous fictional demo content until approved real details/portraits are provided. Keep existing trusted ingress/privacy wording requirements for real inquiry collection. Rollback removes public routes and navigation without deleting created leads.

## Implementation evidence

Verified demo evidence: backend `bun run check` passed with 90 tests in 22 files and a production build. The final isolated sequential cross-repository browser suite passed 161 tests with 7 intentional project-specific skips (168 total); a focused desktop/mobile Contact receipt and validation-summary focus fixture passed 4/4. Frontend API drift, lint, formatting, typecheck, 166 unit tests and an isolated production Webpack build passed. Contract AST shapes for both Leads and Public Agency match across repositories. The fictional catalog/direct-contact absence and portrait assets are verified demo behavior; approved real agency facts and publication wording remain an operational gate.

## Review remediation — backend verification, 2026-10-27

- [x] Canonicalize every JavaScript whitespace character in supplied phones to ASCII space, then trim before 3–40-character, allowed-character and digit validation; preserve repeated internal spaces.
- [x] Public/staff lead input and catalog contacts share this policy; stored/search input and receipt hashes use normalized values, with equivalent whitespace submissions replaying without duplicate leads/events.
- [x] Public inquiry persistence reuses one small helper while property and submission locks, operation scopes, guards and transaction boundaries remain unchanged.
- [x] Backend OpenAPI and domain contracts document raw-input normalization and canonical public phone responses accurately.

Backend evidence: the new phone/catalog/contract regression suite first failed all three tests; both whitespace-equivalent public inquiry regressions first returned 400 instead of 201. After implementation, the affected Leads, inquiry, catalog, ownership and concurrency suites passed 33/33 tests in seven files. The final backend quality gate then passed with 94 tests in 23 files, including lint, formatting, TypeScript and production build checks. Backend domain and merged OpenAPI phone schemas agree; frontend snapshot/generation also passed. This remediation adds no schema, migration, backend dependency or command change. The full browser run reported 163 passed, 8 intentional skips and one pointer-cancel test synchronization failure. After correcting the test to wait for settled drop-animation geometry and verify an active drag before Escape, that case passed three consecutive isolated reruns. All 164 applicable browser cases are covered across these runs; a single clean full-suite rerun is not claimed.
