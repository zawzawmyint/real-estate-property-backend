# Public agency directory languages

Status: Delivered 2026-11-02 — backend directory-language projection for the approved agency-page redesign.

## Goal

Expose existing public catalog languages in the directory response so the frontend can render the selected agent cards without per-agent detail requests.

## Scope and exclusions

- Add `languages: string[]` to the public agent summary projection and OpenAPI schema; preserve the existing detail response.
- Preserve current validation, stable publication ordering, anonymous read permissions and safe DTO whitelists.
- No database/catalog schema, migration, auth, assignment, inquiry endpoint, query/filter, delivery provider or deployment configuration change.
- All three page layouts and shared form presentation are frontend-owned: workspace `frontend/specs/public-agency-pages-redesign/spec.md` and its pinned images 1/5/9.

## Behavior and contracts

Authority for the delivered delta: [contract.md](contract.md). Baseline behavior remains in [the existing public contact/agents contract](../public-contact-and-agents/contract.md).

`GET /api/v1/public/agents` retains `{ items, total }`; each item gains a detached copy of the validated catalog languages array. Existing schema bounds allow 0–8 entries, each trimmed 1–80 characters. Do not add summary biography, direct channels, internal publication flags or staff fields. The detail DTO already exposes languages; avoid a duplicate projection after sharing the summary field.

The directory remains at most 24 published profiles, sorted by name then slug. Invalid catalogs still fail closed with 503; empty valid directories still return 200 with no items. Existing profile 404 semantics and all public inquiry behavior remain unchanged.

## Acceptance criteria

- [x] Published summary responses include real languages with correct empty/order/bounds behavior and no additional private fields.
- [x] The DTO copies the source array; changes to a returned result cannot mutate catalog content.
- [x] Existing publication, ordering, empty-directory, 503 and profile-detail/404 tests continue to pass.
- [x] Backend OpenAPI/current contract and frontend-local snapshots/generated declarations agree on the additive field.
- [x] Backend checks and cross-repository directory/enquiry regressions pass before marking delivered.

## Validation

Extend `tests/public-agency.test.ts` with exact summary-key and array-copy assertions, empty/maximal language data and unchanged detail behavior. Run `bun run check`; existing inquiry tests must continue passing. Cross-repository browser validation belongs to the frontend plan, including one list read rather than detail fan-out and no fabricated fallback language.

## Risks and rollout

Backward-compatible additive response. The backend can precede the frontend; older frontends ignore the extra field. No database migration or `db:check` is required for this DTO/OpenAPI-only change. The existing backend-owned contract remains authoritative for unchanged inquiries. Roadmap completion counts remain unchanged.
