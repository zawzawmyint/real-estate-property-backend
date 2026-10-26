# Real estate API

Start with the [project specification](spec.md) for scope, boundaries and current status, then read the relevant feature spec before implementation. Keep the root spec synchronized after verified feature delivery.

Express 5 + strict TypeScript + Prisma 7 with SQLite. This repository is independent of the sibling frontend. It provides foundation infrastructure, public image delivery, staff authentication, and property-management/public-discovery APIs. Leads and other business features remain pending.

## Local development

Use Node **24.14.1** and Bun **1.3.14**. Run commands from this folder:

```powershell
bun install --frozen-lockfile
Copy-Item .env.example .env
# Edit .env: replace BETTER_AUTH_SECRET with an independently generated random value (at least 32 characters).
bun run db:generate
bun run db:migrate
bun run db:check
bun run dev
```

API: `http://localhost:4311/api/v1/health`. Frontend development origin: `http://localhost:3100`; its `/api/v1/*` proxy forwards to this backend. No wildcard API CORS is enabled.

```json
{ "status": "ok", "service": "real-estate-api" }
```

## Commands

- `bun run dev`: Node watcher with tsx and optional `.env`.
- `bun run build`: generate Prisma client, compile server to `dist/`.
- `bun run start`: run the compiled application using optional `.env`.
- `bun run typecheck`: generate Prisma client and check strict TypeScript.
- `bun run lint`, `bun run format`, `bun run format:check`: source checks and formatting.
- `bun run test`: HTTP, configuration and filesystem regression tests.
- `bun run check`: lint, formatting, type checking, tests and build.
- `bun run db:generate`: generate the ignored Prisma client.
- `bun run db:migrate`: initialize a missing SQLite file when needed, run the committed Prisma migrations, and backfill normalized property search fields. Stop application writes and back up existing data first.
- `bun run db:check`: verify the SQLite connection, delivered auth/property tables, and normalized property search data. Run generation and migration first on a clean checkout.
- `bun run demo:seed -- --confirm-demo`: add any missing fictional demo properties and generated illustrative images to a non-production database. It refuses production and any argument other than the explicit confirmation; it never resets or overwrites records.
- `bun run staff -- bootstrap-admin|create|reset-password|deactivate`: trusted, interactive staff lifecycle commands; password prompts are masked. This is not an HTTP management API.

SQLite files and uploaded files live under ignored `var/`. The committed migrations create Better Auth identity/session tables plus `Property` and `PropertyPhoto`; leads have not been added. Generate a fresh `BETTER_AUTH_SECRET` of at least 32 characters before startup, then bootstrap the first Admin locally. Read the [development guide](docs/development.md#media-reconciliation) before manually reconciling media after a logged cleanup failure.

Read [architecture](docs/architecture.md), [development](docs/development.md), [API contract](docs/api/openapi.yaml), [property contract](specs/property-management/contract.md), [staff-authentication specification](specs/staff-authentication-and-roles/spec.md) and [spec workflow](specs/README.md). Foundation and staff authentication are verified; property acceptance is recorded after final cross-repository validation.

## Shared project documentation

Read the [roadmap](ROADMAP.md), [tech stack](TECH_STACK.md), [workspace overview](docs/shared/workspace-overview.md), [workspace guidance](docs/shared/workspace-guidance.md), [workspace foundation spec](docs/shared/foundation-spec.md), [foundation execution record](docs/shared/setup-plan.md), and [selected homepage mockup](docs/design/homepage-maroon-ivory-charcoal.png). These are committed alongside this project when staged and committed.

The frontend copy is the editing source for shared documents; synchronize the backend copy in the same delivery. Each repository keeps its own feature specs and implementation docs. Both copies work independently after cloning; no sibling checkout is required to read them.
