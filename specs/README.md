# Feature specifications

Before implementation, create `specs/<feature-name>/spec.md` from `_template/spec.md`. Describe observable behavior, API contracts, permissions and exclusions. Keep acceptance criteria pending until verified. Update the spec when approved behavior changes; reconcile documentation after implementation.

Verified scopes are `project-foundation/spec.md`, `staff-authentication-and-roles/spec.md` and the adopted [business module layering convention](business-module-layering/spec.md). The layering specification establishes future module responsibilities; it does not claim a business feature exists. Each future feature should be delivered and validated independently.

The root [project specification](../spec.md) summarizes project-wide scope and the verified baseline. Keep detailed requirements and acceptance evidence in the feature specs; keep checklist progress in [the roadmap](../ROADMAP.md).

## Verified features

- [Inquiry capture and lead management](lead-management/spec.md): verified persistence, ownership, inquiry capture, assignment and follow-up. [Backend-owned contract](lead-management/contract.md) and delivered [OpenAPI](../docs/api/leads.openapi.yaml).

- [Staff authentication and roles](staff-authentication-and-roles/spec.md): verified staff login/logout, SQLite-backed database sessions and Admin/Manager/Agent identities. Lead ownership is verified in [lead management](lead-management/spec.md).

## Verified current delivery

- [Project review remediation](project-review-remediation/spec.md): verified bounded property-search reads, normalized search-field migration/backfill, and deterministic disposable browser fixtures.

- [Navigation browser-test account isolation](navigation-test-fixture/spec.md): verified disposable desktop/mobile Manager identities for frontend navigation coverage; no production authentication behavior changed.
- [Documentation organization](documentation-organization/spec.md): verified repository-contained shared documentation, local navigation and frontend-first synchronization.
- [Property management and public discovery API](property-management/spec.md): verified persistence, role-enforced lifecycle, photos and public DTOs. [Backend-owned contract](property-management/contract.md).
- [Generated demo property data](demo-property-data/spec.md): verified opt-in, non-production seed data with fictional labelled records and generated illustrative assets.
- [Property route and write-boundary readability](property-route-readability/spec.md): verified named transport and authorization middleware plus explicit property persistence-field selection; no API contract changed.
- [Backend code grouping](backend-code-grouping/spec.md): verified whitespace-only grouping of authored backend TypeScript into readable logical sections; no behavior or API contract changed.
- [Backend development skill and entry](backend-implementation-skill/spec.md): verified repository entry and discoverable guidance for the established backend implementation style; no behavior or API contract changed.

## Verified sales pipeline

- [Sales pipeline integration fixture](sales-pipeline/spec.md): verified dedicated disposable pipeline test accounts and unchanged lead API support for the frontend Kanban.

## Verified public contact and agent pages

- [Public contact and agent pages](public-contact-and-agents/spec.md): verified public content projections and property-independent enquiry capture for P1-17. The [backend-owned contract](public-contact-and-agents/contract.md) defines the APIs; the fictional demo delivery is verified and real-business publication remains gated.

- [2026-10-27 review remediation](public-contact-and-agents/spec.md#review-remediation--backend-verification-2026-10-27): focused maintenance of canonical phone validation and shared public-inquiry persistence; the parallel pipeline announcement evidence remains frontend-owned. It introduces no new roadmap feature or completion count; The full browser run reported 163 passed, 8 intentional skips and one pointer-cancel test synchronization failure. After correcting the test to wait for settled drop-animation geometry and verify an active drag before Escape, that case passed three consecutive isolated reruns. All 164 applicable browser cases are covered across these runs; a single clean full-suite rerun is not claimed.

## Verified naming maintenance

- [Shared-code naming and ownership](shared-code-naming/spec.md): verified shared-helper locations, updated direct imports and property-specific enquiry naming; no new feature or API contract.
