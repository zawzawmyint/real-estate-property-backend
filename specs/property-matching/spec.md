# CRM property matching (P2-03)

Status: Verified 2026-11-09

## Goal

Return shareable public listings that fit criteria confirmed by staff while working a lead.

## Scope and exclusions

- In scope: one read-only, lead-scoped staff operation over live published and available inventory. A linked property is optional.
- Out of scope: parsing inquiry messages, calling a model or external provider, storing search filters or results, sending messages, and changing leads or property availability.

## Behavior and contracts

**API.** `GET /api/v1/staff/leads/{id}/property-matches`, operation ID `listLeadPropertyMatches`, with `Cache-Control: no-store`.

| Query parameter | Contract                                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------------------------ |
| `purpose`       | Required. `sale` or `rent`, supplied by the confirmed form.                                                        |
| `maxPriceFils`  | Optional integer from 0 to 1,000,000,000,000. Inclusive maximum. Sale uses total price and rent uses annual price. |
| `location`      | Optional nonblank trimmed string of up to 120 characters. Reuse normalized city/community matching.                |
| `type`          | Optional existing property type enum.                                                                              |
| `exactBedrooms` | Optional integer from 0 to 20. Zero matches studios. Omission accepts any bedroom count.                           |
| `page`          | Optional integer from 1 to 10,000. Defaults to 1.                                                                  |

Reject unknown parameters, duplicates and invalid values with the existing validation envelope. The frontend initializes the query from the lead and explicitly sends the confirmed values. Omitting the cap means no budget filter. The endpoint never derives criteria from free text or from the linked property.

**Response.** HTTP 200 uses the existing `PublicPropertyList` shape with `items`, `total`, `page`, and fixed `pageSize: 10`. Each item is a `PublicPropertySummary`. Reuse the existing stable newest order, apply all filters before pagination, and return an empty list when there are no matches. The original property may appear if it qualifies.

**Access.** Reuse the lead detail live-session and resource checks. Admin and Manager use their existing agency access, and Agent access is limited to assigned leads. Keep the same 401/403 behavior for inactive or unauthorized sessions and 404 behavior for missing or inaccessible lead records. Authorize using current lead ownership before inventory lookup. Return only public listing fields, and perform no writes.

## Acceptance criteria

- [x] General inquiries, property inquiries and manual leads are eligible under the same access rules.
- [x] Anonymous, inactive and out-of-scope staff cannot obtain matches through this route.
- [x] Only available, published properties of the chosen purpose appear. All filters, including exact bedrooms and the inclusive price cap, apply before pagination.
- [x] Invalid inputs return the existing validation envelope. No matches returns HTTP 200 with an empty list. The operation never mutates data or calls an external provider.
- [x] The backend OpenAPI operation and the frontend leads snapshot agree.

## Validation

Use the existing lead and property fixtures for role scope, general inquiries without a linked property, studios, annual rent boundary, mixed publishing/availability, stable pagination and invalid input. Run the backend quality checks and verify the frontend flow against disposable SQLite.

## Risks and rollout

This is an additive route with no database migration. Deploy it before the frontend feature and roll back the frontend entry point first. The operation is present in the backend OpenAPI document and uses the existing public listing response schema. The feature is verified locally but not deployed, so it does not complete the initial Phase 2 release.

## Implementation evidence

Delivered and verified on 2026-11-09. In one serialized SQLite transaction, the operation checks the current staff record and lead ownership before performing the public available-listing search. It has no write, provider or extraction path. Backend integration coverage includes both website-inquiry sources, manual and property-linked leads, studio/exact-bedroom matching, a zero cap, annual-rent boundaries, filtering before pagination and role access.

Backend lint, typecheck and production build passed with 154 tests in 39 files. The matching OpenAPI operation parsed with exact parity to the generated frontend snapshot apart from local references. The stock formatter remains blocked by inherited CRLF checkout differences; full Prettier with automatic end-of-line handling passed after formatting the new draft.
