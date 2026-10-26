# Lead management API contract

Status: Implemented and verified, 2026-10-26.

Backend-owned contract for [feature specification](spec.md). The authoritative backend OpenAPI is `docs/api/leads.openapi.yaml`, merged into `docs/api/openapi.yaml`; this repository-local Markdown contract and the frontend snapshots describe the delivered API.

## Conventions and validation

- Base `/api/v1`; new record IDs UUID strings; staff IDs opaque existing User IDs. Dates UTC ISO 8601. All responses `Cache-Control: no-store`.
- Strict JSON objects, reject unknown fields/wrong types; trim plain text and safely render as text. Nullable optional inputs accept null; reject supplied empty strings. Frontend converts blank optional controls to null. POST JSON body limit 16 KiB for these routes.
- `name`: 1–120 characters; `email`: syntactically valid, <=254, normalized trim/lowercase; `phone`: 3–40 characters, international prefix/digits/spaces/parentheses/hyphens, >=1 digit. Require phone or email. Phone search strips formatting, preserving digits; do not claim country-aware normalization or deduplication.
- `purpose`: sale/rent; `source`: website/call/walk_in; `stage`: new/contacted/viewing_scheduled/offer/won/lost.
- `budgetFils`: null or integer 1..1,000,000,000,000, JSON number within safe integer range; stored BigInt, explicit DTO conversion. AED only; sale total, rent annual. UI converts at most two decimal places exactly and rejects extra precision rather than rounding.
- `message`: null or 1–2000 characters. `note.body`: 1–5000. `submissionId`: UUID, distinct per deliberate inquiry/manual create/note, stable during explicit uncertain-save retry. `expectedVersion`: positive integer.
- Search normalized case-insensitively using existing Unicode search approach; literal substring, never SQL wildcards. `q` <=120 characters. Invalid enum/query/UUID => 400. Staff IDs are not UUID-validated.

## DTOs

`StaffSummary = {id,name,available:boolean}`; no email/session fields. `PropertyContext = {id:string|null,title,location:string|null,available:boolean}`. Context null if no selected property; retained snapshot with id=null if deleted. Available means eligible for new linking; existing inaccessible/unavailable links must not create owner-data leaks.

`LeadSummary = {id,name,phone:string|null,email:string|null,purpose,budgetFils:number|null,source,stage,assignedAgent:StaffSummary|null,previousAgentName:string|null,property:PropertyContext|null,createdAt,updatedAt,version}`. `previousAgentName` is only populated for a removed assignee whose FK became null; otherwise null. Disabled/demoted live users have available=false in assignedAgent.

`LeadDetail = LeadSummary & {originalMessage:string|null}`. Return summaries for lists, details for GET/create/patch. Source, originalMessage, creator and timestamps are never client-editable. Do not expose receipt hashes, normalization fields, property owners or staff email addresses.

`Activity = {id,type,actor:{id:string|null,name}|null,createdAt,note:{id,kind,body}|null,assignment:{from:{id:string|null,name}|null,to:{id:string|null,name}|null}|null,stageChange:{from,to}|null,changedFields:string[]}`. Only relevant event fields populated; public creation actor null and displayed Website. Each note/call appears once through its event. changedFields contains allowed Lead field names, never old/new private values.

`Page<T> = {items:T[],page,pageSize:20,total}`. List response additionally `unassignedCount:number|null` (null for agents), from a consistent read with page totals where supported. Count all assignedAgentId=null independently of list filters. Stable timestamp sorting always adds id tie-breaker. Activity pagination uses the same page envelope sorted `(createdAt desc,id desc)`; refresh resets activity to page 1 to avoid offset drift. No unbounded includes.

## Public inquiry

`POST /public/properties/:propertyId/inquiries`

Body `{submissionId,name,phone?:string|null,email?:string|null,message?:string|null}`. At least one contact method. Server takes purpose and property snapshots from a published/available property and forces source=website, stage=new, assignedAgentId=null, actor=null, budget=null. No guest authentication required. Trusted application Origin required; independent backend schema validation.

201 `{received:true}` after committed creation; identical replay returns 200 `{received:true}` even if property subsequently becomes unavailable, since receipt is checked before new-submission eligibility. Key reused with changed payload => 409. No public read/lead identifiers. New submissions to missing/draft/archived/sold/rented properties => 404. Phone/email never cause cross-person deduplication in this slice.

Rate limit: 5 attempts per real-client identity in a rolling 15 minutes, including replays and invalid attempts after Origin check. Use an in-process bounded map capped at 10,000 live identities, expire old entries on access; fail closed with 503 if full rather than permitting bypass. The limiter is single-process only; multiple instances require a shared limiter decision before rollout. Return 429 and Retry-After seconds; no durable raw-IP logging/storage. Limiter reset on restart is a documented limitation. Honeypot/CAPTCHA not included.

## Staff reads and candidate lookup

- `GET /staff/leads?view=unassigned|all|mine&q=&stage=&source=&agentId=&sort=newest|oldest|updated&page=1`: Admin/Manager default unassigned, Agent mine; 200 paginated LeadSummary with unassignedCount. Admin/Manager may select mine (usually empty because only agents receive assignments). Agents submitting all/unassigned or another agentId => 403; never silently widen. agentId only in all view for Admin/Manager, may reference inactive identities to redistribute. Search covers name, normalized phone/email, property snapshot title. Page positive <=1,000,000; out-of-range page returns empty items with actual total.
- `GET /staff/leads/:id`: 200 LeadDetail; Admin/Manager all, Agent current own only.
- `GET /staff/leads/:id/activity?page=1`: 200 Page<Activity>, same resource access guard.
- `GET /staff/leads/assignment-candidates?q=&page=1`: Admin/Manager only, 200 Page<StaffSummary>, only active nonbanned role=agent, name substring, alphabetical then id. Register static route before `/:id`. Name/id only. This is not general staff-directory access.
- Property picker consumes existing authorized staff property list API, filtering available draft/published records as supported; if its existing contract cannot express eligibility, filter only its bounded page and label empty results accurately rather than claiming global no matches. Backend still validates eligibility. No public owner-data lookup.

## Staff writes

Every route requires current native session, trusted APP_ORIGIN and JSON. Unauthenticated 401, disallowed role 403, valid inaccessible lead 404. Session/database outage fails closed. Access checks and receipt replays use current ownership.

- `POST /staff/leads`: body `{submissionId,name,purpose,source:call|walk_in,phone?,email?,budgetFils?,propertyId?,assignedAgentId?}`. Nullable optionals default null. Admin/Manager may omit/null assignment or specify eligible agent. Agent may omit assignment or supply own ID; null/another ID =>403. New stage only. Initial manual message excluded; notes use the note endpoint. 201 LeadDetail, replay 200 current authorized LeadDetail. At creation link validation/snapshots and created event are atomic.
- `PATCH /staff/leads/:id`: `{expectedVersion,...nonempty partial(name,phone,email,budgetFils,purpose,propertyId)}`; authorize current owner, validate merged complete state and property/purpose pair. Omission preserves, null clears nullable fields. 200 LeadDetail; unchanged fields => no increment/event. Source, originalMessage, assignment and stage rejected here. Stale expectedVersion =>409 even for an otherwise no-op body.
- `PATCH /staff/leads/:id/assignment`: Admin/Manager only; `{expectedVersion,assignedAgentId:string|null}`; eligible target agent or null. 200 LeadDetail, actual change increments version plus one assigned/unassigned event atomically; same assignment no-op after version check. Ineligible target =>409. Race with another update =>409; no last-writer-wins overwrite.
- `PATCH /staff/leads/:id/stage`: `{expectedVersion,stage}`; allowed for Admin/Manager and current agent. Any supported transition including reopening; no implied viewing or deal creation. 200 LeadDetail; same stage no-op after version check. Actual change increments version plus event atomically.
- `POST /staff/leads/:id/notes`: `{submissionId,expectedVersion,kind:note|call,body}`; same ownership rule. 201 `{note:Activity,leadVersion:number}`, replay 200 same event plus current leadVersion after ownership recheck. Check matching receipt before expectedVersion so a lost-response retry succeeds; a distinct submission with stale version =>409. No edit/delete notes endpoint.

## Concurrency and errors

Within a transaction: current-session/resource access, target/property checks, expected-version conditional update scoped to current ownership, note/lead persistence, activity append and receipt creation. Concurrent identical submission keys resolve through a unique receipt constraint and safely reread committed receipt; never return a partial success. Assignment and note races must not allow the old owner to write after reassignment has committed. Revalidate current session/role using adopted auth boundaries; do not build a second auth protocol.

Reuse `{error:{code,message,requestId}}`; no raw input/database exception text. Codes: 400 VALIDATION_ERROR or INVALID_JSON; 401 UNAUTHENTICATED; 403 FORBIDDEN or INVALID_ORIGIN; 404 NOT_FOUND; 409 CONFLICT; 413 PAYLOAD_TOO_LARGE; 415 UNSUPPORTED_MEDIA_TYPE; 429 RATE_LIMITED with Retry-After; 503 SERVICE_UNAVAILABLE for saturated limiter; existing service/database failure conventions otherwise. Client form schema provides field-level validation; backend rejection maps to a safe persistent form error, preserving the existing error envelope.

No automatic mutation retries. Explicit replay only for submissionId operations; PATCH uncertainty requires fresh authorized GET and review. No new global idempotency framework, background notifications or lead endpoint is implied beyond this contract.
