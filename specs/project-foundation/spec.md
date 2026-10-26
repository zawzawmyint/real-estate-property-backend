# Backend project foundation

> **Historical snapshot — 21 October 2026.** The original setup requirements and verification record below are preserved as delivered on that date. Statements about public CRM access, missing authentication or absent listings describe that setup state. For the current system, read the [project specification](../../spec.md) and [roadmap](../../ROADMAP.md).

Status: Delivered and verified on 2026-10-21.

## Goal

Establish an independently versioned Express API foundation for future real estate features, without implementing any business entity or staff access.

## Scope and exclusions

In scope:

- Express 5 with strict TypeScript, Bun package management, Node 24.14.1 runtime, and independently tracked configuration, lockfile and Git ignores.
- A liveness route at `GET /api/v1/health`, request IDs, structured errors, safe logging, a testable application factory and graceful shutdown.
- Prisma 7.10.1 with SQLite configuration and a real `SELECT 1` connection check, without models or migrations.
- Public-image storage interface and local-disk adapter. It saves generated image keys, rejects unsafe key forms and exposes only `GET /media/{key}`; it does not expose uploads.
- The backend-owned OpenAPI contract in `docs/api/openapi.yaml`, operational documentation and the reusable specification workflow.

Out of scope:

- Authentication, roles, permissions, property/listing/lead/viewing data, dashboards, client portal, queues, email, S3, deployment and remote repositories.
- Business models, placeholder tables, migrations, upload endpoints and private-document storage.

## Behavior and contracts

- `GET /api/v1/health` returns HTTP 200 with `{ "status": "ok", "service": "real-estate-api" }`. It confirms process liveness and does not open or validate the database.
- Errors use `{ "error": { "code": string, "message": string, "requestId": string } }`; all responses include `X-Request-Id`. Unknown failures return a safe 500 response without internal details.
- `GET /media/{key}` delivers a saved public image. Missing or unsafe keys return the error contract with HTTP 404; unexpected storage I/O returns a safe HTTP 500. The response uses `Cross-Origin-Resource-Policy: cross-origin` so the separate frontend can render public media.
- `DATABASE_URL` is a SQLite `file:` URL; `STORAGE_ROOT` is a local directory. Stored client-visible references are logical keys and public URLs, never absolute file paths. Details are defined in [the OpenAPI contract](../../docs/api/openapi.yaml).
- The frontend may consume documented HTTP contracts, but this repository has no cross-repository source imports. Future business contracts remain backend-owned and must be added to the OpenAPI document before the corresponding frontend integration.

## Acceptance criteria

- [x] A frozen Bun install succeeds and the repository has its own lockfile, environment example and ignored runtime/generated data.
- [x] `bun run dev` listens by default on `127.0.0.1:4311`, and the documented health request returns the stated liveness payload.
- [x] Tests verify health, unknown routes, malformed and oversized JSON, safe unexpected errors, storage media behavior and unsafe storage paths (12 tests).
- [x] `bun run db:generate` produces the ignored Prisma client and `bun run db:check` connects to SQLite with `SELECT 1`.
- [x] Local storage saves, resolves and deletes public-image keys while rejecting unsafe path forms and symbolic links.
- [x] `bun run check` passes linting, formatting, strict type checking, tests and a production build.

## Validation

Verified on 2026-10-21 with Node 24.14.1 and Bun 1.3.14:

- `bun install --frozen-lockfile`
- `bun run check` (12 tests)
- `bun run db:check`
- Manual health request to `http://localhost:4311/api/v1/health`

## Risks and rollout

Local SQLite and public media need persistent storage and backups before deployment. Moving to PostgreSQL or S3 requires an explicit, tested data transfer; swapping an environment value does not migrate data. Private documents require a separate, authorized storage design. New persisted features must introduce provider-compatible Prisma migrations rather than modifying this foundation in place.
