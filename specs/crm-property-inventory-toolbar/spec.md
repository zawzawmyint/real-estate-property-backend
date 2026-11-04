# Compact CRM property inventory toolbar compatibility

Status: Frontend-only delivery recorded on 2026-11-03; no backend change.

## Goal

Record the existing property inventory contract used by the compact frontend toolbar without creating a duplicate API contract or changing Express behavior.

## Scope and exclusions

- In scope: compatibility confirmation for the existing staff property list filters, authorization and list envelope.
- Out of scope: routes, controllers, services, repositories, Prisma schema/migrations, OpenAPI, configuration, dependencies, runtime behavior and backend tests.

## Behavior and contracts

The backend-owned [property API contract](../property-management/contract.md) remains authoritative. Its existing `GET /api/v1/staff/properties` query supports `q`, `publishingState`, `purpose`, `type`, `availability`, `sort`, `page` and `pageSize`, returning `{items,total,page,pageSize}` under the established current-session role checks. The frontend uses those existing query names to present search, advanced filters, sorting and pagination; no request, response, validation, permission or privacy behavior changed.

## Acceptance criteria

- [x] The frontend toolbar uses the existing staff inventory contract without an endpoint, schema or runtime change.
- [x] Existing Express authorization and role-specific projections remain authoritative.
- [x] No backend migration, configuration, dependency or deployment work is required.

## Validation

Frontend API drift validation, authenticated disposable-fixture browser coverage and the restored normal-runtime inspection passed as recorded in the frontend feature specification. This compatibility record introduces no backend executable change or backend-specific validation run.

## Risks and rollout

No backend rollout or rollback is needed. Any future staff inventory query/API change must update the property API contract and OpenAPI independently; it must not be inferred from this frontend presentation record.
