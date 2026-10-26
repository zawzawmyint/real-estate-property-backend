# Business module layering

Status: Adopted and verified on 2026-10-22. This is a documented delivery convention, not a business-module implementation.

## Goal

Establish predictable controller, service and repository responsibilities for agency business modules while retaining Better Auth's native authentication implementation.

## Scope and exclusions

- In scope: repository contribution rules, architecture/development guidance, project specification and shared stack/workspace guidance.
- Business modules use feature-local routes, controllers, services, repositories and Zod request schemas as those modules are delivered.
- Out of scope: new property/lead endpoints, empty scaffolding, generic base repositories, dependency injection containers, database migrations or rewritten authentication handlers. Existing health and public-media infrastructure are not agency business modules.

## Behavior and contracts

- Routes declare endpoints and middleware, including live authentication/role checks.
- Controllers translate validated HTTP input into service calls and serialize responses/errors. They do not query Prisma or implement business workflows.
- Services enforce business rules, resource permissions and workflows, and coordinate transaction boundaries across repositories. They do not depend on Express request/response objects.
- Repositories contain feature-specific Prisma queries and persistence mappings. They do not own HTTP responses or make independent authorization policy decisions. Transaction-scoped clients may be supplied explicitly where a service coordinates atomic work.
- Prefer small explicit functions/interfaces and ordinary composition. Add these files when an actual business feature needs them; do not add pass-through layers solely to populate a directory.
- Better Auth retains its native endpoints, Prisma adapter and current auth hooks/operator lifecycle. Do not reimplement credential/session logic behind custom business controllers/repositories. Document this deliberate exception.
- No HTTP/data/permission contracts change in this documentation slice. SQLite remains the only database. P1-03 lead ownership remains pending.

## Acceptance criteria

- [x] Backend AGENTS.md, root spec and architecture/development guidance describe consistent layer ownership and transaction handling.
- [x] Shared guidance/tooling docs agree with the convention and explicitly retain native Better Auth.
- [x] Docs distinguish an adopted convention from business modules that do not yet exist.
- [x] No empty modules, extra endpoints, migrations or auth protocol changes are introduced.
- [x] Markdown links/formatting and backend checks pass; frontend form integration continues using the native auth contract.

## Validation

Affected guidance contains no contradictory direct-query instruction. Local Markdown links and formatting were reviewed. Backend `bun run check` passed with 34 tests across 11 files; frontend `bun run check` passed with 39 tests; the real SQLite-backed browser suite passed 28 desktop/mobile tests. The native auth contract snapshots remain byte-identical.

## Risks and rollout

An unnecessary layer can obscure small flows. Keep feature-specific responsibilities concrete and avoid generic abstractions. Deliver actual business module implementations under their own feature specs; this change documents the convention only. No database migration or deployment is required for this slice.
