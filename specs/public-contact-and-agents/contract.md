# Public contact and agent pages — API contract

Status: Verified — demo delivery accepted 2026-10-27. Backend-owned contract for the public-contact-and-agents feature; OpenAPI domains and frontend-local snapshots/generated declarations are synchronized. Real-business catalog publication remains gated.

## Shared conventions

Base `/api/v1`. JSON and `Cache-Control: no-store`; UTC ISO timestamps only where explicitly included. Strict request objects reject unknown fields. Read endpoints have no query parameters in this initial bounded-directory slice; reject unknown/duplicate query keys. Use existing safe error envelopes `{ error: { code, message, requestId, fieldErrors? } }`; do not return raw catalog, staff or persistence objects. Safe request-ID headers follow current API conventions.

## Public content and publication

The catalog contains agency public content plus up to 24 profiles. Catalog-only `published` and editorial order/source metadata are never returned. Public profiles have no Better Auth User foreign key, login email or internal staff identifier. Published profiles are stably sorted by public name, then slug.

`PublicAgency = { name, isDemo, phone: string|null, email: string|null, address: string|null, officeHours: Array<{ days: string, hours: string }>, timeZone: "Asia/Dubai", mapUrl: string|null }`.

`AgentPortrait = { src: string, width: number, height: number }` or null. `src` is an authored allowlisted frontend website asset path matching `/images/agents/[a-z0-9-]+.webp`; no arbitrary URL, relative traversal, SVG or auth-avatar URL. Dimensions are positive integers; frontend supplies portrait alt/fallback presentation. The two deployments coordinate those public assets without importing sibling source.

`PublicAgentSummary = { slug, name, title, specialties: string[], portrait: AgentPortrait, isDemo }`.

`PublicAgentDetail = PublicAgentSummary & { introduction: string, biography: string[], languages: string[], publicPhone: string|null, publicEmail: string|null }`.

Plain text only. Catalog bounds: agency/name/title up to 120 characters; slug 1–80 lower-case ASCII letters/digits separated by single hyphens; introduction 1–320; biography 1–3 paragraphs, each 1–1500; specialties/languages up to 8 entries each, 1–80 per entry; address up to 500; at most 7 hours rows with text up to 120 per field. Publish only usable configured contacts. Catalog phone/publicPhone replace every JavaScript whitespace character (including NBSP, narrow NBSP, tabs and newlines) with ASCII space, then trim before the 3–40-character, plus/digits/ASCII spaces/parentheses/hyphens and at-least-one-digit checks. Preserve repeated internal spaces; public responses contain canonical values. Email follows existing contact validation, while the frontend makes safe `tel:`/`mailto:` links from canonical values. mapUrl is an approved absolute HTTPS URL without credentials, rather than arbitrary HTML or an embedded script.

Catalog validation must reject duplicate slugs, malformed values and more than 24 profiles before exposing content. An invalid catalog fails closed for content reads with safe 503 feedback rather than publishing a partial/unreviewed directory or leaking validation internals. It must not silently alter the already-delivered property/staff APIs. Validate publication flags and DTO projections explicitly; draft profiles are absent from counts and responses. Demo contact values must not dial/email an unrelated real person: use null for unavailable channels.

## Content endpoints

- `GET /public/agency` → 200 `PublicAgency`; content unavailable/invalid → 503. Anonymous, read-only.
- `GET /public/agents` → 200 `{ items: PublicAgentSummary[], total: number }`, with `total === items.length`, 0–24 records. A valid empty directory returns an empty array, not 404. No search/pagination parameters in this slice.
- `GET /public/agents/:slug` → 200 `PublicAgentDetail`; malformed/unknown/unpublished slug → 404 with the same safe envelope. Content outage → 503. No draft enumeration or auth lookup.

Fields excluded from every public response: User ID, auth email/image/role/status, sessions/accounts, owner contact, lead counts/history, client contact, private notes, publication flags and internal editorial data. Contact fields appear only when supplied specifically for public publication.

## Property-independent inquiry

`POST /public/inquiries`

Body: `{ submissionId, name, purpose, phone?: string|null, email?: string|null, message }`.

- submissionId is a UUID. Name trims to 1–120 characters.
- purpose is required and is `sale` or `rent`; there is no implicit default or unsupported “other” mapping.
- Require phone or email. Phone uses the same whitespace-to-ASCII-space normalization and trim before the existing 3–40-character, allowed-character and at-least-one-digit checks. Preserve repeated internal spaces; padded raw inputs can exceed 40 characters. Storage, search and receipt hashes use the canonical phone, so the same key and whitespace-equivalent payload replay without duplicate leads/events; email trims/lowercases and is syntactically valid, at most 254 characters. Optional blank UI fields become null; supplied empty strings are rejected by the API.
- message is required plain text, trimmed to 1–2000 characters. No HTML interpretation.
- Reject extra keys including propertyId, budgetFils, source, stage, assignedAgentId, staff/user ID and preferred-agent routing. This endpoint does not assign a person selected from the public directory.

Server creates an existing Lead with supplied normalized contact/purpose/message, `source="website"`, `stage="new"`, `assignedAgentId=null`, `assignedAgentNameSnapshot=null`, `createdById=null`, `propertyId=null`, property snapshots=null and budget=null. Populate existing search fields. Atomically append one existing created activity (public Website actor) and one submission receipt; there is no new activity/lead DTO shape or database model planned.

Use receipt operation `agency_inquiry`, actor scope `public`, and a canonical hash including purpose, name, normalized/null contacts and message. Existing property inquiry operation remains `inquiry` and its hash includes property ID. Identical committed replay → 200 `{ received: true }`; first committed submission → 201 `{ received: true }`. Reused ID with different canonical payload or another operation → 409. Concurrent identical submissions resolve to one lead/activity/receipt, never duplicate rows. Preserve receipts with existing retention conventions; do not add public receipt/lead lookup.

Responses never include lead IDs, assigned staff, submitted contacts, message contents, hashes or database errors. There is no automatic email/WhatsApp delivery or promise of a scheduled viewing. The existing manager-controlled inbox and assignment policy applies; existing Agents cannot see the unassigned record.

## Request protection and failure behavior

For POST, apply existing no-store → exact trusted APP_ORIGIN → shared inquiry relay/limiter → JSON content type → bounded 16KiB JSON parser → independent schema validation → transaction. No staff session/public signup is required. Public reads do not grant staff access.

Property and general inquiries share one limiter instance per app factory, including the same relay-verified client identity. Five attempts per rolling 15 minutes across both routes, including rejected/replay attempts after Origin check; sixth attempt → 429 with Retry-After. Retain existing capacity=10,000 live identities, hashed identities, fail-closed 503 capacity behavior and single-process/restart limitations. Reject invalid relay headers rather than bypassing into another identity bucket. Keep current trusted ingress and secret configuration; never expose it in catalog/client responses.

400 for invalid payload/JSON, 403 for untrusted Origin/relay, 409 for receipt conflict, 413 for oversize, 415 for non-JSON, 429 for rate limit, 503 for unavailable service. Safe unexpected errors follow existing handling. Creation cannot acknowledge success before commit. Rolled-back known transaction contention may use the existing bounded transaction policy; never replay a potentially committed write automatically at the HTTP/client boundary.

## Compatibility and implementation work

These are additive routes. `POST /public/properties/:propertyId/inquiries`, its input, replay semantics, property eligibility and acknowledgement remain unchanged; staff lead DTOs and permission checks remain unchanged. No property-agent relationship is introduced. Existing Lead nullable property fields, originalMessage and text receipt operation suffice without a migration.

Public content OpenAPI lives in `docs/api/public-agency.openapi.yaml`; `docs/api/leads.openapi.yaml` contains the general inquiry input/operation; both are merged into the backend API document. Frontend snapshots and its third-domain generation entry are synchronized. This Markdown records the delivered contract; the OpenAPI documents remain the HTTP contract source.
