# Avenor Properties workspace

Context: this document describes the original parent workspace containing two independent repositories. This repository is one standalone member of that system; its clone does not contain or require the sibling repository. Paths such as frontend/ and backend/ below are relative to the original parent workspace. Shared documents now live inside each repository. Apply engineering rules to this repository and coordinate the companion repository only when a change affects both.

This folder holds two independent Git repositories. It is not a monorepo and does not have a root package manifest.

- `frontend/` — public website and staff CRM interface, using Next.js.
- `backend/` — Express API, SQLite persistence and local file storage.

The selected agency name is **Avenor Properties**, used throughout the current website and CRM.

The foundation is followed by a verified staff-authentication slice. `/crm` enforces an Express-verified staff session; Admin, Manager and Agent identities are available. Properties, leads, viewings, the client portal and lead ownership are future features.

Shared-document policy: edit shared content in the frontend repository first and synchronize the backend copy in the same delivery. Links in each copy resolve within that repository. Companion-repository source paths are shown as text because GitHub remotes are not configured. Repository-local feature specs and API contracts remain authoritative for their respective projects.

Track all Phase 1, 2 and 3 features in the [master roadmap](../../ROADMAP.md). It preserves the original checklist, delivery items and the workflow for creating feature specifications.

See the [tech stack document](../../TECH_STACK.md) for installed package versions, planned tools and the features that would introduce them. Deferred tools are not installed.

## Local development

Use Node.js LTS and the Bun version pinned in each repository. Install and configure each repository separately. The repository READMEs are authoritative for commands.

Start the backend in one terminal, then the frontend in another:

```powershell
cd backend
bun install --frozen-lockfile
Copy-Item .env.example .env
bun run dev
```

```powershell
cd frontend
bun install --frozen-lockfile
Copy-Item .env.example .env.local
bun run dev
```

Do not overwrite an existing environment file. Default addresses are frontend `http://localhost:3100` and backend `http://localhost:4311`. Browser API requests use the frontend's `/api/v1` proxy; backend health is available at `/api/v1/health` on either server while both are running.

See each repository's development guide for database setup, test commands, production builds and configuration. No remote Git repositories or deployments are created by this setup.

## Spec-driven delivery

Each repository maintains its own `specs/<feature-name>/spec.md`. Start with its `specs/_template/spec.md`. Keep related frontend and backend feature names aligned, and link the corresponding API contract when a feature spans both repositories.

Before implementation, define the user flow, scope, permissions, request/response shapes and measurable acceptance criteria. After implementation, reconcile the spec with code and verification evidence. Only mark acceptance criteria complete when verified.

The archived [workspace foundation specification](foundation-spec.md) describes the cross-repository setup. The child repositories keep standalone foundation specifications so they can move or be cloned independently.

## Architecture boundaries

- Express owns business rules and database access. Next.js consumes the API; it does not import backend source or Prisma.
- Backend-owned OpenAPI contracts describe the API boundary. Follow the repositories' contract synchronization instructions when adding endpoints.
- Feature code stays together. Shared code is extracted when an actual reusable responsibility appears.
- Local uploads and SQLite databases are runtime data, not Git assets. Local disk requires persistent deployment storage and backups.
- PostgreSQL and S3 are future migrations with explicit data-transfer steps, not automatic configuration switches.

## Next delivery slice

Specify property publishing next. Generate demo property images alongside the property feature, when image dimensions and sample records are defined. P1-03 lead ownership needs a separate lead-management model and authorization specification.
