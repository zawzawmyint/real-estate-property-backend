# Agent performance reporting contract

Status: Implemented and verified — 2026-11-18. Backend-owned P2-07 contract for the delivered read-only reporting endpoint; no deployment or normal-database migration is claimed.

## Purpose and authorization

Provide historical aggregates of recorded staff work, not verified customer contact, revenue or an employee ranking. Existing dashboard metrics remain current-state metrics with their existing definitions.

Operation: `getAgentPerformanceReport`, `GET /api/v1/staff/reports/agent-performance`. Authenticate and validate live staff using existing middleware and `requireCurrentStaff` inside the same read transaction as the report. Admin/Manager can read all report rows or one selected agent. Agents can read only their own historical aggregate, including their own past work on leads subsequently reassigned. This is an explicit aggregate-only permission: it grants no access to former lead details, other agents' identities, their totals or agency coverage counts. There are no lead drill-down links.

Use existing session cookie, no-store responses and structured error envelopes. No public route, write operation, new credential or environment variable is required.

## Query

- `from`, `to`: optional only as a pair; real calendar dates in exact `YYYY-MM-DD` form with years 0001–9999. Both are inclusive Dubai dates. Omission defaults to the first day of the current Dubai month through today. Explicit ranges may span at most 366 calendar dates, must have `from <= to`, and may not end after Dubai today.
- `agentId`: optional existing staff identifier or historical assignment identifier, nonempty and at most 128 characters; identifiers are not assumed to be UUIDs. Omission means all agents for Admin/Manager and self for Agent. An Agent-supplied identifier other than self is always forbidden, whether it exists or not.
- `page`: positive integer, default 1. `pageSize`: 25 or 50, default 25. Pages beyond the last return empty items with the true total, not a rewritten page.
- Reject unknown, empty, repeated, array-valued or malformed parameters. Do not silently discard invalid filters or widen scope.

Resolve one `generatedAt` and Dubai boundaries per request. `rangeStart` is midnight at `from`; `rangeEndExclusive` is midnight after `to`, converted to UTC. `asOf = min(generatedAt, rangeEndExclusive)`. Include events at `rangeStart`, exclude events at `rangeEndExclusive`, and never read future events beyond `generatedAt`. Historical reports reconstruct state at `asOf`, rather than using today's assignment/stage to credit old work. At an exclusive end boundary use the state immediately before that boundary.

## Attribution and qualifying work

Reconstruct assignment episodes from each lead's `created` activity and `assigned`/`unassigned` activities. A creation with `nextAgentId` starts the first episode immediately; public/import-created unassigned leads start none. A real assignment starts an episode; reassignment/unassignment ends the preceding episode. A no-op does not start another episode. The same agent may have multiple episodes for a lead. Use stored assignment IDs/names, never current lead ownership or actor names as an identity key.

A qualifying follow-up is either `call_logged` or `stage_changed` with `previousStage = new` and `nextStage = contacted`, performed by the agent responsible during that episode. A call log records an attempt, not a completed conversation. Manager actions on an agent's behalf, generic notes, edits, temperature changes, imports, automated events, tasks and viewings do not qualify. A Manager/Agent role change today does not reclassify historical assignments.

Assignment ownership must be provable. Same-timestamp assignment transitions and actions have no durable ordering in the current schema; never order UUIDs to invent chronology. Exclude affected actions/episodes when different ownership interpretations are possible. Multiple qualifying actions at the same timestamp under an already-established, unambiguous episode yield the same first-follow-up instant. Missing/inconsistent creation/assignment history and a missing actor ID are unknown, not evidence of no work. A deleted user's name alone cannot establish action identity. No synthetic historical events or inferred backfill is permitted.

The implementation must separate known portions of a timeline from uncertain portions. Historical completed episodes with provable attribution remain countable after later staff deletion. A latest-assignment/current-owner mismatch without a timestamped transition makes the open interval uncertain; it must not invalidate earlier closed episodes or be treated as a known ongoing assignment. If the first-ever Won event has ambiguous attribution, exclude that lead from credited wins rather than crediting a later Won event.

## Metrics

- `leadsHandled`: distinct lead IDs with at least one qualifying action in the selected event window, credited to that action's responsible agent. Multiple actions by one agent count once. A lead handled by two agents can appear in both rows; summing rows is not a count of unique agency leads.
- `dealsClosed`: each lead's first-ever transition to Won, only if that transition is in the selected event window. Credit its responsible agent at that instant, even when a Manager records the change. An unassigned/ambiguous first win is not credited to an agent. Reopening, reassignment or another Won transition never creates another credited closure. This is a lead-stage outcome, not a signed contract or revenue figure.
- Response cohort: provable assignment episodes starting in the selected window. Follow-up after `asOf` or after that episode ends cannot satisfy the episode. Episodes already open before `from` can contribute handled/won events but do not enter the response cohort.
- `completedFollowUps`: cohort episodes with a qualifying first follow-up before episode end and `asOf`. If a report is generated during the current day, an action at `generatedAt` can be included; exclusive calendar/episode boundaries remain exclusive.
- `averageFirstFollowUpSeconds`: arithmetic mean of elapsed seconds from episode start to qualifying first follow-up for completed episodes, rounded once to the nearest whole second. Zero seconds is valid; no completed episodes gives null. Use elapsed clock time, including nights/weekends; there is no business-hours SLA.
- `awaitingFollowUp`: provable cohort episodes still open at `asOf` with no qualifying follow-up. UI label: **Without recorded follow-up**. This is a missing-record measure, includes any lead stage and is not an instruction to contact a closed lead.
- `endedWithoutFollowUp`: provable cohort episodes ended before `asOf` without a qualifying follow-up; show separately so reassignment does not hide non-response.
- `assignmentEpisodes`: count of fully classifiable cohort episodes. It equals `completedFollowUps + awaitingFollowUp + endedWithoutFollowUp`. Exclude uncertain cohort episodes from this denominator and disclose them through coverage.

Full pre-range assignment and Won history is necessary for correct attribution and first-win detection. Do not filter history to the selected date range before reconstructing it. A later known follow-up must not retroactively erase historical non-response at a report's cutoff.

## Response

Return a direct JSON object with `generatedAt`, `timezone: "Asia/Dubai"`, `from`, `to`, `rangeStart`, `rangeEndExclusive`, `asOf`, `scope: "agency" | "mine"`, `page`, `pageSize`, `total`, `items`, `agentOptions` and `coverage`.

Each item contains `agent: { id, name, availability }`, where availability is `active | inactive | former`, and the seven count/average fields above: `leadsHandled`, `dealsClosed`, `assignmentEpisodes`, `completedFollowUps`, `averageFirstFollowUpSeconds`, `awaitingFollowUp`, `endedWithoutFollowUp`. Counts are nonnegative integers; average is null or a nonnegative integer. Availability uses today's staff state only as a label, never to remove historical results. Use the live name if the user exists; otherwise the latest unambiguous stored assignment-name snapshot up to `asOf`, falling back to **Former agent**. Never expose staff email or credentials.

The row universe includes current users with Agent role (including disabled/banned agents) with zero-filled rows, plus historical agent IDs with in-window metric/cohort evidence. Explicit agent selection can resolve a former agent from assignment history, including a valid zero-result selected period. Unknown selection for Admin/Manager returns 404. Agents always receive exactly their own identity option and row, even if all counts are zero. Sort rows and options by display name then stable ID using a documented deterministic comparison; apply filtering before row count/pagination. `agentOptions` contains only report-eligible identities in the authorized scope, with the same safe identity fields. An all-agent request returns its eligible options; an explicit agent-selected request returns only that selected option, so selecting one agent also narrows the identity limit. An Agent always receives self only. The UI retains an All agents choice for Admin/Manager; clearing selection reloads the date-scoped option universe before another selection. No separate identity API is needed.

`coverage` contains nonnegative integers `excludedActionCount`, `excludedAssignmentEpisodeCount`, `unattributedFirstWinCount` and `hasLimitations: boolean`. Count distinct source events/episodes once within each category. Count exclusions only when they would affect the selected event/cohort window. `hasLimitations` is true if any count is nonzero. Admin/Manager all-agent reports may include unattributed evidence. A selected-agent report and Agent self report include only uncertain evidence provably linked to that identity; do not leak agency-wide counts or claim to quantify unknown unlinked history. Explain that incomplete history may cause additional unquantifiable omissions. These counters are not report totals and may overlap across categories.

Never return lead IDs, lead names, contacts, properties, original messages, note/call bodies or raw history. No shared-cache or cross-user response reuse. Do not return partial calculations as complete results.

## Bounds and errors

400 `VALIDATION_ERROR` for invalid queries; existing 401 `UNAUTHENTICATED` for absent/expired/disabled staff; 403 `FORBIDDEN` for forbidden agent selection; 404 `NOT_FOUND` for an unknown manager-selected identity; existing safe 500 behavior for unexpected errors. Revalidate current staff before reading aggregates in the snapshot.

Bound history selection to 100,000 relevant activities and the authorized option universe to 2,000 identities. Detect overflow using a limit-plus-one count/read and return 422 `REPORT_TOO_LARGE` with safe guidance to narrow dates or select an agent. Never silently truncate. Apply Agent/self scoping before limit detection so another agent's workload cannot deny a self report. Select only attribution fields; never materialize note bodies or the complete agency history in application memory. SQL aggregates/window queries or bounded batches must preserve all necessary pre-range context without an unbounded per-lead query loop. Target a report response under two seconds on a documented local 10,000-lead/100,000-activity fixture; report measured results and revise the design before acceptance if it cannot meet that target.

## Compatibility and verification example

No schema migration, business mutation change, new dependency or configuration was required. The endpoint, OpenAPI entry and generated frontend types are additive and delivered. Existing dashboards, lead DTOs, CSV, notifications and permissions remain unchanged except for the explicit own-historical-aggregate access above. This prose is the metric authority.

Fixture, all instants Dubai time: lead L is assigned to A November 1 at 09:00; A logs a call at 09:10. It is reassigned to B November 2 at 10:00; B records New → Contacted at 10:30. A Manager moves it to Won November 3 while B owns it, reopens it November 4, and moves it to Won again November 5. For November 1–5, A has handled 1, closed 0, completed 1, mean 600 seconds; B has handled 1, closed 1, completed 1, mean 1,800 seconds. For November 3–5, B has closed 1 and no response-cohort episode; for November 5 alone there is no credited closure. Later reassignment must not move those credited wins.

## Verification status

The backend quality gates passed with 310 tests in 65 files, including 25 reporting-focused tests. On Node 24.14.1 / Ultra 7 255H, the final-source 10,000-lead/100,000-relevant-activity fixture completed in 568ms for authenticated all/manager scope and 732ms for self/agent scope, with 10 SQL statements each; this is fixture evidence, not a universal latency guarantee. The final frontend quality gates passed API parity, lint, format, typecheck, 440 tests in 62 files and build. Separate complete clean browser projects accounted for all 508 discovered cases: desktop 240 passed with 14 configured skips and mobile 192 passed with 62 configured skips; there were no failures, flaky outcomes, retries, missing or unexpected cases. The isolated exact-data dashboard acceptance passed 16/16. Final scope review passed after coverage for dirty-form history cancellation and balanced future handovers. Native Safari was not exercised.
