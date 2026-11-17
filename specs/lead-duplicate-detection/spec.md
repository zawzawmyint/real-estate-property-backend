# Lead duplicate detection

Status: Verified delivery — 2026-11-17. P2-05 is complete; deployment and normal-database migration remain separate operational work.

## Goal

Help staff recognize repeat contacts by phone while allowing a deliberately separate lead.

## Scope and exclusions

- Include manual creation, changed-phone edits, public inquiry persistence, existing leads, CSV preview/commit, scoped list indicators/filter and a lead-detail review panel.
- All stages, including Won/Lost, participate. Missing phones never match. Match exact canonical phone only.
- Exclude merge/delete, unique-phone constraints, assignment changes, email/name/fuzzy matching, public duplicate disclosure, durable duplicate-review workflow and automatic messaging.

## Behavior and contracts

The [backend-owned contract](contract.md) is authoritative. Express owns normalization, live permissions, matching and acknowledgement enforcement. Follow existing routes -> controller -> service -> repository -> Prisma ownership.

Normalize UAE national numbers with a leading trunk zero using AE metadata; accept explicit international + or 00 prefixes for any supported calling code. Require an explicit prefix for non-UAE input. Formatting spaces/brackets/hyphens do not change identity. Examples: 0501234567, +971501234567 and 00971501234567 map to +971501234567. Do not guess bare 971 numbers or match suffixes. Preserve existing trimmed display text.

Backend-only dependency: `libphonenumber-js` 1.13.16 using its `max` metadata entry point. Strict whole-input parsing and `isValid()` establish plausibility, not ownership/reachability. Restrict national-format acceptance to UAE leading-zero mobile/fixed-line numbers; reject extensions, short codes, alphabetic text and unsupported/implausible numbers. Retain the current 40-character input bound. Empty phone with valid email remains allowed.

Add nullable Lead.phoneCanonical with a non-unique index. Backfill using the same normalizer; unrecognizable historical numbers remain displayed and canonical=null. New creates/imports/public inquiries and changed nonempty phones must normalize; unrelated edits and formatting-identical legacy phones remain editable without migration coercion. Preserve searchPhone's existing search semantics. No external phone lookup or provider.

Admin/Manager matching is agency-wide. Agent matching includes only currently assigned own leads, independent of list filters. No hidden-match count, token changes or warning may reveal other leads. Exclude the current lead only after authorizing access. Public submissions neither receive duplicate metadata nor require acknowledgement.

Staff forms use a bounded match preview. Missing/stale acknowledgement on a matching create/changed-canonical-phone write returns a definite no-write conflict with fresh scoped review data. Recheck in the existing serialized write transaction; retain current version/resource checks. Matching must not change assignment, suppress inquiries or silently combine activities. Detail/list matching is computed live from indexed canonical values and current access rather than stored flags.

CSV imports retain validation errors, 500-row limits, atomic creation, history and aggregate receipts. Show both CRM matches and same-file duplicates independently of the first 20 preview rows. Acknowledge all warnings once per unchanged batch/review; recheck under write reservation. Version the changed lead import contract to 2; preserve compatible already-committed version-1 receipt replay as specified in the contract.

## Acceptance criteria

- [x] UAE equivalents and formatted international numbers match; different numbers, nulls, bare foreign national input, short/ambiguous numbers and suffix-only similarities do not.
- [x] Fresh and populated migrations backfill deterministically without changing phone display, lead IDs, assignment, history or existing search behavior.
- [x] New invalid supplied phones fail even with valid email; unchanged legacy phones and email-only leads remain usable.
- [x] Admin/Manager and Agent scoping, self-exclusion authorization and access-loss behavior prevent hidden-record disclosure.
- [x] Manual create/changed-phone edit requires acknowledgement only for visible matches; acknowledgement cannot bypass permissions, validation or optimistic versions.
- [x] Concurrent new matches invalidate review before save; concurrent acknowledged writes remain serialized, without a unique constraint.
- [x] Public inquiries persist normally, including repeated numbers; responses reveal no matching status and existing retry receipts remain safe.
- [x] Existing/current leads have accurate scoped duplicate counts/filter/detail results across all stages and pages.
- [x] CSV detects database and within-file matches across all 500 rows; warning counts are accurate despite bounded examples; errors still block the entire batch.
- [x] Changed CSV/review resets acknowledgement; stale commit writes nothing; acknowledged commit creates every valid row atomically.
- [x] Manual/import successful-response loss replays once without re-triggering duplicate acknowledgement; version-1 committed imports can still replay.
- [x] Backend checks, disposable database checks, cross-repository browser tests, runtime inspection and contract parity pass before P2-05 is checked.

## Validation

Add focused backend unit/HTTP tests for canonicalization, migration/backfill, permission invariance, filter/count pagination, review-token invalidation, write races and receipt replay. Exercise fresh/populated disposable databases; do not migrate the user's normal database without a backup and operational authorization.

Run bun run check and disposable bun run db:check, then the frontend integration suite with the real backend. Measure a maximum 500-row preview/commit against 10,000 seeded disposable leads: preview <=5 seconds and commit <=15 seconds on the recorded local environment; inspect indexed queries and bound response examples. Report the fixture/environment and any exceeded target rather than weakening assertions.

### Test-fixture isolation and final browser evidence

The patched 16.4.6 targeted duplicate suite passed 21 cases with one intentional skip, and current-session MCP runtime inspection reported `configErrors=[]` and `sessionErrors=[]`. The test-only fixture isolation provisions separate disposable Admin, Manager and Agent identities for the `csv-export`, `lead-import` and `property-import` namespaces and desktop/mobile coverage; each affected file reuses a cached signed-session helper that performs a live `get-session` role/ID check. The real five-sign-ins-per-email-per-15-minutes safeguard remains enabled and no normal database changes. A focused browser run passed 60 of 64 registered cases with four expected mobile skips. The final clean serial run passed all 394 expected cases of 468 registered, with 74 expected skips, zero unexpected/flaky results and exit 0. Root reviewed final native 200% evidence: the complete warning/acknowledgement/save region is readable in the viewport, `innerWidth`/`scrollWidth` are both 640, and the warning rectangle (x32, y113, 576×226) stays inside the 452px viewport.

The current diagnostic serial run found two test-compatibility corrections before that rerun: `task-helpers.ts` must create its repeated-phone setup through the existing `createReviewedLead` path so `taskLead` explicitly acknowledges the real duplicate guard, and the stale public-component-reuse missing-contact expectation must match the established `Enter...` validation message. These are test-only changes: task suites already use isolated namespace/project accounts and session caching; no production authentication, rate-limit, validation copy or product behavior changes. Existing described-by, anchor and no-write assertions remain.

The diagnostic log identified a cold frontend `/login` recompilation after normal Next on-demand route eviction during an earlier serial attempt. The final frontend-only `E2E_TEST_RUN` configuration keeps the bounded regression route set warm with a one-hour inactive age and 64-page buffer, alongside the existing hidden test-only dev indicator. It does not configure the backend, alter default frontend development/production behavior, relax timings or change application behavior.

The route-retention run cleared the earlier navigation issue but exposed one mobile lazy-image test setup failure. The final frontend test setup narrows missing-photo injection to backend `/media/` image requests so it cannot abort Next font assets under `/_next/static/media/`, and scrolls existing property-image wrappers into view before unchanged fallback checks on detail, edit and inventory surfaces. This enables native lazy loading only; it does not alter backend behavior, product image code, fallback assertions or timeouts.

## Risks and rollout

This is a deliberate validation and write-contract change: older clients cannot silently create visible duplicates and version-1 new imports must re-preview. Deploy frontend/backend together or disable lead writes during the transition. Add migration/backfill before serving changed code; backup first. Reverting code may retain the nullable column/index; restore a backup only if necessary and account for newer writes. Exclude legacy ambiguous phones from claims of exhaustive detection.

The application, additive migration, executable OpenAPI and dependency changes are implemented. Backend full checks (275 tests/58 files), disposable fresh/populated/idempotent migration and database checks passed. The recorded 10,000-existing-lead plus 500-row import benchmark completed preview in 1066.9 ms and commit in 1620.6 ms. Root engineering remediated the affected frontend `next`/`eslint-config-next` 16.4.2 dependency to exact 16.4.6 and retained React 19.3.1; the official post-upgrade assessment is unaffected. After the final test-only updates, frontend `bun run check` passed API drift, lint, formatting, typecheck, 414 tests across 60 files and a production Webpack build with 20 static pages; backend `bun run check` passed lint, formatting, typecheck, 275 tests across 58 files and a production build. The final clean serial browser result, runtime, responsive and native-zoom evidence is recorded above. P2-05 is verified; no deployment or normal-database migration has been performed.
