---
name: backend-development
description: Use when implementing or changing this repository's Express APIs, business modules, middleware, validation, Prisma persistence, or backend workflows.
---

# Backend development

Deliver small feature slices using the existing backend boundaries and readable grouping. Paths in backticks are relative to the backend root; links resolve from this skill. [AGENTS.md](../../../AGENTS.md) owns rules and checks.

## Read first

Read [spec.md](../../../spec.md), the affected feature spec and [architecture](../../../docs/architecture.md). Before behavior or contract changes, use `specs/_template/spec.md` to define scope, permissions, data shapes, errors and acceptance. Resolve blocking policy questions before implementing dependent behavior. Consult Context7 for library API details as required by AGENTS.md.

## Module responsibilities

Keep working feature code under `src/modules/<feature>/`:

- Routes compose endpoints and named middleware; controllers parse validated HTTP input and shape responses.
- Services enforce business/resource permissions and coordinate transactions without Express request/response objects. Pass actor identity as well as role when ownership matters.
- Repositories own scoped Prisma queries and explicit response selects; pass transaction clients explicitly. Apply permitted record scope before pagination and counts.
- Feature-local schemas, DTOs and middleware support actual behavior. Extract shared helpers for a current need; avoid empty scaffolds, generic base repositories and DI containers.

Use [property routes](../../../src/modules/properties/properties.routes.ts), [service](../../../src/modules/properties/properties.service.ts) and [repository](../../../src/modules/properties/properties.repository.ts) as examples. Future features define their own permissions; property roles do not establish inquiry or lead ownership.

## Request and data boundaries

- Reuse the live session guard in `src/modules/auth/auth.middleware.ts`. Keep transport checks in named middleware and resource/state decisions in services.
- Preserve the property write order: no-store, live staff/role guard, exact Origin, JSON content type, bounded parser, controller validation, service and repository. Public endpoints need their own agreed access policy. Upload preflight checks the resource/state before MIME inspection and body consumption; preserve transaction-time rechecks.
- Strict schemas validate HTTP input. Explicit persistence mappers select permitted fields even for internal callers: never spread `req.body` or arbitrary runtime objects into Prisma. Omit only `undefined`; preserve intentional `null`, `false`, `0` and required conversions. See `toData` in [properties.schema.ts](../../../src/modules/properties/properties.schema.ts).
- Return contracted DTOs/selects, excluding private fields. Reuse `AppError` and safe error envelopes; keep credentials, bodies and private details out of logs.
- Better Auth's native handler, adapter and operator integration are deliberate layering exceptions. Preserve native responses, cookies, body limits and session protections; see [auth.routes.ts](../../../src/modules/auth/auth.routes.ts). Keep public image storage separate from future private documents.

## Readable grouping

Use blank lines between setup, guards/validation, work/persistence and results, and between helper functions or object methods. Keep short dependent operations together. Route files visibly separate composition, middleware setup, route groups and mounting. Preserve execution and middleware order; spacing alone should not change code tokens.

## Verify and reconcile

Add meaningful regression/API tests for changed behavior, including denied permissions, invalid inputs, write allowlists and safe output. Use disposable databases/storage; follow [development](../../../docs/development.md) for database and browser fixtures.

Run `bun run check`. For foundation/database changes, also verify migrations and `bun run db:check` against an intended disposable database. Integration changes need the affected frontend browser flows.

Backend `docs/api/openapi.yaml` owns API changes. Reconcile affected frontend-local contract snapshots/generated types when consumed; never import sibling source. Update specs and operational docs after verification. Follow the frontend-first shared-document policy and final documentation reconciliation in AGENTS.md; leave unverified roadmap items pending.
