# Backend architecture

## Boundaries

The frontend calls Express; Express owns validation, permissions, business rules and persistence. The application factory (`src/app.ts`) can be tested without a listener; `src/server.ts` owns HTTP startup, request timeouts and bounded SIGINT/SIGTERM shutdown. The health route is liveness, not database readiness.

Agency business modules belong in `src/modules/<feature>/` and follow routes -> controller -> service -> repository -> Prisma. Routes declare endpoints and compose named middleware in observable order. The properties routes use `noStore`, live staff/role authorization, exact Origin checking, JSON content-type checking and bounded parsing; photo uploads check the target resource and its state before inspecting the MIME type or reading the body. Controllers translate HTTP input/output without querying Prisma. Services own business rules, resource permissions and workflows; they coordinate transactions across repositories without Express request/response dependencies. Repositories own feature-specific queries and persistence mappings, and accept a transaction-scoped client when a service needs atomic work.

Use small explicit functions/interfaces and ordinary composition. The `properties` module follows these layers for staff lifecycle/photo operations and public discovery. Its write mapper selects each allowed field before persistence, so runtime objects cannot introduce database fields despite their TypeScript type. Avoid empty scaffolds, generic base repositories and dependency injection containers. The leads module follows the same layers for inquiries, ownership, receipts and activity. See the [layering specification](../specs/business-module-layering/spec.md), [property route readability specification](../specs/property-route-readability/spec.md) and [lead-management specification](../specs/lead-management/spec.md).

Better Auth deliberately retains its native endpoints, Prisma adapter, hooks and trusted operator integration. Do not wrap or reimplement credential/session operations to fit business-module layers. Health and public-image delivery are infrastructure rather than agency business modules. Shared infrastructure currently consists of configuration, logging, error handling, the database factory and public image storage.

## HTTP

Default API origin is `http://localhost:4311`; health is `/api/v1/health`. Each response carries a server-generated `X-Request-Id`. Errors have `{ error: { code, message, requestId } }`. Unknown failures always hide internal details, including in development responses. Logs include correlation ID, method, response status and duration, without URLs, request bodies or credentials. Header redaction provides defense if structured headers are added later.

Helmet provides baseline response headers; business JSON bodies are limited to 100 KB. The native Better Auth boundary allows only sign-in, get-session and sign-out, bounds auth bodies to 100 KiB before native parsing, preserves native responses and Set-Cookie headers, and applies origin, throttling and current-database-session checks. Admin, Manager and Agent are identities only in this slice; future resource routes must use the live guard and define their own permissions. No permissive CORS policy is enabled.

## Database

Prisma 7.10.1 is pinned to a stable version rather than the registry's Prisma 8 release-candidate tag. `prisma.config.ts` defines SQLite and generation paths. `createDatabase` owns adapter construction; callers own disconnecting. The liveness app does not open a database unnecessarily. `db:check` proves the real Prisma/SQLite connection with `SELECT 1`.

Paths use the backend working directory as the base. The committed Prisma migrations create Better Auth's SQLite User, Session, Account and Verification tables, including additive credential-version fields used to invalidate reset races, plus Property, PropertyPhoto, Lead, LeadNote, LeadActivity and LeadSubmissionReceipt tables. Moving to PostgreSQL requires provider-compatible schema/migrations and data transfer; it is not a configuration-only operation.

## Storage

The `Storage` interface saves buffers, deletes keys and resolves public URLs. The local adapter generates UUID image keys, writes exclusively to its configured root, validates a flat image-key allowlist and rejects symbolic links when resolving/deleting files. `GET /media/{key}` serves those public assets with an intentional cross-origin resource policy so the separate frontend can display them. Property uploads accept one validated JPEG, PNG or WebP, normalise it to WebP and attach generated keys only after access/state checks. Missing/unsafe keys return 404; unexpected storage I/O returns a safe 500.

All stored files are public images; private documents must use a separate authorized storage design. Keep the storage directory writable only by the application/operator. The adapter is not an isolation boundary against a hostile local process replacing files during a read. Persistent disk and backups are required for deployment. A future S3 adapter can preserve logical keys but still requires copying files and configuring delivery.

## API contracts across repositories

`docs/api/openapi.yaml` owns the implemented HTTP contract, including the supported native Better Auth subset, property endpoints and lead endpoints. Property details are in `specs/property-management/contract.md`, mirrored as `frontend/docs/contracts/properties.md`. The frontend uses pinned `openapi-typescript` to generate its committed types from that snapshot; `api:check` detects drift without writing. Lead details are in `specs/lead-management/contract.md`, mirrored as `frontend/docs/contracts/leads.md`. Add request/response schemas alongside future business endpoints and verify runtime validation against them.
