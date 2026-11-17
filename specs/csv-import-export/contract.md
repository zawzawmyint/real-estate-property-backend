# CSV export contract

Status: Implemented on 2026-11-11 — backend-owned contract for the delivered export-only slice. Import is not part of this contract.

## Endpoints and inputs

- `GET /api/v1/staff/leads/export`: accepts `view`, `q`, `stage`, `source`, `agentId`, `sort` and optional `duplicates=only`, with the exact values, length limits, defaults and access rules of the current lead list, excluding `page`. `duplicates=only` selects rows with other currently accessible canonical-phone matches before export; it does not add duplicate columns.
- `GET /api/v1/staff/properties/export`: accepts `purpose`, `type`, `location`, `minPriceFils`, `maxPriceFils`, `minBedrooms`, `featured`, `q`, `publishingState`, `availability`, `sort`, matching current staff property list validation/defaults, excluding `page` and `pageSize`.
- Parameters are optional; existing role-dependent defaults apply. Empty/invalid values follow current list validation. Unknown or repeated keys, including pagination keys, return 400. Query values never choose an export role or columns.
- Authentication uses the existing staff session cookie. Agent lead requests for disallowed views/other agents return 403. Admin/Manager `agentId` without `view=all` returns 400. Missing/invalid live sessions return 401.

## Success response

- `200`, `Content-Type: text/csv; charset=utf-8`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`.
- `Content-Disposition: attachment; filename="leads-YYYY-MM-DD.csv"` or `properties-YYYY-MM-DD.csv`; filename date is the export-start date in `Asia/Dubai`, using server-generated fixed names only.
- UTF-8 BOM, comma separator, CRLF record endings, one header row, normal CSV quoting, and formula escaping enabled. Zero rows returns BOM plus the appropriate header and CRLF.
- Null/missing optional values become empty cells. Booleans are `true`/`false`; enums retain API tokens. Monetary values are AED decimal strings with two fraction digits, computed from integer fils without floating-point rounding. Area is square feet with two fraction digits. Timestamps are ISO 8601 UTC with `Z` and headers explicitly name UTC.
- Apply `csv-stringify` formula escaping to text fields, including leading `=`, `+`, `-`, `@`, tab/CR and supported Unicode variants. Quoting alone is not formula protection. Test installed-version behavior and cover any gaps explicitly. No spreadsheet formulas are generated. Numeric/boolean outputs are controlled server mappings.

## Lead columns, in order

Header names are fixed lowercase snake_case:

`lead_id, name, phone, email, purpose, budget_aed, source, stage, assigned_agent_id, assigned_agent_name, property_id, property_title, property_location, created_at_utc, updated_at_utc`

Use the same current-agent/name fallback and property title/location snapshots exposed by `leadDto`; no staff email, internal search fields, receipt IDs, original inquiry message, version or activity fields. Missing current assignment produces an empty ID and the existing previous-agent-name fallback where applicable. Property identifiers/titles do not imply availability; this CSV does not change the CRM contract.

## Property columns, in order

All roles:

`property_id, title, purpose, type, price_aed, city, community, bedrooms, bathrooms, area_sqft, publishing_state, availability, featured, is_demo, created_at_utc, updated_at_utc`

Admin/Manager append `owner_name, owner_phone`. Agents omit these two headers and values, rather than receiving blank owner fields. No description, photos, storage keys or private documents.

## Errors and bounds

- Use the existing JSON error envelope and request-ID behavior; never attach CSV download headers to errors. Preserve normal 401/403 handling and safe 5xx responses.
- `400 VALIDATION_ERROR`: invalid/duplicate/unknown query input or contradictory ranges.
- `422 EXPORT_LIMIT_EXCEEDED`: more than 5,000 matching rows, or encoded CSV exceeds 10,485,760 bytes. Safe message: `Too many results to export. Narrow your filters and try again.` No CSV bytes are sent.
- Empty results are not an error. A failed request can be retried explicitly; no automatic client download retries or silent partial results.

## Ownership and compatibility

Express owns authorization, data selection and CSV bytes. Browser requests use the existing frontend `/api/v1/:path*` rewrite; `API_URL` remains server-only. The additive routes are published in the backend lead/root OpenAPI documents and represented in the existing frontend domain snapshots and generated types. The frontend property snapshot keeps its repository-local reference adaptation.
