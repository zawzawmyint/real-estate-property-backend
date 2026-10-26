# Property API contract

Status: Implemented and verified on 2026-10-22.

Backend-owned source: `backend/specs/property-management/contract.md`. Identical frontend snapshot: `frontend/docs/contracts/properties.md`. Both repositories are independent. `docs/api/openapi.yaml` is the implemented machine-readable contract; the frontend snapshot and generated types are checked for drift. Auth retains its native protocol.

## Data conventions

- IDs: server-generated UUID strings. Timestamps: UTC ISO 8601. Responses are explicit DTOs, never raw Prisma records.
- `purpose`: `sale | rent`. `type`: `apartment | villa | townhouse | penthouse` (residential scope). `publishingState`: `draft | published | archived`. `availability`: `available | sold | rented`.
- Money: `priceFils`, integer 1..1,000,000,000,000 when set; currency is always AED. Sale is total price; rent is annual price. UI converts exact decimal AED to fils without floating-point rounding. No monthly period or currency field in requests.
- `areaSqft`: canonical positive decimal string with at most two decimal places, at most `1000000`. Store integer hundredths in SQLite and return a string with two places (e.g. `1186.00`). Do not silently round extra precision.
- `bedrooms`: integer 0..20, where 0 means Studio. `bathrooms`: integer 0..20.
- Text is trimmed, plain text; never render property descriptions as raw HTML. `title`: 1..160 characters; `description`: 1..10000; `city` and `community`: 1..120 each; `ownerName`: 1..120; `ownerPhone`: 3..40, permitting international prefixes, digits, spaces, parentheses and hyphens with at least one digit. No client-side HTML sanitisation substitutes for safe text rendering.
- Reject unknown keys, invalid enum values and wrong JSON types. Empty strings for optional fields must be normalised to null by the UI; backend rejects empty supplied text. IDs, storage keys, timestamps and derived URLs are never client-writable.

## Property inputs and completeness

`CreateProperty`: `{title,purpose}` plus optional `type,description,priceFils,city,community,bedrooms,bathrooms,areaSqft,ownerName,ownerPhone,featured`. Omitted nullable fields become null; `featured=false`, `publishingState=draft`, `availability=available`. Reject publishingState/availability on create.

`PatchProperty`: nonempty partial object of create fields plus `publishingState,availability`; nullable fields may be explicitly null on drafts. Title/purpose cannot be null. Booleans are actual JSON booleans. An update is atomic: invalid merged state rejects the entire patch.

- Publish requires nonnull type, description, priceFils, city, community, bedrooms, bathrooms, areaSqft, ownerName and ownerPhone, plus 1..12 saved photos and availability available. Title/purpose are always required.
- Published edits must preserve complete fields/photos even if marked sold/rented. Move to draft first to save incomplete fields or remove the last photo.
- sold is sale-only; rented is rent-only. Reject incompatible purpose/availability combinations in the merged state.
- draft->published, draft->archived, published->draft, published->archived and archived->draft are valid. Same-state assignments on draft/published records do not create a separate transition. Archived->published is invalid. For an archived property, only `{publishingState:"draft"}` is accepted; do other edits after restore.
- `featured` is an Admin/Manager boolean; homepage requests only featured public-eligible records. There is no automatic featured fallback to draft/private stock.
- Scalar concurrent edits use last committed write wins; no automatic mutation retries. Photo count/order and lifecycle checks are transactional to prevent broken invariants.

## Response DTOs

`Photo = {id,url,width,height}`: generated public URL and positive normalised pixel dimensions. Ordered arrays define display order; first is cover. Do not return storage keys or original filenames.

`PublicPropertySummary = {id,title,purpose,type,priceFils,city,community,bedrooms,bathrooms,areaSqft,coverPhoto,isDemo}`. All fields are nonnull for eligible properties; coverPhoto is Photo. Currency/rental period are derived from conventions above. `isDemo` is a read-only boolean (false for ordinary API-created records); true marks fictional sample inventory. Internal `demoKey` is never returned or writable through the API.

`PublicPropertyDetail = PublicPropertySummary + {description,photos}`. `photos` is ordered and includes the cover photo. No ownerName, ownerPhone, staff IDs, publishingState, availability, featured or internal timestamps in public DTOs.

`StaffProperty = {id,title,purpose,type,description,priceFils,city,community,bedrooms,bathrooms,areaSqft,publishingState,availability,featured,photos,createdAt,updatedAt,isDemo}`. Draft nullable fields remain null; `photos=[]` is valid. Admin/Manager also receive `ownerName,ownerPhone` (nullable until complete). Agent responses omit both keys entirely. `updatedAt` changes on field/state/photo mutations. `isDemo` has the same read-only semantics as public DTOs.

List envelope: `{items,total,page,pageSize}`; total is the count under the same filters/access scope. Detail/create/update/upload/remove-photo return the full applicable DTO directly. Property hard-delete returns 204 with no body.

## Queries

Public `GET /api/v1/properties`:

- `purpose`, `type`: optional enums above.
- `location`: trimmed case-insensitive substring over city OR community, 1..120 characters when present.
- `minPriceFils,maxPriceFils`: integers 0..1,000,000,000,000; min <= max, inclusive; compare the stored sale total or annual rent. UI labels budget units explicitly and defaults to Buy.
- `minBedrooms`: integer 0..20, inclusive.
- `featured`: optional literal `true` or `false`; omitted means no featured filter.
- `sort`: `newest | price_asc | price_desc`, default newest (createdAt descending); ID ascending breaks ties.
- `page`: integer 1..10000, default 1. `pageSize`: integer 1..48, default 12. Out-of-range page within allowed range returns empty items with correct total; never clamp silently.

All supplied filters combine with AND, except city/community matching uses OR. Eligibility is always `publishingState=published AND availability=available`. Reject duplicate/unknown query keys and malformed numeric strings (no decimal/exponent pagination or price integers). Empty optional query fields are omitted by the UI; raw empty query values return 400.

Staff `GET /api/v1/staff/properties`: same filters plus `q` (trimmed 1..160, title/city/community substring), `publishingState`, `availability`; adds `updated_desc` sort and uses it as default. Search never matches owner fields. Eligibility filtering is absent; all inventory states are accessible subject to current staff access. Return StaffProperty items with role-specific projection. Shared queries must not permit public state filters.

Frontend URL filters use the same query names and integers; display inputs show AED and convert to fils before URL submission. Homepage purpose is explicit sale/rent. All filter changes reset page to 1, preserve other applied filters and produce GET URLs.

## Endpoints

- `GET /api/v1/properties` — anonymous 200 list of PublicPropertySummary.
- `GET /api/v1/properties/:id` — anonymous 200 PublicPropertyDetail or 404 for any ineligible/missing ID.
- `GET /api/v1/staff/properties` — current Admin/Manager/Agent, 200 staff list.
- `GET /api/v1/staff/properties/:id` — current Admin/Manager/Agent, 200 StaffProperty or 404.
- `POST /api/v1/staff/properties` — Admin/Manager, JSON CreateProperty, 201 StaffProperty with Location pointing at its staff resource.
- `PATCH /api/v1/staff/properties/:id` — Admin/Manager, JSON PatchProperty, 200 StaffProperty. Archive/restore/publish/unpublish use this endpoint; no duplicate transition endpoints.
- `DELETE /api/v1/staff/properties/:id` — Admin only, property must be archived, 204. Return 409 for nonarchived existing records. Missing resource returns 404, including a retry after confirmed deletion.
- `POST /api/v1/staff/properties/:id/photos` — Admin/Manager, one raw file, declared Content-Type image/jpeg, image/png or image/webp, 201 StaffProperty. Only draft/published properties accept uploads. Append to order; first upload becomes cover. No multipart or base64 payload.
- `PATCH /api/v1/staff/properties/:id/photos/order` — Admin/Manager, JSON `{photoIds:string[]}`, exact permutation of current photo IDs, no duplicates/foreign IDs/omissions; 200 StaffProperty. First ID is cover. Reject concurrent stale sets with 409; refetch to resolve.
- `DELETE /api/v1/staff/properties/:id/photos/:photoId` — Admin/Manager, 200 StaffProperty. Reject last-photo deletion on published properties with 409; archived mutations fail. Photo must belong to property; otherwise 404. Removal preserves relative order and promotes the next photo to cover.

## Request boundaries and errors

- All responses: no-store. Every staff operation uses existing live database session guards; invalid/expired/revoked session is 401 UNAUTHENTICATED, valid disallowed role is 403 FORBIDDEN. Session-store outage fails as service error, not anonymous success.
- POST/PATCH/DELETE require exact trusted APP_ORIGIN; missing/null/foreign Origin is 403 INVALID_ORIGIN. Authenticate/authorise before reading image bytes; limit body even when Content-Length is missing. JSON uses existing 100 KiB limit. Unsupported JSON/image Content-Type is 415 UNSUPPORTED_MEDIA_TYPE.
- 400 VALIDATION_ERROR: invalid fields/query, malformed UUID or incomplete publish. Existing parser uses 400 INVALID_JSON for malformed JSON. 404 NOT_FOUND: missing/ineligible public record, missing staff record or wrong photo membership. 409 CONFLICT: invalid transition, archived write, invalid current photo set, photo-count limit or published last-photo removal.
- 413 PAYLOAD_TOO_LARGE: byte limit exceeded; 400 INVALID_IMAGE: malformed image, mismatched MIME, animation, decoded-pixel limit or unsupported decoded content despite an allowed MIME. 500 INTERNAL_ERROR for unexpected storage/database failure; never expose paths, credentials or owner details. Preserve requestId for diagnostics.
- Error body remains `{error:{code,message,requestId}}`. No new shared error envelope or native-auth protocol changes. Error messages may describe missing public fields but do not echo private values.

## Image constraints and operational consistency

Max 12 photos/property; raw body <=5,242,880 bytes; decoded pixels <=25,000,000. JPEG/PNG/WebP only, single-frame, normalise orientation, strip metadata, output WebP <=2400px longest side without enlargement. Record output width/height. Reject SVG/GIF/PDF and remote URL submissions. `sharp` 0.35.5 performs decoding and normalisation.

Listing photos are public via existing `/media/:key` even while attached to a draft. They are never private documents. Generated keys only. Compensate a failed DB attachment by deleting its saved file. Commit removal before physical cleanup; cleanup errors are logged with generated keys/request ID and retried through the documented maintenance procedure. Back up SQLite and media together. Crash orphan reconciliation needs dry-run and a maintenance window; no claim of atomic disk/database transactions.

## Compatibility and acceptance

This additive business API preserves health and Better Auth routes. Public/staff privacy, lifecycle/role matrix, filters, upload failure recovery and real SQLite/browser verification are recorded in the feature specification.
