# Phase 1 review remediation

Status: Verified implementation, release checks and pushed scoped Git delivery — no deployment or Phase 1 closure.

## Goal

Define production inquiry ingress explicitly and centralize live staff validation without weakening transaction-scoped authorization or resource ownership.

## Scope and exclusions

- In scope: production unsigned-inquiry fallback, duplicated staff checks in leads/viewings/tasks, dashboard validation consistency, backend roadmap links and synchronized release evidence.
- Frontend owns gallery titles, inquiry recovery UI, shortcut tests and completion-spec reconciliation in its companion `specs/phase-one-review-remediation/spec.md`.
- Excluded: cookie-name cleanup, new endpoints, new dependencies, schema changes, deployment, unrelated refactors and closure of Phase 1 without evidence.
- Preserve the verified October `project-review-remediation` spec and existing uncommitted work.

## Behavior and contracts

- [Backend-owned contract](contract.md) defines the implemented production relay requirement, errors, unchanged rate limits and transaction-aware staff validation.
- Modify `src/modules/leads/inquiry-limiter.ts` without altering origin/content-type/body-size/schema checks or middleware ordering.
- Introduce `src/modules/auth/staff-actor.ts` with `requireCurrentStaff(identity: Actor, tx: Transaction): Promise<Actor>`. Resolve session ID, user ID and expiry through the supplied transaction, validate current user state and credential version, and return current role/name.
- Move the existing session lookup out of `createLeadRepository().actor` into this auth-owned helper; remove that repository method only after checking all callers. Keep the existing `Actor` type location for this scoped cleanup.
- Leads/viewings/tasks call the helper at the same transaction points as today. Remove lead repository instances/imports only if no other behavior uses them.
- Dashboard validates the actor and derives scope inside the same transaction as its four aggregates. Preserve generated timestamp/Dubai week calculations and the single aggregate snapshot.
- `requireStaff` remains the HTTP boundary backed by Better Auth; do not replace native session handling or remove resource-level checks. Shared service validation complements middleware.
- Update `docs/api/leads.openapi.yaml`, relevant inquiry contract Markdown and development instructions after behavior passes. Generated frontend snapshots belong to the frontend delivery. No cross-repository source imports.

## Acceptance criteria

- [x] B01: Both public inquiry endpoints reject missing/partial/malformed/bad-signature production relay headers with safe 403 responses and no persistence.
- [x] B02: Valid signed requests retain existing acknowledgement, shared limiter, replay and privacy semantics; unsigned nonproduction requests retain socket fallback.
- [x] B03: Leads, tasks, viewings and dashboard use one transaction-aware current-staff helper. Missing/expired/revoked/mismatched sessions, disabled/banned/non-staff users and credential-version mismatch return 401.
- [x] B04: Fresh roles and agent ownership determine resource reads, mutations and dashboard counts; manager-only operations retain 403 checks and other agents' resources retain existing 404 behavior.
- [x] B05: Backend roadmap file links resolve locally; shared roadmap status/evidence matches frontend without copied broken frontend-only links.
- [x] B06: Backend `bun run check` and focused authorization/concurrency/inquiry tests pass with disposable data; final cross-repository browser/runtime acceptance passed.

## Validation

- Extend `tests/inquiries.test.ts` and `tests/agency-inquiries.test.ts` for the production/nonproduction relay matrix, valid signed replay, cross-route limiter and no-write rejection. Configure a valid production environment without changing secrets in tracked files.
- Exercise helper validation at the service boundary, including revocation or role change after middleware actor capture and before transaction work. Extend existing ownership, concurrency and dashboard suites; prove dashboard rejects a stale actor and uses refreshed role for scope.
- Run required checks and disposable integration fixtures. `bun run db:check` against disposable data is appropriate if foundation/persistence changes become necessary; no migration is currently proposed.
- Verify generated API descriptions and frontend snapshots agree; do not mark acceptance from source inspection alone.

## Risks and rollout

- The user confirmed on 2026-11-05 that inquiries currently come only from the frontend. No other current caller requires unsigned production access. Deploy/verify signed frontend requests before backend enforcement; future integrations must use a trusted server relay. Development/test fallback remains explicit.
- Keep session lookups inside transactions; moving validation outside reintroduces revocation races. Do not broaden this into a replacement auth framework.
- Documentation is reconciled against verification evidence. The user authorized scoped commits and pushes on November 5; production deployment remains outside this delivery.

## Implementation evidence

- Backend HEAD `3690d3a` plus reviewed dirty candidate digest `20f08ac413902b9358ca1e26f470a1d618c6136d4af6455fd2d0d59257813c5c`; this is candidate identity, not a committed-delivery claim.
- `bun run check` passed (lint, formatting, typecheck, 132 tests in 35 files and build). Focused ingress/current-staff coverage passed 31 tests in seven files. Local report: `var/review-remediation-report.md`.
- The frontend final quality gate passed for its dirty tested candidate, followed by a clean 341-pass/65-intentional-skip serial run, 16/16 exact-data dashboard acceptance and guarded normal-runtime inspection with no browser/DevTools errors. Those results predate the scoped Git delivery below; no deployment is claimed.

- Authorized Git delivery on November 5: backend `5086b6507f0c12e99a5e309ef6313429a7509c9f` and frontend `655587e6dc10ea467223c1b1c06c4984f86bba1b` were pushed to the existing working branches. Frontend F08 is verified. P1-14/P1-18 and the later frontend pre-hydration property-form defect remain open. Fresh pre-push unit suites passed: backend 132, frontend 297.
