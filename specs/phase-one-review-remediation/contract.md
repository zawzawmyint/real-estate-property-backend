# Phase 1 review remediation contract

Status: Implemented and verified with backend and cross-repository checks — Git delivery remains pending.

## Inquiry ingress

Applies to `POST /api/v1/public/inquiries` and `POST /api/v1/public/properties/:propertyId/inquiries`.

- In production, both `x-inquiry-client-key` and `x-inquiry-relay-signature` are required. Preserve the existing 64-character lowercase hexadecimal validation and HMAC-SHA256 signature verification with server-only `INQUIRY_RELAY_SECRET`.
- Missing, partial, malformed or invalid signatures return HTTP 403 using the existing `FORBIDDEN` / `Untrusted inquiry relay` safe error contract, before limiter consumption and lead creation. Do not fall back to socket identity in production.
- Outside production, absence of both headers retains the hashed socket identity. Supplying either header always invokes full validation; invalid headers never fall back.
- Trusted Origin remains required before relay/limiter processing. Existing bounded JSON parsing, strict payload validation and middleware order are retained.
- Valid signed clients share five attempts per rolling 15 minutes across both routes; preserve `429` plus `Retry-After`, capacity 10,000 and fail-closed `503`. The limiter remains single-process and is not a distributed abuse-prevention service.
- The frontend server relay signs requests; secrets and raw identities are not published. Public visitors do not need staff sessions.

## Inquiry data and replay

- Existing request schemas and canonical payload hashing remain authoritative; no fields are added or removed.
- First committed submission returns `201 { received: true }`; identical replay returns `200 { received: true }`; changed canonical payload or operation on the same submission ID retains `409`.
- Preserve atomic lead/activity/receipt persistence, property eligibility, private-field exclusions and existing validation errors.
- Retry after an uncertain response uses the original submission ID and exact values. Editing as new requires explicit frontend confirmation, then a fresh ID on the next send. It can create another lead if the original succeeded; do not promise deduplication across distinct IDs.

## Staff service validation

- `requireCurrentStaff(identity: Actor, tx: Transaction): Promise<Actor>` is an internal backend interface; no HTTP DTO changes.
- Lookup matches both session ID and user ID, requires unexpired session and existing user, and rejects disabled/banned/non-staff users or mismatched credential versions with existing 401 `UNAUTHENTICATED` / `Staff sign-in required`.
- Return current stored ID/name/role with the same session ID. Do not trust captured role/name for resource scoping.
- Call inside leads/viewings/tasks transactions and inside the dashboard aggregate transaction. Keep route `requireStaff`, manager-only authorization, ownership checks and conflict handling.

## Compatibility and documentation

- User clarification (2026-11-05): inquiries currently come only from the frontend. No external direct production inquiry integration needs compatibility; signed-only production ingress is implemented.
- Breaking ingress change: unsigned production HTTP callers must use the supported signed server relay. No database, credential format, session cookie or public response migration is needed.
- `docs/api/leads.openapi.yaml`, the related Markdown contracts and frontend snapshots were reconciled. Existing OpenAPI remains the published HTTP source. Backend checks and scoped cross-repository browser/runtime acceptance pass; an authorized scoped commit remains outstanding.
