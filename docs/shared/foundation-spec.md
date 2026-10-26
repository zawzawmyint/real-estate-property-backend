# Project foundation

> **Historical snapshot — 21 October 2026.** The original setup requirements and verification record below are preserved as delivered on that date. Statements about public CRM access, missing authentication or absent listings describe that setup state. For the current system, read the [project specification](../../spec.md) and [roadmap](../../ROADMAP.md).

Status: Delivered and verified on 2026-10-21.

Historical record: this specification describes the foundation state as delivered on 2026-10-21. Staff authentication was delivered later; see [staff authentication and roles](../../specs/staff-authentication-and-roles/spec.md).

## Goal

Set up independently versioned frontend and backend repositories inside this workspace, ready for incremental real estate website and CRM features. No business features are included.

## Architecture

- `frontend/`: Next.js App Router, strict TypeScript, Tailwind, shadcn/ui using Base UI. Public shell at `/`, staff shell at `/crm`. No authentication claims: the shell is public until the authentication feature is delivered.
- `backend/`: Express 5, strict TypeScript, Node.js LTS runtime, Prisma with SQLite. Bun manages dependencies in both repositories.
- Backend owns future business logic, authorization, data persistence, and storage. Next.js must not import Prisma or contain duplicate business logic.
- Browser requests to `/api/v1/*` are proxied by Next.js to Express. Server API calls use a validated server-only backend origin. Default local ports are frontend 3100 and backend 4311.
- `GET /api/v1/health` returns HTTP 200 and JSON `{ "status": "ok", "service": "real-estate-api" }`. It is liveness, not a database readiness assertion.
- Errors use `{ "error": { "code": string, "message": string, "requestId": string } }`; production errors hide internals. Responses carry `X-Request-Id`.
- Future business routes use backend-owned API contracts; document a generated frontend types workflow. Do not publish speculative business endpoints.

## Foundation scope

- Independent package manifests, Bun lockfiles, `.gitignore`, `.env.example`, formatting, lint, typecheck, test, build, dev and production start commands.
- Frontend reusable design tokens and a small actual Base UI-backed primitive; public and CRM layouts, loading/error/not-found handling, typed API transport.
- Backend validated config, modular health route, application factory separate from listener, logging with sensitive header redaction, request identification, centralized errors, graceful shutdown.
- SQLite configuration and a real connection check. Do not invent property/user models to make setup work. Start migrations when the first persisted feature requires them.
- Storage contract (save/delete/resolve URL) plus local adapter, using relative storage keys, no absolute client-visible paths. Validate keys and prevent traversal. Adapter unit tests use temporary files. No upload HTTP endpoint yet and no S3 dependencies.
- Environment files, SQLite files, generated artifacts, uploads, and dependencies excluded from Git; examples tracked.
- Backend core tests and frontend API tests plus Playwright smoke across public shell, CRM shell and proxied health route.
- Each repository owns `specs/project-foundation/spec.md`, `specs/README.md`, a reusable `specs/_template/spec.md`, `AGENTS.md`, README, and architecture/development/API documentation appropriate to that repo. Future feature specs use `specs/<feature-name>/spec.md` before code changes. Local specs stand alone if repos move apart.

## Exclusions

No login or roles implementation, listings, leads, dashboards, forms for business entities, client portal, dummy property images/data, Redis, BullMQ, email delivery, S3 implementation, deployment, or remote repositories. Generated property images accompany the property feature later.

## Acceptance

- [x] Both repositories install independently with pinned lockfiles and run on frontend port 3100 and backend port 4311.
- [x] Public and CRM shells render without simulating completed business features.
- [x] Express health, 404, malformed JSON and production-safe errors are verified.
- [x] Frontend reaches real Express through the proxy and server API transport.
- [x] SQLite connection check succeeds; database and generated Prisma client remain ignored.
- [x] Local storage writes, deletes and resolves keys and rejects unsafe paths, including Windows path forms.
- [x] Linting, formatting, strict type checking, tests and production builds pass for each project.
- [x] Six browser smoke tests pass; documentation and implemented commands agree.

## Operational constraints

Local disk needs persistent hosting and backups. PostgreSQL migration and S3 migration require explicit data migration; no claim of zero-effort switching. Avoid generic repositories, dependency injection containers, unused shared utilities, empty feature scaffolds and future dependencies. The parent workspace is an orchestration directory, not a third Git repository.
