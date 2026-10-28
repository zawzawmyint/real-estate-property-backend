# Real Estate Agency Tech Stack

This document records the installed foundation and the tools discussed for later features. **Planned does not mean installed or implemented.** No deferred dependency should be installed until its feature needs it.

Last reconciled: **2026-10-27**. Feature scope and progress live in the [master roadmap](ROADMAP.md); this document tracks technical choices and their adoption status.

## Architecture and runtime

| Area                | Current choice                                                                                           | Status                                                             |
| ------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Frontend repository | `frontend/`: one Next.js application for the public website and CRM; client portal later                 | Foundation implemented                                             |
| Backend repository  | `backend/`: separate Express application owning business rules, permissions, database access and storage | Property and lead-management APIs implemented                      |
| Runtime             | Node.js 24 LTS; `.node-version` pins 24.14.1 in both repositories                                        | Configured and verified                                            |
| Package manager     | Bun 1.3.14, independent `bun.lock` files                                                                 | Configured and verified; Bun is not the chosen application runtime |
| Database            | SQLite through Prisma and its SQLite adapter                                                             | Auth, property/photo and lead schema migrations verified           |
| Image storage       | Backend local disk, behind the `Storage` interface                                                       | Public media plus validated property uploads implemented           |
| Local ports         | Frontend 3100; backend 4311                                                                              | Configured to avoid existing local applications                    |
| API boundary        | Backend-owned OpenAPI 3.1 document; browser `/api/v1` proxy and server-only API transport                | Native auth, property and lead contracts; generated frontend types |
| Typography          | Self-hosted Poppins (400/500/600) and Lora variable (400–700) via `next/font/local`                      | Two authored families; assets and SIL OFL provenance are included  |

## Installed frontend tools

The following lists every direct frontend package declared in [package.json](package.json). It does not enumerate transitive dependencies. Versions describe this snapshot; the manifest and lockfile remain authoritative after upgrades.

### Application and UI dependencies

| Package                    | Pinned version | Purpose and current use                                                                                 |
| -------------------------- | -------------- | ------------------------------------------------------------------------------------------------------- |
| `next`                     | 16.4.2         | App Router, server rendering, route layouts, loading/error states and API proxy                         |
| `react`                    | 19.3.1         | Component rendering and React Server Components                                                         |
| `react-dom`                | 19.3.1         | React DOM rendering                                                                                     |
| `@dnd-kit/react`           | 0.5.1          | Frontend-only grouped pipeline dragging and keyboard movement; explicit stage controls remain available |
| `@dnd-kit/dom`             | 0.5.1          | Frontend-only drag accessibility configuration and persisted-column sorting behavior                    |
| `@base-ui/react`           | 1.9.0          | Accessible primitive backing the shared button                                                          |
| `class-variance-authority` | 0.7.1          | Shared component variants                                                                               |
| `clsx`                     | 2.1.1          | Conditional class composition                                                                           |
| `tailwind-merge`           | 3.7.0          | Resolve conflicting Tailwind classes in shared UI                                                       |
| `server-only`              | 0.0.1          | Protect the server API entry point from client imports                                                  |
| `better-auth`              | 1.7.12         | React auth client for implemented staff sign-in, session and sign-out                                   |
| `react-hook-form`          | 7.90.0         | Client field state and validation for implemented login and property forms                              |
| `@hookform/resolvers`      | 6.0.0          | Connects login and property forms to their Zod schemas                                                  |
| `zod`                      | 4.6.7          | Login/property and Server Action input validation; Express validates separately                         |

**shadcn/ui approach:** Shared UI is locally owned source using Base UI, semantic tokens and the `base-nova` configuration in `frontend/components.json`. The current catalog includes `Button`, `Input`, `Field`, `Alert`, `Card`/`CardContent`, `Empty`, `Textarea`, `NativeSelect`, `Badge`, `Table`, `Pagination`, `Sheet`, `Dialog`, `AlertDialog` and `Skeleton`. Property forms use `Textarea`/`NativeSelect`, inventory uses `Badge`/`Table`/`Pagination`, mobile filters use `Sheet`, gallery uses `Dialog`, destructive deletion uses `AlertDialog`, and loading views use `Skeleton`. A shadcn CLI package is not installed, and the full component catalog has not been added. Reuse the local catalog first; when a standard primitive is missing, add only the appropriate official Base Nova registry component and adapt it to the semantic palette. This source-owned reuse policy adds no dependency by itself.

### Frontend development dependencies

| Package                | Pinned version | Purpose                                                                       |
| ---------------------- | -------------- | ----------------------------------------------------------------------------- |
| `typescript`           | 5.9.3          | Strict static type checking                                                   |
| `tailwindcss`          | 4.3.3          | Utility styles and shared design foundations                                  |
| `@tailwindcss/postcss` | 4.3.3          | Tailwind build integration                                                    |
| `@playwright/test`     | 1.64.1         | Desktop/mobile browser integration tests; Chromium installed for verification |
| `vitest`               | 5.0.5          | API transport and configuration tests                                         |
| `eslint`               | 9.39.5         | Linting                                                                       |
| `eslint-config-next`   | 16.4.2         | Next.js lint rules                                                            |
| `prettier`             | 3.9.10         | Source and documentation formatting                                           |
| `@types/node`          | 24.19.2        | Node.js TypeScript definitions                                                |
| `@types/react`         | 19.3.0         | React TypeScript definitions                                                  |
| `@types/react-dom`     | 19.3.0         | React DOM TypeScript definitions                                              |
| `openapi-typescript`   | 7.13.0         | Generates checked property API declarations from the OpenAPI snapshot         |

### Frontend patterns discussed

- **Server Components:** Already used. Server-rendered data comes from Express, never directly from Prisma.
- **Suspense and loading states:** Public listing and CRM inventory results use query-keyed Suspense boundaries; CRM headings and filters remain available while rows load. `useClientReady` keeps interactive controls inert until hydration.
- **Client Components and forms:** Staff login and property forms use React Hook Form, Zod and locally owned Base Nova primitives. Create/edit fields, read-only presentation and lifecycle sidebar are shared where applicable; `SubmitButton` supplies common pending submit semantics. Backend validation remains authoritative.
- **Server Actions:** Property create/update/delete and photo writes use feature-owned Server Actions. They validate untrusted input, live session/role and Origin, and forward only the configured session cookie to Express; Express remains responsible for validation, permissions and business decisions.
- **Reusable design:** Shared tokens, primitives and layout components support the public discovery and CRM property layouts. Persistent form/action feedback uses `Alert`/`AlertDescription`, field validation uses `FieldError`, and `Button` variants serve actions such as session retry and property lifecycle controls.

## Installed backend tools

The following lists every direct backend package declared in package.json (companion repository: `backend/package.json`). Generated Prisma output, database files and uploaded assets are ignored runtime/build artifacts.

### Backend runtime dependencies

| Package                          | Pinned version | Purpose and current use                                                          |
| -------------------------------- | -------------- | -------------------------------------------------------------------------------- |
| `express`                        | 5.3.0          | Modular HTTP application, liveness and public-image routes                       |
| `@prisma/client`                 | 7.10.1         | Generated, typed database client and real SQLite connection check                |
| `@prisma/adapter-better-sqlite3` | 7.10.1         | Prisma SQLite driver adapter; supplies the SQLite driver dependency transitively |
| `zod`                            | 4.6.7          | Environment validation and staff-auth request validation                         |
| `helmet`                         | 8.3.0          | HTTP response headers, with an explicit cross-origin policy for public media     |
| `pino`                           | 10.4.0         | Structured logging with sensitive-field redaction                                |
| `better-auth`                    | 1.7.12         | Native staff authentication server, Prisma adapter integration and sessions      |
| `better-call`                    | 1.4.4          | Node/Web Request adapter used to bound native auth request bodies                |
| `sharp`                          | 0.35.5         | Decode, validate and normalise public property-photo uploads to WebP             |

### Backend development dependencies

| Package             | Pinned version | Purpose                                                       |
| ------------------- | -------------- | ------------------------------------------------------------- |
| `prisma`            | 7.10.1         | Client generation and committed SQLite auth migration tooling |
| `typescript`        | 5.9.3          | Strict static type checking and server compilation            |
| `tsx`               | 4.23.15        | Run TypeScript during Node development and database checks    |
| `vitest`            | 5.0.5          | Backend boundary and filesystem tests                         |
| `supertest`         | 7.3.1          | Exercise the real Express application in HTTP tests           |
| `eslint`            | 9.39.5         | Linting                                                       |
| `@eslint/js`        | 9.39.5         | ESLint base rules                                             |
| `typescript-eslint` | 8.72.0         | TypeScript-aware lint configuration                           |
| `prettier`          | 3.9.10         | Source and documentation formatting                           |
| `@types/express`    | 5.0.6          | Express TypeScript definitions                                |
| `@types/node`       | 24.19.2        | Node.js TypeScript definitions                                |
| `@types/supertest`  | 7.2.1          | Supertest TypeScript definitions                              |

## Planned and deferred tools

**None of the named deferred packages below are direct dependencies in either repository.** React Hook Form and Zod are installed for the staff login and property create/edit forms; their use does not imply delivery of later business forms such as inquiries or leads. No deferred tool below has a pinned version.

| Tool or capability         | Intended responsibility                                              | Adoption point and decision status                                                                                                                            |
| -------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Zustand                    | Shared browser-side state when multiple components need it           | Discussed, conditional on a real feature need. Keep shareable search/filter state in URLs rather than defaulting to a global store.                           |
| Localization library       | Translation management and locale-aware UI                           | Required capability for P3-05; specific library not selected. Arabic requires right-to-left behavior as well as translated strings.                           |
| Nodemailer                 | Server-side email transport                                          | Planned when email is needed, such as authentication mail or P2-01. SMTP/email delivery provider is not selected or configured.                               |
| Redis                      | Infrastructure for queue-backed work or other justified shared state | Discussed, deferred until a feature needs it. No Redis service is provisioned.                                                                                |
| BullMQ                     | Background processing, retries and scheduled work                    | Planned option when reliable asynchronous delivery is required. Queue backend and worker deployment must be specified with the feature; no worker exists now. |
| Calendar and chart tooling | Viewing calendar, dashboard and performance-report visuals           | Feature requirements exist in P1-24, P1-29–P1-30 and P2-07. No additional library is selected; evaluate existing UI building blocks first.                    |

Creating dated tasks and highlighting overdue tasks in P1-26–P1-27 does not by itself require Redis, BullMQ or automatic message delivery. Likewise, a WhatsApp link and automated WhatsApp messaging are different integrations; the roadmap leaves that decision open for P2-01.

## Future database and storage options

| Option                         | Current status                                                | What adoption requires                                                                                                                                                                                         |
| ------------------------------ | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PostgreSQL                     | Discussed future database option; SQLite is the active choice | Provider-compatible schema and migrations, a data-transfer plan, connection configuration and verification. Prisma does not make existing SQLite migration SQL portable. No PostgreSQL service is provisioned. |
| S3 storage                     | Discussed future image-storage option; local disk is active   | An S3 adapter implementing the storage contract, provider/credentials/delivery configuration, any needed SDK and copying existing assets. No S3 SDK, bucket or credentials are configured.                     |
| Generated demo property images | Versioned illustrative fixture inputs for P1-19               | Implemented by the explicit backend seed command; runtime copies use generated storage keys.                                                                                                                   |

Private contracts and IDs in P3-02 require separately authorized storage and delivery. The existing public-image route must not be reused for private documents.

## Engineering workflow and supporting tools

- **Next.js runtime inspection:** Project-scoped Codex configuration launches pinned `next-devtools-mcp@0.4.0` through npm's cache; it is agent tooling, not a direct application dependency. Inspect the frontend dev server on 3100 with the compatible MCP tools and verify behavior with the existing browser tooling/Playwright. Connector telemetry is disabled in its environment. The workspace configuration was verified; a standalone frontend project requires trust and an MCP reload before availability can be confirmed. Keep Webpack; the Turbopack-only compilation tools and upstream `next-dev-loop` skill are excluded. See [shared agent tooling guidance](docs/shared/agent-tooling.md).

- **SDD:** Define each feature in `specs/<feature-name>/spec.md` in the affected repository before implementation. Use the existing templates, and link actual specs to the roadmap IDs as work starts.
- **TDD and E2E focus:** Write meaningful tests for behavior and use browser checks for complete public-to-CRM flows. Current tooling is Vitest, backend Supertest and frontend Playwright. These practices do not mean every future feature is already tested or implemented.
- **Agent instructions and specs:** Repository `AGENTS.md` files hold coding conventions; feature `spec.md` files hold requirements and acceptance. This follows the intent of the original agent/spec notes using the repository's established filenames.
- **Git and CI:** Independent Git repositories and GitHub Actions verification workflows are configured. No remote repository or deployment was created by the foundation setup.
- **Quality checks:** Both repositories provide linting, formatting, strict type checking, tests and production builds via `bun run check`. Backend database verification uses `bun run db:generate`, `bun run db:migrate`, then `bun run db:check` on a fresh checkout. Auth integration checks run from the frontend with the real backend running.
- **Environment handling:** Frontend uses server-only `API_URL` and its browser proxy; backend uses validated environment configuration. Local secrets, database files, uploads and generated build artifacts stay outside Git.

## Keeping this document current

Shared-document policy: edit shared content in the frontend repository first and synchronize the backend copy in the same delivery. Links in each copy resolve within that repository. Companion-repository source paths are shown as text because GitHub remotes are not configured. Repository-local feature specs and API contracts remain authoritative for their respective projects.

Update this document when adopting, replacing or removing a tool. Move a planned tool into the installed inventory only after updating the relevant manifest/lockfile and verifying the feature. Keep the [roadmap](ROADMAP.md), feature specs, API contracts and operational instructions consistent with that change.

Installed-version sources: [frontend manifest](package.json), [frontend lockfile](bun.lock), backend manifest (companion repository: `backend/package.json`), backend lockfile (companion repository: `backend/bun.lock`). The inventory covers direct packages; transitive dependency versions belong in the lockfiles.
