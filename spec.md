# Backend project specification

Status: Project overview. Foundation, staff authentication/roles, property management, public discovery APIs and demo data are verified.

## Verified P2-07

The [agent performance reporting specification](specs/agent-performance-reporting/spec.md), [backend-owned contract](specs/agent-performance-reporting/contract.md) and [implementation plan](docs/superpowers/plans/2026-11-18-agent-performance-reporting.md) verify the read-only `GET /api/v1/staff/reports/agent-performance` report. It uses Dubai date windows, role-scoped historical aggregates, provable assignment attribution, first-ever Won credit, recorded follow-up cohorts and explicit coverage limits. Backend quality gates passed with 310 tests in 65 files; frontend quality gates passed API parity, lint, format, typecheck, 440 tests in 62 files and build. Separate clean serial desktop/mobile projects accounted for all 508 discovered browser cases with zero failures; a separate dashboard fixture passed 16/16. No deployment, normal-database migration or native Safari verification is claimed.

## Verified P2-05

The [lead duplicate detection specification](specs/lead-duplicate-detection/spec.md), [backend-owned contract](specs/lead-duplicate-detection/contract.md) and [implementation plan](docs/superpowers/plans/2026-11-16-lead-duplicate-detection.md) verify permission-scoped phone matching, explicit acknowledgement, historical backfill and CSV v2 compatibility. Patched frontend/backend checks, disposable migration verification, runtime inspection, responsive/native-zoom review and the final clean serial browser run passed. No deployment or normal-database migration is claimed.

## Verified P2-06

The [lead temperature tags specification](specs/lead-temperature-tags/spec.md), [backend-owned contract](specs/lead-temperature-tags/contract.md) and [implementation plan](docs/superpowers/plans/2026-11-17-lead-temperature-tags.md) verify manual staff temperature, default `unassessed`, scoped list/pipeline/export filtering and activity history. Backend final `bun run check` passed lint, formatting, typecheck, 285 tests in 61 files and production build; the resumed disposable `bun run db:check` passed. Frontend final checks/build passed. The browser matrix covers all 486 current tests exactly once: 419 passed and 67 expected skips, with no failures/missing/unexpected/duplicates. It combines a November 17 interrupted run and the November 18 resumed fresh-fixture run, and is not represented as one uninterrupted clean run. Responsive/native-zoom/keyboard review and the November 18 runtime inspection passed. No deployment or normal-database migration is claimed.

## Purpose and scope

Provide the agency's independently versioned Express API, owning business rules, authorization, persistence and file storage for the public website and internal CRM. Deliver one verified feature slice at a time. Client portal and private-document capabilities remain later, optional work.

This file defines project-wide scope and boundaries and indexes existing specifications. Detailed behavior, contracts and acceptance criteria belong in feature specs; this overview does not replace them or mark planned features delivered.

## Verified baseline

- P2-04 is verified through authenticated lead/property CSV export and Admin/Manager all-or-nothing imports. Each export service validates current staff inside its bounded selection transaction; explicit role-specific projections protect Agent owner details. The [CSV import/export specification](specs/csv-import-export/spec.md) and [backend-owned contract](specs/csv-import-export/contract.md) define the historical export slice. The verified [property import specification](specs/property-import/spec.md) and [lead import specification](specs/lead-import/spec.md) define property-draft and New/unassigned/unlinked lead imports with durable aggregate receipts. Duplicate detection remains separate P2-05.

- The [CRM notifications](specs/crm-notifications/spec.md) feature verifies P2-02 with recipient-scoped persistent inbox rows, idempotent reads and payload-free SSE invalidation for lead assignment/reassignment. Viewing changes, due-task reminders and staff website-inquiry alerts are verified supplemental producers. It uses an additive SQLite migration, a startup-wired in-process signal adapter and an earliest-due-first, 100-candidate reminder scan; Redis fanout, email delivery and deployed-ingress verification remain future work.

- The [CRM property matching](specs/property-matching/spec.md) feature verifies P2-03 locally: `listLeadPropertyMatches` authorizes live staff and current lead access in the same SQLite transaction as an available, published public-listing search. Its additive read-only contract is in the leads OpenAPI document and the matching frontend snapshot. No migration, provider or extraction path is included; backend checks, integration coverage and OpenAPI parity passed. Deployment remains pending.

- The [shared CRM workspace presentation compatibility record](specs/crm-workspace-presentation/spec.md) confirms the delivered frontend-only collection/calendar styling uses existing staff contracts. No Express route, schema, migration, configuration, dependency or authorization change was made; native 200% browser zoom remains frontend-owned and unresolved.

- The [public agency directory-languages projection](specs/public-agency-pages-redesign/spec.md) is delivered as a backward-compatible summary field for the public agency-page redesign. It changes no persistence, authentication, inquiry or assignment behavior; native 200% browser-zoom verification remains frontend-owned and unresolved.

- The [pull request branch naming workflow](specs/branch-naming/spec.md) is locally verified for PRs into main. GitHub-hosted execution and required-check activation remain pending.

- Dedicated disposable desktop/mobile pipeline Manager and Agent identities isolate browser sign-in budgets. The frontend Kanban reuses existing lead APIs and permissions; this delivery adds no production API or schema change. See the verified [sales-pipeline integration fixture](specs/sales-pipeline/spec.md).

- Express application factory, health endpoint, structured errors, request IDs, validated configuration and logging.
- Prisma/SQLite connection verification and Better Auth User, Session, Account and Verification schema migrations.
- Local storage adapter, public image delivery and validated public-property uploads; no private-document storage.
- Independent tooling, CI and validation commands. See the [foundation specification](specs/project-foundation/spec.md) for recorded evidence.
- Repository-contained shared documents and mockup. See [documentation organization](specs/documentation-organization/spec.md).
- Better Auth 1.7.12 staff authentication, trusted operator lifecycle commands, and Admin/Manager/Agent session identities. See the [staff authentication and roles specification](specs/staff-authentication-and-roles/spec.md).
- Property and PropertyPhoto persistence, role-enforced lifecycle/photo APIs, public listing/detail APIs and public WebP image delivery. See the [property-management specification](specs/property-management/spec.md).
- Property routes use named transport/authentication middleware, and property persistence input is explicitly selected before database writes. See the [property route and write-boundary readability specification](specs/property-route-readability/spec.md).
- An explicit local/demo seed command for 15 fictional, labelled listings and generated illustrative images. See the [demo-property-data specification](specs/demo-property-data/spec.md).
- Disposable Manager identities support the frontend desktop/mobile navigation browser suite without changing production authentication or authorization behavior. See the [navigation test-fixture specification](specs/navigation-test-fixture/spec.md).

Public inquiries and staff lead management are implemented with role-enforced ownership, optimistic versioning, receipts and append-only activity. See the [lead-management specification](specs/lead-management/spec.md) and [backend-owned API contract](docs/api/leads.openapi.yaml).

The [project review remediation](specs/project-review-remediation/spec.md) verifies SQLite-side literal Unicode search/count/pagination with bounded application reads, normalized search-field migration/backfill, and default fictional media in disposable browser fixtures. API contracts, roles and roadmap scope are preserved.

The [November 5 Phase 1 review remediation](specs/phase-one-review-remediation/spec.md) verifies signed-only production inquiry ingress and transaction-scoped current-staff validation. Backend full checks, clean cross-repository browser/dashboard/runtime acceptance pass; Git-delivery acceptance remains open, and P1-14/P1-18 remain unchecked.

## Planned product scope

Viewing and task workflows are verified. Reporting remains future work. The frontend pipeline is verified against the existing lead API. Later enhancements and the optional client portal remain subject to the roadmap.

The verified [public contact and agent pages specification](specs/public-contact-and-agents/spec.md) additionally records the public editorial content boundary and property-independent enquiries into existing lead persistence. Its [contract](specs/public-contact-and-agents/contract.md) is implemented. The fictional demo delivery is complete; real-business publication remains an operational content/approval gate.

The 2026-10-27 review remediation retains the existing API, permissions, schema and delivery scope while canonicalizing phone whitespace before validation/search/receipt hashing and preserving separate property/context and submission locks around shared public-inquiry persistence. The affected feature specs record completed focused evidence. The full browser run reported 163 passed, 8 intentional skips and one pointer-cancel test synchronization failure. After correcting the test to wait for settled drop-animation geometry and verify an active drag before Escape, that case passed three consecutive isolated reruns. All 164 applicable browser cases are covered across these runs; a single clean full-suite rerun is not claimed.

Staff authentication and Admin/Manager/Agent identities, property management, public discovery APIs and lead ownership are delivered within the verified baseline above.

The [roadmap](ROADMAP.md) owns checklist IDs and progress. The [authentication feature spec](specs/staff-authentication-and-roles/spec.md) is verified for P1-01 and the identity portion of P1-02. The [lead-management specification](specs/lead-management/spec.md) verifies ownership and delivery of P1-03–P1-09, P1-20–P1-22 and P1-16.

The auth implementation uses Better Auth 1.7.12's native server handler in Express with a Better Auth React client in Next.js. SQLite is the only database for this delivery. No PostgreSQL provider/driver, migrations or compatibility tests are included; any future database migration is separate work.

## Architecture, contracts and access

- Business features follow feature-local routes -> controller -> service -> repository -> Prisma, with service-owned workflows/permissions and transaction coordination. The properties module implements this [adopted convention](specs/business-module-layering/spec.md). Better Auth remains native and is exempt from these business layers.
- Express owns persistence, validation, business rules, permissions and storage. The frontend consumes the API and never imports backend source.
- The [OpenAPI contract](docs/api/openapi.yaml) owns implemented HTTP contracts. Define schemas, validation, errors and permissions alongside each new endpoint.
- Health is liveness, not database readiness or proof of staff authorization.
- Public inquiry responses exclude lead data; staff lead data remains role-scoped and excludes property-owner details, staff email and receipt material.
- SQLite and local public-image storage are current choices. PostgreSQL and S3 are deferred migrations; private documents need separate authorized storage and delivery.
- Define session lifecycle, browser/proxy behavior and authenticated server requests in the authentication specs before implementation.
- Viewing management is verified. It adds the backend-owned `/api/v1/staff/viewings` contract, additive SQLite persistence and current-lead-assignment authorization; see [the feature specification](specs/viewing-management/spec.md) and [OpenAPI contract](docs/api/viewings.openapi.yaml). Booking never changes lead stage or inquiry property.
- Follow-up tasks are verified at `/api/v1/staff/tasks` with additive SQLite persistence, current-lead-assignment authorization, versioned writes, durable creation receipts and server-derived overdue state; see [the feature specification](specs/follow-up-tasks/spec.md) and [OpenAPI contract](docs/api/tasks.openapi.yaml). Backend checks, task-focused browser evidence and the final unchanged serial legacy browser regression passed; P1-26/P1-27 are checked off. Reporting remains future work.
- The verified [agency dashboard](specs/agency-dashboard/spec.md) completes P1-28–P1-30 with a read-only `/api/v1/staff/dashboard` aggregate, one authorized SQLite snapshot, no-store responses and no lead records. Its [contract](specs/agency-dashboard/contract.md) and [OpenAPI definition](docs/api/dashboard.openapi.yaml) are implemented. Backend/frontend full checks, final 16/16 dashboard browser coverage and visual QA passed; the feature specification records the separate non-clean legacy-run limitation.

## Specification and documentation ownership

- This `spec.md`: project purpose, boundaries and verified-baseline summary.
- [Feature specs](specs/README.md): detailed requirements, contracts, acceptance and evidence; use the existing template.
- [ROADMAP.md](ROADMAP.md): feature progress; [TECH_STACK.md](TECH_STACK.md): installed and deferred tools.
- [README.md](README.md) and [development guide](docs/development.md): setup and operational commands.
- [AGENTS.md](AGENTS.md): contribution instructions; [architecture](docs/architecture.md): implemented technical boundaries.

Keep this overview current as features are verified. Do not duplicate full feature requirements here. If documents disagree, reconcile them before implementation; do not silently override a feature contract. Shared documents use the frontend-first synchronization policy; this project-specific spec is maintained independently of the frontend root spec. The [homepage mockup](docs/design/homepage-maroon-ivory-charcoal.png) records frontend design direction, not backend functionality.

The verified [shared-code naming maintenance](specs/shared-code-naming/spec.md) aligns reusable infrastructure and UI names with their actual ownership. All callers use the new module paths directly; business behavior, API contracts, permissions and roadmap completion states are unchanged.

## Validation

Use feature-specific acceptance checks and the repository quality commands documented in [AGENTS.md](AGENTS.md). The auth slice passed backend quality checks, real SQLite migrations and cross-repository browser/lifecycle validation recorded in its feature specification.
