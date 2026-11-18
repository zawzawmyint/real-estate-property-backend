# Lead temperature contract

Status: Verified — 2026-11-18. This backend-owned P2-06 contract is implemented in the API/OpenAPI; the frontend documentation copy is a synchronized snapshot. No deployment or normal-database migration is claimed.

## Domain and read models

`LeadTemperature = "hot" | "warm" | "cold" | "unassessed"`. UI labels are Hot, Warm, Cold and Not assessed. No null, empty string or alternative casing is accepted. New and historical leads default to `unassessed`.

Add required `temperature: LeadTemperature` to staff LeadSummary and LeadDetail, including mutation results. Retain the existing response envelope and all current fields.

Add `temperature_changed` to the staff activity type union and `temperatureChange: { from: LeadTemperature, to: LeadTemperature } | null` to activity items. It is non-null only for the new event; old/other events return null. Persist previous/next values explicitly, never overload stage-change fields or free-text notes. Actor and createdAt use existing activity fields and access rules.

## Mutation

**Route:** `PATCH /api/v1/staff/leads/{id}/temperature`

**Operation ID:** `changeLeadTemperature`.

**Body:** `{ "expectedVersion": 1, "temperature": "hot" }`. Require both fields, a positive integer version and the exact domain; reject unknown fields, nulls and non-JSON content. Validate the UUID route parameter using existing lead rules. Follow existing session, trusted Origin, JSON size/content-type and no-store middleware.

**Success:** HTTP 200, the same envelope as the existing stage mutation containing current LeadDetail. A real change increments lead version once, updates updatedAt and appends exactly one `temperature_changed` event in the same serialized transaction. It changes no stage/assignment or related business state. All stages allow the action. Temperature survives reassignment.

Authorize live staff/current ownership and check expectedVersion before no-op detection. A same-value request with the current version returns current detail without changing version/updatedAt/history. Stale versions always return 409, including requests whose desired value already matches. No new submission ID or receipt format is introduced; no automatic retry of this optimistic mutation.

**Permissions:** Admin/Manager can update all agency leads. Agents can update only their current assignments. Existing live-staff validation applies inside the transaction. Missing/expired/invalidated sessions and disabled/banned staff return 401 `UNAUTHENTICATED`, consistent with requireCurrentStaff and sign-in recovery. An authenticated staff role forbidden from an operation returns 403 `FORBIDDEN`; temperature writes allow all three staff roles, so another Agent's lead is a resource-access 404 rather than a role-based 403. Inaccessible/nonexistent lead returns 404 `NOT_FOUND`. Do not change existing authentication behavior or return hidden lead details in errors.

**Errors:** existing structured error envelope. Invalid body/query uses 400 `VALIDATION_ERROR`; wrong content type uses existing 415 behavior; stale version uses 409 `CONFLICT`. Existing Origin/rate-limit/transport/5xx handling remains. A definite conflict makes no writes; a lost response is uncertain and needs an authorized read before another explicit write.

## Filtering and export

Add optional single `temperature=hot|warm|cold|unassessed` to `GET /api/v1/staff/leads` and `GET /api/v1/staff/leads/export`. Missing means all temperatures. Empty, repeated, unknown or incorrectly cased values return 400 under existing strict query validation.

Compose with current view/search/stage/source/agent/duplicate/sort filters and resource scope. Filter before counts/pagination and CSV row limits. Preserve existing sort order and fixed export columns; do not add a temperature CSV column. Pipeline reads already use the staff lead list endpoint and must forward this filter to each stage page.

Frontend list/pipeline page entries preserve repeated/array-valued search parameters until strict filter validation. Repeated temperature parameters show the existing invalid-filter state before any lead-result fetch, rather than being dropped and broadening results. This is a frontend route acceptance requirement; the API independently returns 400 for repeated values.

## Compatibility and privacy

The main API document declares `StaffCookie` and `staffSession` as references to its existing `staffCookie` scheme. All three names resolve to the same `agency.session` cookie definition, preserving existing consumers and imported staff contracts. Backend semantic contract tests resolve external references, reject every undeclared security-scheme name in the main document and check cookie requirements for lead list/create/export and temperature updates; frontend standalone snapshots keep their valid scheme declarations.

Public inquiry/chatbot/property contracts never accept or expose temperature. Manual create/contact patch/import request schemas remain unchanged and strict; temperature is edited through the dedicated route only. Existing import templates, digest/receipt versions and export column schemas remain unchanged. All creation paths use the database default.

`docs/api/leads.openapi.yaml` and the main API entry-point references are synchronized with this contract; the main entry independently resolves with openapi-typescript. The frontend `docs/contracts/leads.openapi.yaml` snapshot is the input for generated frontend declarations. The staff event union is a coordinated-consumer change represented by that updated generation.

## Reconciliation after uncertain saves

Never automatically resubmit. Fetch current authorized detail/history. Display current saved temperature; retain the proposed selection for review. If saved value equals the requested value, report the current saved state without claiming which request/actor produced it. If it differs, require an explicit new save using the refreshed version. If reads fail, keep writes blocked until reconciliation succeeds; session/access loss follows existing CRM recovery and privacy behavior.

The frontend detail screen coordinates temperature, stage, notes/calls and assignment with a parent-owned synchronous guard and shared pending/recovery state. Include assignment trigger/submission, including an already-open dialog. Block all four while a mutation is pending or an uncertain result remains unreconciled; preserve drafts and unblock only after the required authorized reads succeed. Standalone assignment dialogs retain existing behavior. This local coordination complements backend optimistic concurrency and never replaces it.
