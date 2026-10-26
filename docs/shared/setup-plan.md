# Foundation execution record

Approved scope: [workspace foundation specification](foundation-spec.md) and the in-chat foundation proposal, with user-selected sibling directories and `specs/<feature-name>/spec.md` convention.

## Tasks

1. Frontend worker owns `frontend/`: tooling, shells, shared design, API client/proxy, tests, frontend specifications and docs.
2. Backend worker owns `backend/`: tooling, Express health/errors/config, Prisma SQLite check, storage, tests, backend specifications and docs.
3. Coordinator owns parent overview and integration: verify both, browser smoke, independent review and fixes.
4. Final spec-updater owns documentation reconciliation after code settles.

## Decisions

- New empty folders are the user-requested isolated project locations; initialize separate Git repositories on `setup/foundation`, without a parent repository or extra worktrees.
- Foundation-only scope defers auth, property images and dummy records until their features.
- Use Node.js LTS runtime with Bun package management; no need to couple application runtime to package manager.
- Use `/api/v1` proxy path and backend origin `http://localhost:4311`; no permissive browser CORS required for the initial flow.
- Repository commits are optional; do not push or create remote repositories.
- Environment adjustment: defaults are frontend 3100 and backend 4311 because ports 3000 and 4000 belong to unrelated running projects. Existing processes remain untouched.
- Port 4100 was subsequently claimed by another project's test server during setup; backend moved to verified-free 4311 before integration verification.

## Progress

- Initial workspace checked: empty, no Git repository or existing implementation.
- Foundation spec written before implementation.
- Created separate `frontend/` and `backend/` Git repositories without a parent repository, remote or commit.
- Added standalone project foundations, repository-local SDD templates and the parent cross-repository foundation specification.
- Verified frozen installation in both repositories. Frontend checks passed: linting, formatting, strict type checking, 13 unit tests and a production build. Backend checks passed: linting, formatting, strict type checking, 12 tests, a production build and the Prisma/SQLite `SELECT 1` check.
- Verified the real integration at frontend port 3100 and backend port 4311: six Playwright desktop/mobile smoke tests passed, including public-to-CRM navigation, proxied health, missing-page behavior and narrow-screen overflow.
