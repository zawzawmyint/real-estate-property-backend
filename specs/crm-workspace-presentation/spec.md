# Shared CRM workspace presentation compatibility

Status: Delivered frontend presentation compatibility — 2026-11-03. No backend executable change was made.

## Goal

Record that the delivered Properties, Leads, Tasks and Viewings presentation consumes existing Express contracts without changing authorization, privacy or business rules.

## Scope

Compatibility review only. No endpoint, response, schema, migration, dependency, configuration or operational change. The detailed visual specification and implementation plan are owned by the frontend repository under `specs/crm-workspace-presentation/` and `docs/superpowers/plans/2026-11-03-crm-workspace-presentation.md`.

## User flow

The frontend uses shared visual components for existing property/lead/task lists and the viewing calendar. Existing search timing, filters, assignment, task ordering, scheduling and resource access remain feature-owned.

## Contracts and access

Backend-owned API specifications in `docs/api/` and current feature contracts remain authoritative. Existing `/api/v1/staff/properties`, `/api/v1/staff/leads`, `/api/v1/staff/tasks` and `/api/v1/staff/viewings` behavior remains unchanged. Express independently authorizes every request and preserves role-filtered projections. UI reuse grants no additional access.

## Design

No backend design change. Shared frontend presentation must not assume a new generic record DTO, new aggregate counts or new server search/sort functionality.

## Acceptance criteria

- [x] Delivered frontend changes use existing contracts without backend executable changes.
- [x] Authenticated integration checks retain current role restrictions and resource visibility.
- [x] No newly required API behavior was introduced implicitly.

## Validation

Run frontend API drift validation and disposable-backend browser regressions during implementation. No new backend checks are claimed by this planning artifact. Run relevant backend checks if scope later changes to executable backend work.

## Rollout and risks

No backend rollout, migration or rollback is planned. The main compatibility risk is treating visual mockup controls as unsupported API requirements; existing contracts take precedence.

## Implementation evidence

2026-11-03: The frontend implemented opt-in presentation changes only. Backend routes, OpenAPI, schemas, migrations, dependencies, configuration and operational workflows are unchanged. Disposable-fixture browser coverage exercised the existing staff contracts; backend runtime checks were not required because no backend executable file changed. Native 200% browser zoom remains a frontend tooling limitation.
