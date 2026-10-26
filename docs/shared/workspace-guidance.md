# Workspace instructions

Context: this document describes the original parent workspace containing two independent repositories. This repository is one standalone member of that system; its clone does not contain or require the sibling repository. Paths such as frontend/ and backend/ below are relative to the original parent workspace. Shared documents now live inside each repository. Apply engineering rules to this repository and coordinate the companion repository only when a change affects both.

## Scope

This folder contains two independent repositories: `frontend/` and `backend/`. Do not initialize a parent Git repository or move application logic into a root package. Respect each repository's own AGENTS.md.

## Spec-driven delivery

- Before changing behavior, API contracts, commands or configuration, create or update the affected repository's `specs/<feature-name>/spec.md`.
- Reuse `specs/_template/spec.md`. Specs must state scope, permissions when relevant, data contracts and verifiable acceptance criteria.
- Keep specs and operational docs synchronized after code settles. Do not describe planned business features as implemented.
- Changes spanning both repositories need corresponding specs and one backend-owned API contract.
- Use [repository roadmap](../../ROADMAP.md) as the workspace feature tracker. Preserve its checklist IDs, link actual feature specs when created, and check items off only after their complete acceptance is verified. Keep partial items unchecked and record delivery evidence.
- Keep [tech stack](../../TECH_STACK.md) synchronized when tools are adopted, replaced or removed. Distinguish installed dependencies from planned choices; do not install deferred tools merely because they appear in the document.

## Engineering

- Frontend consumes Express; backend owns persistence, authorization and business rules.
- No cross-repository source imports or shared node_modules assumptions.
- Prefer feature modules and small explicit interfaces to generic infrastructure or empty future scaffolds.
- Frontend interactive forms use React Hook Form, Zod and locally owned shadcn/ui primitives. Async submission Actions may use `useTransition` for awaited requests; field validation/state stays in the form library, and backend validation remains authoritative.
- Backend agency business modules use feature-local routes -> controller -> service -> repository -> Prisma. Services own resource permissions/workflows and transaction coordination; repositories own queries. Introduce real layers with business features rather than empty modules. Better Auth keeps its native handler/adapter and auth/operator integration; health/public media remain infrastructure exceptions.
- Never commit .env files, SQLite databases, uploads, dependency folders or generated build artifacts.
- Verify lint, formatting, typecheck, tests and builds in affected repositories. Run cross-repository smoke tests for integration changes.
- Keep public listing media separate from any future private document storage requirements.
