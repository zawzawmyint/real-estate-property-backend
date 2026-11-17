# 🧭 Lead Duplicate Detection Implementation Plan

> **Goal:** Deliver P2-05 phone-based duplicate warnings with explicit staff acknowledgement across the CRM while preserving permissions, legitimate inquiries and safe retries.

**Delivery status (2026-11-17):** P2-05 is verified. The delivery includes the backend migration/backfill, canonical parser, scoped review/write guards, OpenAPI/type updates and frontend flows. Backend `bun run check` passed lint, formatting, typecheck, 275 tests across 58 files and a production build; frontend `bun run check` passed API drift, lint, formatting, typecheck, 414 tests across 60 files and a production Webpack build with 20 static pages. Disposable migration/database checks, the 10,000-lead/500-row benchmark, current-session runtime inspection, native 200% zoom review and the final clean serial browser run (394 passed expected cases, 74 expected skips, zero unexpected/flaky, exit 0) passed. No deployment or normal-database migration is claimed.

The execution checklist below is the completed delivery record. The delivery status above, the feature specifications and the reconciliation report are the current evidence record.

---

## 🎯 Objective

Prevent accidental repeat-contact handling and inflated lead counts across manual entry, website inquiries and CSV imports. **Status: verified delivery.**

**Specifications:** [local feature spec](../../../specs/lead-duplicate-detection/spec.md). Backend owns the [API contract](../../../specs/lead-duplicate-detection/contract.md); the frontend holds a repository-local documentation snapshot.

---

## 📦 Scope

**In scope**

- UAE/international phone identity, legacy backfill, scoped matching/counts/filter, manual warnings, public inquiry persistence and CSV warning/acknowledgement.
- Both repository plans describe one coordinated delivery; shared plan text is edited in frontend first and synchronized to backend.

**Out of scope**

- Merge/delete, fuzzy/name/email matching, assignment changes, automatic messaging, deployment and a persistent duplicate-resolution workflow.

---

## ⚙️ Assumptions & Constraints

**Technical**

- Keep independent repositories and feature-local layering. Backend owns canonicalization, authorization and acknowledgement; frontend uses Server Actions. No cross-repository source imports.
- **Global constraints:** Node 24.14.1, Bun 1.3.14; retain Webpack, SQLite, existing sessions/version checks and transaction/receipt conventions.
- Exact canonical phone match only; UAE national leading-zero input or explicit +/00 international input. Preserve display text. No unique phone constraint.
- Backend-only `libphonenumber-js` 1.13.16 with full metadata is installed. No browser parser, new service or infrastructure is added.
- Read repository AGENTS.md, SKILL.md and relevant implementation skills before execution. Use isolated checkouts at execution time. Do not start dev services or modify normal databases during document review.

**Product / Business**

- Warn and allow only after explicit acknowledgement. Admin/Manager scope is agency-wide; Agents only see currently owned leads. All stages participate.
- Public visitors receive no duplicate information. New validation does not invalidate unrelated edits to ambiguous historical phone values.
- Feature acceptance and **P2-05 are verified**. No deployment or normal-database migration is included in this delivery.

**Dependencies**

- Existing lead CRUD, public inquiry receipts, lead import v1/v2 transition, shared CSV UI, OpenAPI generation and disposable browser fixtures.
- Review approval of the specs/contract before implementation. No remaining product blocker; exact dependency release and migration timestamp are execution-time choices.

---

## 🧩 Proposed Approach

**Architecture:** Add nullable indexed phoneCanonical to Lead; backfill through the same backend normalizer used for new writes. Match live accessible records, return bounded summaries and a deterministic review token covering the complete scoped membership. Recheck token under the existing serialized write transaction before saving; resolve existing successful receipts before new duplicate enforcement.

**Approaches considered:** Blocking matching phones would reject legitimate repeat opportunities. Automatic merging would risk mixing notes, owners and viewings. **Selected: warn and allow**, as approved in discussion, with permission-scoped review and explicit acknowledgement.

**Backend files**

- Add src/modules/leads/lead-phone.ts for pure canonicalization and src/modules/leads/lead-duplicates.repository.ts for scoped indexed queries. Add lead-duplicates.service.ts for review/token coordination consumed by existing lead and import services. Use parsePhoneNumberFromString(value, { defaultCountry: "AE", extract: false }) from libphonenumber-js/max after contract prefix checks, require isValid(), reject extensions and return the number property.
- Modify backend/prisma/schema.prisma and add a timestamped migration; add src/modules/leads/lead-phone-backfill.ts for bounded idempotent backfill/verification. Integrate after existing backfills in scripts/migrate-database.ts, add verification to scripts/check-database.ts and await verifyLeadPhoneCanonical(database) in src/server.ts before createStaffAuth/createApp/listen. A failure must disconnect the database and exit with a safe operational message; no changed service accepts traffic until verification succeeds. Disposable test-server setup must run the same backfill before creating fixture services.
- Modify src/modules/leads/leads.{routes,controller,service,repository,schema,dto}.ts, lead-import.{controller,service,repository,schema}.ts and relevant shared error serialization only as needed for explicit duplicate-review response envelopes. Keep generic AppError responses unchanged.
- Modify backend/docs/api/leads.openapi.yaml, package.json/bun.lock when adopting the parser, and fixture/database verification scripts where required.

**Frontend files**

- Modify src/features/leads/crm/lead-form.tsx, lead-form-fields.tsx, lead-list.tsx, lead-filters.tsx, lead-detail.tsx, lead-import.tsx and their current list orchestration components where counts/filter propagation requires it.
- Add src/features/leads/crm/lead-duplicate-warning.tsx and data/duplicate-actions.ts for preview reads via guarded Server Actions. Reuse warning presentation in form/detail where it serves both.
- Modify src/features/leads/data/{actions,input,types,filters,queries,request,action-boundary,import-actions,import-types,import-request}.ts as required by contract/error propagation.
- Extend src/components/crm/csv-import.tsx only with the small optional warning-render/confirmation interface needed by lead import. Keep property-import callers compatible. Version handling belongs with current import state/data code.
- Update docs/contracts/leads.openapi.yaml snapshot and src/lib/api/generated/leads types using the existing generator; never hand-edit generated declarations. Update public/agency-inquiry-card.tsx, public/property-inquiry-card.tsx and contact field guidance for the new supplied-phone rules without duplicate UI or disclosure.

**Review focus**

- Hidden Agent matches must not change counts, tokens or save requirements.
- Legacy invalid phone values must not prevent unrelated edits or successful receipt replay.
- Match changes between review and save must fail with zero writes and preserved drafts.
- Pending committed v1 imports must resolve before v2 preview replaces recovery metadata.
- Counts and warning truncation must describe all records, not just visible preview rows.

**API changes**

- Add POST /api/v1/staff/leads/duplicate-check, returning scoped DuplicateReview.
- Extend staff create/patch with duplicateAcknowledgement; definite 409 review conflicts write nothing.
- Add duplicateCount and duplicates=only to staff lead reads; preserve export filter parity and column shapes.
- Lead import preview/commit moves new batches to v2 with bounded warnings and batch acknowledgement; already-committed v1 requests remain replayable. Public inquiry success shapes remain unchanged.
- **Breaking behavior:** new supplied phone validation, enforced acknowledgement for matching staff writes and v2-only new imports require coordinated rollout. Do not change published OpenAPI until implementation.

---

## 🚀 Execution Plan

Each task starts by adding the named regression assertions, observing a meaningful failure, implementing the smallest change, then rerunning that task's checks. Keep backend and frontend implementation on corresponding feature branches; commits are execution-time checkpoints subject to session authorization.

1. **Canonical identity and migration** — _(role: backend)_ — deterministic storage identity and safe historical backfill.
   - [x] Add proposed tests/lead-phone.test.ts and tests/lead-duplicate-migration.test.ts. Assert UAE mobile/fixed-line equivalents, +/00 foreign equivalents, different-number separation, explicit-country requirement, malformed/extension/short-number rejection, null contact and unrecognized historical preservation.
   - [x] Run backend bun run test -- tests/lead-phone.test.ts tests/lead-duplicate-migration.test.ts; observe failures for missing behavior.
   - [x] Implement normalizeLeadPhone(value: string): string | null in lead-phone.ts; null means unrecognizable, with new-write callers responsible for validation errors. Implement nullable indexed schema, runtime backfill and migration workflow. Pin parser dependency and update installed-tool docs only when adopted.
   - [x] Produce normalizeLeadPhone(value: string): string | null plus backfillLeadPhoneCanonical(database): Promise<void> and verifyLeadPhoneCanonical(database): Promise<void>; duplicate review/repository tasks consume the canonical value. Wire canonical persistence into manual/import/public creation and changed-phone patch, without exposing it in existing DTOs. Preserve raw phone/search semantics, historical unrelated edits and compatible receipt replay ordering.
   - [x] Rerun focused tests plus disposable fresh/populated migrate and db:check. Re-running the backfill must be idempotent; an interrupted run must resume safely before write service starts.

2. **Scoped review and guarded manual writes** — _(role: backend)_ — the proposed DuplicateReview API and authoritative acknowledgement enforcement.
   - [x] Add tests/lead-duplicates.test.ts covering Admin/Manager versus Agent visibility; hidden matches must not change tokens/counts/conflicts. Include inaccessible excludeLeadId, null phone, deterministic truncation/token membership and Won/Lost matches.
   - [x] Add assertions for absent/stale/current token, concurrent same-number creates, reassignment between preview/save, canonical-equivalent edit, unrelated edit and invalid supplied phone despite valid email.
   - [x] Interfaces: consume normalizeLeadPhone and existing actor/transaction types; produce DuplicateReview and DuplicateAcknowledgement exactly as defined in the backend contract, plus safe typed duplicate-review conflicts consumed by the controllers and frontend actions. Observe failures with bun run test -- tests/lead-duplicates.test.ts.
   - [x] Implement indexed repository lookups, review-token service, body-based preview route, additive input schemas and explicit safe error envelopes. Authorization/version checks precede disclosure; full review membership precedes cap/truncation.
   - [x] Keep existing manual/public business receipt hashes independent of acknowledgement. Tests must replay pre-feature successful receipts containing legacy phones and replay after new duplicates appear without extra leads/events.
   - [x] Rerun focused HTTP tests and existing lead/receipt tests; document the proposed fields in executable OpenAPI only when behavior passes.

3. **Existing lead review and form integration** — _(role: fullstack)_ — staff can discover and acknowledge duplicates in normal CRM workflows.
   - [x] Add backend tests/lead-duplicate-reads.test.ts for counts/filter-before-pagination, AND combination with list filters, own-lead counts independent of view filters, export parity, count zero for self/null and non-N+1 indexed query behavior.
   - [x] Add frontend tests/unit/lead-duplicates.test.ts for safe schema/action propagation, obsolete preview suppression, phone/review acknowledgement reset, no reset for unrelated edits, clear check-outage retry and definite conflict versus uncertain-save handling.
   - [x] Interfaces: consume DuplicateReview and existing lead DTOs; expose duplicateCount, duplicates=only and optional duplicateAcknowledgement exactly as contracted. Observe each focused test failure in its repository, then implement duplicateCount/filter queries and frontend warning/action/form/detail/list integration. Form previews must not expose private phone text in URL parameters.
   - [x] Synchronize executable OpenAPI snapshot and regenerate declarations using bun run api:generate in frontend; bun run api:check must pass. Validate new error envelopes at the Server Action boundary.
   - [x] Rerun focused tests and browser smoke with two differently assigned Agent leads. Assert hidden-lead invariance, accessible existing links and preserved draft/version/session recovery.

4. **Lead CSV v2 review and replay compatibility** — _(role: fullstack)_ — explicit batch acknowledgement with atomic writes and durable retry recovery.
   - [x] Extend backend tests/lead-import.test.ts and frontend tests/unit/lead-import-actions.test.ts; add tests/unit/lead-import-duplicates.test.ts. Assert duplicate rows beyond the 20-row preview and 100-warning examples, overlapping database/file counts, empty phones, invalid rows, stale matches and changed digest/actor.
   - [x] Add committed-v1 replay, uncommitted-v1 stale-preview, v2 response-loss replay, mismatched receipt, changed phone metadata and pending-v1 reload tests. On v1 reload/reselection, verify the historical v1 file digest locally and explicitly retry the original v1 commit before v2 preview. Assert replay completes without reimport; a lost response preserves the old identity; stale/conflict or missing matching file requires explicit duplicate-risk acknowledgement before a new v2 preview/identity. Test an old committed phone rejected by the new normalizer. Never create a fresh submission implicitly.
   - [x] Interfaces: consume existing import request/result/receipt types; produce schemaVersion=2 ImportDuplicateReview/ImportDuplicateWarning and optional duplicateAcknowledgement exactly as contracted, preserving success shapes and v1 replay. Observe failures; implement backend v2 digest/warnings/recheck and frontend import-specific warning acknowledgement through the minimal optional shared CSV extension. Keep the six-column template, bounds, atomicity and property-import contract intact.
   - [x] Commit under write reservation with no inserts before valid current review. Missing/stale acknowledgement writes zero records. Successful matching batches create every valid row; no skip/merge/upsert.
   - [x] Rerun lead and property import unit/HTTP/browser regressions, then snapshot/generation parity. Record 500-row performance against 10,000 seeded leads; target preview <=5s and commit <=15s.

5. **Cross-repository acceptance and accessibility** — _(role: fullstack)_ — independently reviewable evidence for the complete behavior.
   - [x] Add frontend tests/e2e/lead-duplicates.spec.ts with isolated fixtures: manual create acknowledgement, changed-phone edit, public inquiry repeats, legacy hint, all-stage list/detail review, hidden Agent matches, within-file/database CSV matches, stale confirmation and safe retry/reload.
   - [x] Run bun run check in both repositories; run backend db:check on disposable fresh/upgraded databases. Run frontend bun run test:e2e with the real disposable backend; retain existing import/export and public/CRM regression assertions.
   - [x] Inspect 320/390/768/1440px and native 200% browser zoom, keyboard focus, labelled checkbox, polite status and truncation guidance. Capture and review the warning states.
   - [x] Follow repository Next DevTools instructions, confirm correct checkout identity and active affected browser page, then inspect runtime errors/page metadata. Stop only owned servers when builds require it.
   - [x] Review permission/membership race/receipt compatibility and measured query performance before claiming acceptance. Record any limitations and leave affected acceptance unchecked.

6. **Documentation reconciliation and rollout handoff** — _(role: fullstack)_ — synchronized, evidence-based delivery record.
   - [x] Reconcile both feature specs, backend-owned contract/frontend snapshot, root spec/index, lead-management/import contract addenda, OpenAPI, development/migration instructions and both shared ROADMAP/TECH_STACK copies.
   - [x] Delegate final documentation reconciliation to spec-updater with exclusive document ownership after code/tests settle; wait for and inspect its diff/unresolved gaps.
   - [x] Run formatting/link checks and review both Git diffs. Check P2-05 only if every feature acceptance item has passing evidence; deployment remains a separate unverified milestone.
   - [x] Provide coordinated migration/backfill/client rollout and rollback instructions without executing deployment or modifying normal databases.

---

## ✅ Acceptance Criteria

**Functional**

- [x] Exact UAE/international canonical matching works across new and recognizable historical records.
- [x] Scoped staff warning/acknowledgement, all-stage list/detail review and CSV batch warnings work without hidden-record disclosure.
- [x] Public inquiries remain accepted; repeat submissions and committed v1/v2 imports remain idempotent.
- [x] No merging, silent skipping, automatic reassignment or unique-phone constraint.

**Non-functional** (performance, security, accessibility, reliability)

- [x] Live resource permissions, transactional review checks and current versions prevent unauthorized/stale saves.
- [x] Responses are bounded; indexed 500-row import performance meets the recorded local targets.
- [x] Keyboard/mobile/zoom and loading/error/uncertain-recovery behavior pass.
- [x] Both repository checks, database checks, integration regressions and documentation parity pass.

---

## 🧪 Validation Plan

**Manual tests**

- Review warnings for shared-family/repeat-customer scenarios, actual permission boundaries and ambiguous legacy correction guidance.
- Inspect responsive/zoom/focus states and active-page runtime diagnostics using disposable data.

**Automated tests**

- Task-specific normalization/migration/HTTP/action/browser tests, concurrent writes and pre-feature receipt replays.
- Both bun run check; disposable backend bun run db:check; frontend bun run api:check and bun run test:e2e.
- Verify documentation links, contract snapshot parity, unchanged property import behavior and no checked acceptance without evidence.
- The patched targeted browser suite passed 21 cases with one intentional skip; the follow-up focused run passed 60/64 registered cases with four expected mobile skips. Test-only fixture isolation supplies separate disposable `csv-export`, `lead-import` and `property-import` Admin/Manager/Agent identities with cached, live-session-checked helpers; the real login limiter remains enabled and no normal database is used. The final clean serial run passed 394 expected cases with 74 expected skips and zero unexpected/flaky results.
- Before that clean rerun, align two stale test paths only: have `taskLead` use `createReviewedLead` for repeated-phone acknowledgement, and make the public-component-reuse missing-contact expectation use the established `Enter...` copy. Preserve described-by/anchor/no-write assertions; do not alter product copy, auth, rate limits or runtime behavior.
- The long serial diagnostic found normal frontend Next route eviction followed by a cold `/login` compile. Proposed frontend-only `E2E_TEST_RUN` configuration retains the bounded route set with a one-hour inactive age and 64-page buffer, alongside the existing hidden test-only dev indicator; it does not configure backend behavior or change normal development/production settings and timing assertions.
- The retention run cleared the prior navigation issue but exposed a mobile lazy-image setup failure. Before the clean rerun, frontend tests will narrow missing-photo injection to backend `/media/` images (not `/_next/static/media/`) and scroll existing image wrappers before unchanged detail/edit/inventory fallback assertions. This is test setup only; backend behavior, product image code, assertions and timeouts stay unchanged.

**Rollback / mitigation**

- Back up before migration; add nullable non-unique storage first. Keep backfill idempotent and block changed services until it completes.
- Coordinate both deployments. Revert application code while retaining the additive column/index if needed; assess writes before any database restore.
- Preserve old committed receipt replay support and do not restart uncertain operations with new submission IDs.

---

## ⚠️ Risks & Open Questions

**Risks**

- **Risk:** Shared numbers are legitimate — _Mitigation:_ warn/acknowledge, never merge/block permanently.
- **Risk:** Agent warnings reveal another owner's leads — _Mitigation:_ apply identical live scope to summaries, counts, tokens and write guards.
- **Risk:** Data changes after preview — _Mitigation:_ full membership token recheck in serialized transaction.
- **Risk:** Stronger validation or v2 breaks historical recovery — _Mitigation:_ legacy-edit exemption, receipt-first replay and dedicated v1/v2 regression tests.
- **Risk:** Parser metadata/backfill differs by release — _Mitigation:_ pin exact dependency, test corpus, runtime-normalizer backfill and deliberate future upgrades.

**Open questions** _(post-delivery operations)_

- No feature-acceptance blocker remains. Deployment and a normal-database migration remain separate operator-authorized work; the native 200% warning/acknowledgement/save region passed in-viewport/no-overflow review.
