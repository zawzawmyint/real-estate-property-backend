# Generated demo property data

Status: Verified on 2026-10-22.

## Goal

Populate a local/demo installation with 15 clearly fictional residential listings and generated property photography, allowing the delivered public search and CRM to be reviewed with useful inventory.

## Scope and exclusions

- In scope: 15 residential sale/rent records, generated source photos, deterministic demo identifiers, an explicit opt-in seed command and visible demo labels. Covers P1-19 only after all 15 records and image integration are verified.
- Out of scope: real listings, staff/demo credentials, deleting existing data, production auto-seeding, stock-image downloads, private documents or truthful claims about an actual property/address.

## Behavior and contracts

- Backend owns `scripts/seed-properties.ts` and source fixtures under `fixtures/demo-properties/`. `bun run demo:seed -- --confirm-demo` explicitly opts in; refuse without the flag and refuse NODE_ENV=production. Migrations must already have run. No server startup hook.
- Create exactly 15 deterministic `demoKey` records only when missing. Never overwrite edited demo or real records; a second run creates zero records. Store `isDemo=true` internally and add a nullable unique demoKey plus boolean default false to Property. Neither field is writable through property API inputs. Expose only `isDemo:boolean` in public/staff property DTOs, never demoKey.
- Use mixed Buy/Rent, apartment/villa/townhouse/penthouse, Studio through five beds, varied prices/communities and several featured records. All owner contacts are fictional; use `.invalid`/obviously synthetic contact context where applicable. No seeding of staff accounts.
- Generated photos are illustrative, not depictions of actual listed homes. Preserve the generation prompt/filename provenance manifest. Ship source assets as fixtures, separate from runtime uploads; decode/normalise through the same image pipeline and copy to Storage with generated keys.
- Each listing has a cover and sufficient gallery images for reviewing the feature. Reuse a small labelled illustrative image library where reasonable; record the mapping honestly. Do not describe reused images as 15 unique photography sessions.
- Insert each property plus ordered photos atomically after saving its images. If attachment fails, clean newly saved unreferenced media. A rerun resumes missing records without modifying successful ones. No deletion/reset mode.
- Print created/skipped totals without owner details or credentials. Fail clearly if source assets, migrated schema or storage are unavailable; no fake successful seeding.

## Acceptance criteria

- [x] Opt-in and production guards fail before writes.
- [x] An empty migrated demo database gets 15 complete published available isDemo records with real decodable photo URLs and varied filters.
- [x] Rerun creates zero records, preserves changed demo fields and preserves unrelated real records.
- [x] Public cards/detail and CRM visibly identify sample listings; owner information remains private and demoKey never appears in API responses.
- [x] Source prompts/assets, operator command and generated/runtime asset separation are documented.

## Validation

Five real temporary SQLite/storage seed tests cover guards, insertion count, idempotence, non-overwrite, missing-image failure and uncertain attachment outcomes. Backend `bun run check` passed with 56 tests in 13 files; frontend unit/API/build checks passed, and the final browser run passed 40 desktop/mobile checks.

## Risks and rollout

Opt-in local/demo only. Generated images can contain fictional architectural details; label all demo records and photos. Do not execute against a real production database or commit runtime uploads/databases. Source fixture assets are intentional versioned demo inputs. No rollback command deletes data; restore the matching database/media snapshot when needed.
