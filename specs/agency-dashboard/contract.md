# Agency dashboard contract

Status: Verified implemented contract (2026-10-29).

## Request and authorization

`GET /api/v1/staff/dashboard` accepts the existing staff session cookie and no query parameters or request body. Apply live staff authorization before query validation and aggregate access. Admin/Manager receive `scope: agency`; Agent receives `scope: mine` using current `assignedAgentId = authenticated user ID`. Agency includes unassigned leads. No caller-selected scope/agent is supported.

Use existing error envelopes/statuses: 401 UNAUTHENTICATED for absent/invalid staff sessions, 403 FORBIDDEN when the existing auth boundary rejects access, 400 VALIDATION_ERROR for query parameters, and the existing safe 500 response for unexpected failures. Preserve the application's actual error envelope when authoring OpenAPI; do not introduce a dashboard-only error format. All responses are no-store.

## Success DTO

200 JSON object with exactly these fields:

- `generatedAt`: ISO 8601 UTC instant captured once by the service.
- `scope`: `agency | mine`.
- `timezone`: literal `Asia/Dubai`.
- `weekStart`, `weekEndExclusive`: ISO 8601 UTC instants representing Monday 00:00 Dubai and the following Monday 00:00 Dubai for generatedAt's week.
- `totalLeads`, `newLeadsThisWeek`, `wonLeads`: nonnegative integer counts.
- `conversionRatePercent`: number in [0, 100], rounded to one decimal, or null if totalLeads is zero. JSON numbers do not retain trailing zeroes; the frontend formats one decimal.
- `leadsBySource`: exactly three `{ source, count }` objects ordered `website`, `call`, `walk_in`.
- `pipelineByStage`: exactly six `{ stage, count }` objects ordered `new`, `contacted`, `viewing_scheduled`, `offer`, `won`, `lost`.

Every count uses current authorized scope and `createdAt <= generatedAt`. The weekly count additionally uses `createdAt >= weekStart` and `createdAt < weekEndExclusive`. Current Won count uses `stage = won`. Distributions group current values over the entire visible population, independent of week. Zero-fill absent categories. Both distributions sum to totalLeads; the Won stage count equals wonLeads. Counts and groups must read one database snapshot.

`conversionRatePercent = round(wonLeads / totalLeads * 100, 1 decimal)` for nonzero totals. It counts current Won leads once each, regardless of when created/won or how many times the lead entered Won. It does not claim historical attribution or deduplication of separate lead records.

Example: generatedAt `2026-10-29T08:00:00.000Z` gives weekStart `2026-10-25T20:00:00.000Z` and weekEndExclusive `2026-11-01T20:00:00.000Z`. Ten visible leads, two currently Won and three created this week yield totalLeads 10, wonLeads 2, newLeadsThisWeek 3 and conversionRatePercent 20. With zero visible leads, all counts/categories are zero and conversionRatePercent is null.

## Compatibility and privacy

Read-only, additive, no database migration and no change to existing lead DTOs. Never return lead/agent IDs, contact details, notes or owner information. Cookie credentials remain server-only on initial frontend reads; no shared cache. Manual refresh/new navigation obtains a new snapshot; there is no push/polling freshness promise.

Matching OpenAPI is published in `docs/api/dashboard.openapi.yaml`, referenced from `docs/api/openapi.yaml`, and synchronized to the frontend snapshot/generated declarations through its API generation workflow. This prose contract owns the metric definitions.
