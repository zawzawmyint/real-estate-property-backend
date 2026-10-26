# Backend project specification

Status: Project overview. Foundation, staff authentication/roles, property management, public discovery APIs and demo data are verified.

## Purpose and scope

Provide the agency's independently versioned Express API, owning business rules, authorization, persistence and file storage for the public website and internal CRM. Deliver one verified feature slice at a time. Client portal and private-document capabilities remain later, optional work.

This file defines project-wide scope and boundaries and indexes existing specifications. Detailed behavior, contracts and acceptance criteria belong in feature specs; this overview does not replace them or mark planned features delivered.

## Verified baseline

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

Leads, inquiries, viewings and reporting are not implemented. This delivery has no lead ownership rules. The [property-management specification](specs/property-management/spec.md) and [contract](specs/property-management/contract.md) describe the delivered API.

The [project review remediation](specs/project-review-remediation/spec.md) verifies SQLite-side literal Unicode search/count/pagination with bounded application reads, normalized search-field migration/backfill, and default fictional media in disposable browser fixtures. API contracts, roles and roadmap scope are preserved.

## Planned product scope

Remaining backend work includes inquiry capture, lead creation and follow-up, assignment and ownership permissions, pipeline, viewing, task and reporting workflows. Later enhancements and the optional client portal remain subject to the roadmap.

Staff authentication and Admin/Manager/Agent identities, property management and public discovery APIs are already delivered within the verified baseline above. Resource ownership for future leads remains separate work; existing staff roles do not establish that policy.

The [roadmap](ROADMAP.md) owns checklist IDs and progress. The [authentication feature spec](specs/staff-authentication-and-roles/spec.md) is verified for P1-01 and the identity portion of P1-02. It defines staff provisioning. Verify agent-owned lead access separately when lead records and routes exist.

The auth implementation uses Better Auth 1.7.12's native server handler in Express with a Better Auth React client in Next.js. SQLite is the only database for this delivery. No PostgreSQL provider/driver, migrations or compatibility tests are included; any future database migration is separate work.

## Architecture, contracts and access

- Business features follow feature-local routes -> controller -> service -> repository -> Prisma, with service-owned workflows/permissions and transaction coordination. The properties module implements this [adopted convention](specs/business-module-layering/spec.md). Better Auth remains native and is exempt from these business layers.
- Express owns persistence, validation, business rules, permissions and storage. The frontend consumes the API and never imports backend source.
- The [OpenAPI contract](docs/api/openapi.yaml) owns implemented HTTP contracts. Define schemas, validation, errors and permissions alongside each new endpoint.
- Health is liveness, not database readiness or proof of staff authorization.
- Public responses must exclude private owner details and staff-only lead data. Enforce permissions on the server when the corresponding feature is delivered.
- SQLite and local public-image storage are current choices. PostgreSQL and S3 are deferred migrations; private documents need separate authorized storage and delivery.
- Define session lifecycle, browser/proxy behavior and authenticated server requests in the authentication specs before implementation.

## Specification and documentation ownership

- This `spec.md`: project purpose, boundaries and verified-baseline summary.
- [Feature specs](specs/README.md): detailed requirements, contracts, acceptance and evidence; use the existing template.
- [ROADMAP.md](ROADMAP.md): feature progress; [TECH_STACK.md](TECH_STACK.md): installed and deferred tools.
- [README.md](README.md) and [development guide](docs/development.md): setup and operational commands.
- [AGENTS.md](AGENTS.md): contribution instructions; [architecture](docs/architecture.md): implemented technical boundaries.

Keep this overview current as features are verified. Do not duplicate full feature requirements here. If documents disagree, reconcile them before implementation; do not silently override a feature contract. Shared documents use the frontend-first synchronization policy; this project-specific spec is maintained independently of the frontend root spec. The [homepage mockup](docs/design/homepage-maroon-ivory-charcoal.png) records frontend design direction, not backend functionality.

## Validation

Use feature-specific acceptance checks and the repository quality commands documented in [AGENTS.md](AGENTS.md). The auth slice passed backend quality checks, real SQLite migrations and cross-repository browser/lifecycle validation recorded in its feature specification.
