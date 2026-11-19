# Agent performance reporting

Status: Verified — 2026-11-18. P2-07 is complete; local verification does not claim deployment or a normal-database migration.

## Goal

Provide trustworthy agent-level recorded-work aggregates with historical assignment attribution and explicit coverage limitations. Support managerial coaching and workload decisions without claiming verified customer contact or revenue.

## Scope and exclusions

- In scope: read-only agent performance API, strict date/identity/pagination validation, live authorization, historical episode reconstruction, first-Won attribution, bounded aggregation and a backend-owned contract/OpenAPI.
- Metrics: distinct leads handled, first-time Won leads, assignment episodes, completed first follow-ups, elapsed average with sample size, ongoing episodes without recorded follow-up and ended episodes without follow-up.
- Admin/Manager may read all/selected agents; Agents may read only their own historical aggregates. No permission to reopen previously assigned lead details is granted.
- Out of scope: changing lead mutations/history, schema migrations, synthetic historical backfill, ranking, revenue/commissions, conversion claims, messaging, exports, business-hours SLAs, charts, scheduled jobs, dependencies, configuration and deployment.

## Behavior and contracts

The [backend-owned contract](contract.md) is the authority for `GET /api/v1/staff/reports/agent-performance`, `getAgentPerformanceReport`, DTOs, bounds, errors, coverage and exact metric definitions. Its frontend snapshot is copied verbatim to that repository's `docs/contracts/agent-performance-reporting.md`. The coordinated [implementation plan](../../docs/superpowers/plans/2026-11-18-agent-performance-reporting.md) records delivery.

Use a real feature module `src/modules/reports/agent-performance/`, with routes → controller → service → repository → Prisma/parameterized SQLite. Reuse existing auth, error and transaction interfaces; do not introduce base repositories or a generic reporting framework. Mount through `src/app.ts`. Keep calculation helpers pure and local only where used.

The existing LeadActivity records creation/assignment agent IDs/names, stage transitions, call/note actors and timestamps. It does not provide durable ordering for equal-timestamp assignment/action events or proof of actual customer contact. Reconstruct provable episodes from selected attribution fields, retain required pre-range context and exclude ambiguous portions. Missing actors, deleted staff and incomplete assignment chains must never be guessed from names or current ownership. No migration is proposed for this first version.

Authenticate before validation/data access; inside the report's single read snapshot revalidate live staff, enforce scope, resolve historical identities and calculate all returned rows/options/coverage. Capture one clock instant. No mutable global scope, shared response cache, per-row database loops or note-body reads. Enforce 366-day windows, 100,000 relevant activities and 2,000 identities with explicit overflow errors rather than silent truncation. The contract defines historical/self scope and safe coverage scoping.

The OpenAPI document/main reference and standalone frontend snapshot are delivered, including security-reference resolution. Existing API contracts, dashboard formulas, notifications, CSV and business-write behavior remain intact.

## Acceptance criteria

- [x] Valid/default inclusive Dubai date ranges, leap dates, half-open boundaries, as-of clock and historical cutoffs match the contract; invalid/repeated/unknown queries fail safely.
- [x] Live staff authorization and snapshot consistency hold; Agents cannot select another identity or infer agency counts/identities/errors through limits or coverage.
- [x] Handled counts deduplicate per agent/lead; only assigned-agent calls or New → Contacted qualify, including same-timestamp but unambiguous follow-up instants.
- [x] Only the first-ever Won transition counts and credits its historical assignee, including Manager-recorded closure; reopen/re-win, later reassignment and unassigned/ambiguous wins behave exactly as specified.
- [x] Response-cohort episodes partition into completed/awaiting/ended counts; averages exclude missing samples, preserve zero and never count post-cutoff or later-assignee actions.
- [x] Incomplete/tied history, deleted actors, inactive/former agents and open-owner mismatches produce scoped coverage warnings without fabricated attribution; earlier provable closed episodes remain usable.
- [x] Stable row/options order, zero-work agents, filtered totals and pagination match; response contains no raw lead/customer/credential data.
- [x] Limits fail explicitly without unbounded materialization; the documented 10,000-lead/100,000-activity benchmark met the under-two-second target.
- [x] Contract/security parity, backend quality gates, disposable database compatibility checks and frontend integration/browser acceptance passed with recorded evidence.
- [x] P2-07 was checked after both repositories verified complete acceptance; no deployment or normal-database change is inferred from local checks.

## Validation

Start with a deterministic fixture implementing the contract example, then test date boundaries, manual assigned creation, public/import unassigned creation, repeated assignment to the same agent, handover before follow-up, completed/ended/open cohorts, lost/reopened leads, historical ownership, missing actor/creation events, equal timestamps, user deletion and role changes. Test 100,000/100,001 activity and 2,000/2,001 identity boundaries, scope-before-limit behavior, narrow-filter recovery, unknown selection and snapshot consistency. Assert exact allowed response keys and absence of private fields.

Backend quality gates passed with 310 tests in 65 files, including 25 report-focused tests; lint, format, typecheck, tests and build passed. On Node 24.14.1 / Ultra 7 255H, the final-source bounded 10,000-lead/100,000-relevant-activity fixture completed in 568ms for an authenticated all/manager scope and 732ms for self/agent scope, with 10 SQL statements each. These are fixture results rather than a universal latency guarantee. Cross-repository acceptance used disposable isolated environments: the two complete clean browser projects accounted for all 508 discovered cases with zero failures, and the separate exact-data dashboard fixture passed 16/16. No migration or business-history rewrite was performed.

## Risks and rollout

History can be incomplete or timestamp-ambiguous; omissions and sample sizes are shown instead of false precision. First-Won definitions intentionally differ from the existing dashboard's current-Won count. Removing the additive reporting route/UI rolls back the feature without touching persisted lead data. No deployment, normal-database migration or native Safari verification is claimed.
