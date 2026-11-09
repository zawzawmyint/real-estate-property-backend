# Feature specifications

## Software design diagrams

| Feature                                                                                              | Flow                                                        |
| ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| [Staff authentication and roles](staff-authentication-and-roles/spec.md#software-design-at-a-glance) | Sign-in and live session checks                             |
| [Property management and discovery](property-management/spec.md#software-design-at-a-glance)         | Draft, photos, publishing and public listing visibility     |
| [Public contact and agents](public-contact-and-agents/spec.md#software-design-at-a-glance)           | Public catalog reads and inquiry handoff                    |
| [Inquiry capture and lead management](lead-management/spec.md#software-design-at-a-glance)           | Inquiry capture, assignment and scoped staff access         |
| [Viewing management](viewing-management/spec.md#software-design-at-a-glance)                         | Booking eligibility, scheduling and status changes          |
| [Follow-up tasks](follow-up-tasks/spec.md#software-design-at-a-glance)                               | Lead-linked task creation, status changes and overdue state |
| [Agency dashboard](agency-dashboard/spec.md#software-design-at-a-glance)                             | Role-scoped lead counts and distributions                   |
| [Property chatbot](public-property-chatbot/spec.md#software-design-at-a-glance)                      | Listing and FAQ routing, models and vector search           |

Start with the [system design](../docs/shared/system-design.md) for the shared architecture. The Sales Pipeline board and chatbot UI diagrams are in the companion frontend repository's `specs/README.md`.

## Verified CRM property matching

- [CRM property matching](property-matching/spec.md): verified P2-03 backend-owned `listLeadPropertyMatches` route. It checks live staff and current lead access in the same SQLite transaction as the read-only, published-and-available public-listing search; it does not write data or call a provider. The operation is documented in [leads OpenAPI](../docs/api/leads.openapi.yaml) and represented by the companion frontend snapshot.

## Verified public property chatbot

- [Public property chatbot](public-property-chatbot/spec.md) and [backend-owned contract](public-property-chatbot/contract.md): verified P2-08 opt-in FAQ retrieval, public listing handoff and bounded OpenRouter calls. The companion frontend snapshot has local property-summary references. Real-business publication remains gated on approved FAQ and visitor-data wording.

## Phase 1 review remediation — implemented; final acceptance pending

- [November review remediation](phase-one-review-remediation/spec.md) and [backend-owned contract](phase-one-review-remediation/contract.md): verified production inquiry relay requirement, transaction-aware shared staff validation and roadmap reconciliation. Backend full checks, clean cross-repository browser/dashboard/runtime acceptance pass; Git-delivery acceptance remains pending.

## Shared CRM workspace presentation — delivered frontend compatibility

- [Frontend presentation compatibility](crm-workspace-presentation/spec.md): Properties/Leads/Tasks/Viewings visual presentation uses existing contracts. No backend executable change was made.

Before implementation, create `specs/<feature-name>/spec.md` from `_template/spec.md`. Describe observable behavior, API contracts, permissions and exclusions. Keep acceptance criteria pending until verified. Update the spec when approved behavior changes; reconcile documentation after implementation.

Verified scopes are `project-foundation/spec.md`, `staff-authentication-and-roles/spec.md` and the adopted [business module layering convention](business-module-layering/spec.md). The layering specification establishes future module responsibilities; it does not claim a business feature exists. Each future feature should be delivered and validated independently.

The root [project specification](../spec.md) summarizes project-wide scope and the verified baseline. Keep detailed requirements and acceptance evidence in the feature specs; keep checklist progress in [the roadmap](../ROADMAP.md).

## Frontend compatibility records

- [Compact CRM property inventory toolbar](crm-property-inventory-toolbar/spec.md): records use of the existing staff property list contract by a frontend-only presentation change. No endpoint, schema, permission or runtime behavior changed.

## Public agency directory languages — delivered

- [Public agency pages redesign support](public-agency-pages-redesign/spec.md) and its [additive contract](public-agency-pages-redesign/contract.md) expose existing public catalog languages in agent summaries for the selected frontend directory. No migration, inquiry behavior or verified completion count changes.

## Verified dashboard

- [Agency dashboard](agency-dashboard/spec.md): verified P1-28–P1-30 authorized aggregates with this [backend-owned contract](agency-dashboard/contract.md), full checks, final 16/16 desktop/mobile browser coverage and visual QA. All active legacy cases passed across two non-clean parallel runs; that limitation is recorded in the feature specification.

## Verified follow-up tasks

- [Follow-up tasks](follow-up-tasks/spec.md): verified P1-26–P1-27 persistence and authorization with the [backend-owned API contract](follow-up-tasks/contract.md). [Implementation plan](../docs/superpowers/plans/2026-10-29-follow-up-tasks.md); backend/frontend quality gates, task reruns and the final legacy regression passed.

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

- [Pull request branch naming](branch-naming/spec.md): locally verified source-branch validation for PRs into main; hosted execution and required-check activation remain pending.

## Verified viewing management

- [Viewing management](viewing-management/spec.md): verified backend-owned appointment contract, persistence and authorization for P1-23–P1-25. [Implementation plan](../docs/superpowers/plans/2026-10-28-viewing-management.md); [OpenAPI contract](../docs/api/viewings.openapi.yaml).
