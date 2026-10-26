# Repository-contained shared documentation

Status: Verified

## Goal

Keep the project roadmap, technology inventory, shared workspace records, and selected homepage mockup available in a standalone backend repository clone.

## Scope and exclusions

- In scope: a synchronized backend copy of shared documentation, a root project specification at [spec.md](../../spec.md), repository-local links from the backend README and contributor guidance, and the frontend-first synchronization rule.
- Out of scope: Express behavior, OpenAPI changes, persistence, configuration, authentication, permissions, and roadmap feature delivery.

## Behavior and contracts

This change adds no routes, inputs, outputs, errors, access rules, or persistence. Backend-owned API contracts remain in [docs/api/openapi.yaml](../../docs/api/openapi.yaml); backend feature specifications remain authoritative for backend work. The selected mockup at [docs/design/homepage-maroon-ivory-charcoal.png](../../docs/design/homepage-maroon-ivory-charcoal.png) is a design reference, not implemented behavior.

## Acceptance criteria

- [x] A backend clone contains `ROADMAP.md`, `TECH_STACK.md`, `docs/shared/`, the root `spec.md`, and the selected design mockup without requiring a sibling repository.
- [x] The root `spec.md` distinguishes the verified foundation from planned API and business capabilities and links detailed requirements to feature specifications.
- [x] The backend README and AGENTS guidance link only to repository-local shared documentation.
- [x] The synchronized roadmap retains checklist IDs and does not claim pending product features are complete.
- [x] The documentation states that frontend is the editing source and backend is reconciled in the same delivery.

## Validation

- Verified every relative Markdown target in the backend repository resolves to an existing file.
- Formatted the changed Markdown with the repository's Prettier installation.
- Confirmed the synchronized shared-document files and mockup exist at their documented backend paths.
- Confirmed the root project specification, README, AGENTS guidance, and specification index link to one another using repository-local paths.

## Risks and rollout

No application rollout or database migration applies. Duplicate shared documentation can drift; edit the frontend copy first and synchronize the backend copy before completion.

## Implementation evidence

- 2026-10-22: Shared documents were added to `ROADMAP.md`, `TECH_STACK.md`, `docs/shared/`, and `docs/design/`; README and AGENTS navigation links were updated.
- 2026-10-22: Added the repository-root project specification as an index for verified foundation scope, planned capabilities, architecture and access boundaries, and feature-spec ownership.
- 2026-10-22: Markdown path validation and Prettier formatting completed for the relocated backend documentation.
