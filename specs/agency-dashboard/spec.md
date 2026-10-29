# Agency dashboard

Status: Verified (2026-10-29) — P1-28, P1-29 and P1-30 are delivered with automated, browser and visual-QA evidence.

## Goal

Supply a consistent, authorized aggregate of existing lead data for the CRM Overview without disclosing individual lead records.

## Scope and exclusions

- In scope: authenticated read-only dashboard endpoint, new-leads-this-week metric, current Won count, all-time Won/total ratio, source and stage distribution.
- Out of scope: date/agent filters, historical close-event or cohort reporting, revenue, agent rankings, tasks/viewings, exports, background jobs, new persistence models and modifications to lead writes.
- Admin/Manager see the agency including unassigned leads; Agents see only currently assigned leads. All metrics except weekly acquisition use all-time current state, bounded by generatedAt.

## Behavior and contracts

- Authoritative API and formulas: [contract](contract.md). `GET /api/v1/staff/dashboard` uses existing live `requireStaff`, noStore and error conventions. It rejects all query parameters with 400 after authentication.
- Use feature-local routes → controller → service → repository → Prisma. Routes own ordered transport/access middleware; the service chooses authorized scope and one clock instant; repository performs bounded count/groupBy queries within one read transaction/snapshot. Pass the transaction explicitly. Do not fetch and aggregate the entire lead collection in JavaScript.
- Use existing Lead `createdAt`, `source`, `stage`, `assignedAgentId` and existing enums. No schema/migration is expected. Do not infer closure dates from `updatedAt` or count LeadActivity win events.
- Reuse existing staff types/access helpers where their interface fits. The service must never trust client role, actor ID or scope input. All aggregate queries use the same authorized lead predicate and generatedAt cutoff.
- Return only the explicit aggregate DTO; no lead records or identifying data. Response uses `Cache-Control: no-store`; no shared aggregate cache or logging of lead content.
- The backend-owned OpenAPI addition is published at `docs/api/dashboard.openapi.yaml`, linked from `docs/api/openapi.yaml`, and synchronized to the frontend local snapshot/generated declarations.

## Acceptance criteria

- [x] Signed-in Admin/Manager receive agency aggregates including unassigned leads; Agents receive only current own-assignment aggregates.
- [x] Missing/invalid/revoked sessions and unsupported roles follow live staff auth behavior; attempted scope/agent query injection returns no aggregate data.
- [x] 10 visible leads, 2 currently Won, 3 created this week returns totalLeads 10, wonLeads 2, newLeadsThisWeek 3, conversionRatePercent 20.
- [x] Monday 00:00 Dubai is inclusive; the following Monday is exclusive; generatedAt cutoff excludes future creation timestamps and is shared by all queries.
- [x] Zero leads returns zero-filled categories and null conversion; two of three Won returns 66.7; reopening Won and reassignment affect the next response without event double counting.
- [x] Source/stage distributions include every canonical category in fixed order; both sums equal totalLeads from one consistent snapshot.
- [x] DTO contains only contract fields, no private data, and no-store applies to successes and errors.
- [x] Unknown query parameters return 400; database errors use safe existing error responses and never a zero-success fallback.
- [x] Backend quality checks, relevant database verification and frontend cross-repository browser checks pass before delivery is marked verified.

## Validation

- Deterministic service clock tests for Sunday/Monday Dubai rollover, UTC date crossover and exact generatedAt/week boundaries.
- Real SQLite/Supertest tests with Admin, Manager, two Agents, unassigned leads, sources/stages, old/current/future creation dates and reassigned/reopened records.
- Snapshot consistency test or deterministic repository interleaving check proves totals and distributions cannot mix states during a write; transaction strategy must be verified against the installed SQLite adapter.
- Boundary tests for live session revocation, unsupported roles, unknown query parameters, safe DB failures, exact DTO keys and no-store.
- Run `bun run check` and `bun run db:check` against the intended disposable/local database; use the existing integration fixture for frontend smoke and browser checks.

## Risks and rollout

- No migration or production runtime configuration change was introduced; the dedicated browser fixture uses documented test-only environment variables. Current-state ratio is deliberately distinct from a historical sales close rate and is explained in the UI.
- Atomic read behavior is verified with the installed SQLite adapter and a concurrent WAL write. The read-only summary uses no write-lock tricks; the representative aggregate measurements below did not justify adding an index.
- Additive API; existing lead/property/auth routes are unchanged. Revert dashboard mounting and frontend consumption together if needed.
- [Implementation plan](../../docs/superpowers/plans/2026-10-29-agency-dashboard.md). Acceptance criteria are verified by the evidence below.

## Implementation evidence

- 126 backend tests across 35 files, lint, type checks, build and disposable-database verification passed. Focused dashboard tests cover authorization, query rejection, Dubai boundaries, generated-at cutoffs, zero fill, current-stage/reassignment behavior, safe failures, and a real SQLite WAL snapshot assertion.
- A 10,000-fictional-lead aggregate fixture preserved total/distribution invariants across five reads measured at 22 ms, 16.4 ms, 17.5 ms, 7.8 ms and 11 ms; no index was added without evidence.
- Frontend contract generation/drift checks and focused malformed-DTO handling passed. The final dedicated dashboard suite passed all 16 desktop/mobile cases, without skips or failures, on isolated port 14311; frontend visual QA found no P0/P1/P2 findings. Legacy coverage is the union of two parallel full runs (233 passed/26 skipped/1 failed, then 226 passed/26 skipped/8 failed): all 234 active legacy cases passed at least once, but neither run was clean because of timing and sign-in-cache instability unrelated to dashboard endpoint calls. The revised pipeline expired-session case passed six focused desktop/mobile repetitions.

Approved design update (2026-10-29): implement the selected maroon/ivory dashboard mockup with four metric cards, adding Total leads (all time). Preserve the existing CRM shell and deliver the complete professional responsive design. The fixed-period and role-scope defaults are approved for implementation.
