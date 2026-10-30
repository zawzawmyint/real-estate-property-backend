# 🧭 Real Estate Agency Master Roadmap

> **Goal:** Deliver the public property website and internal CRM feature by feature, then add selected enhancements and the optional client portal.

---

## 🎯 Objective

Track every Phase 1, 2 and 3 feature from the original **Real Estate CRM Checklist**, without treating project setup as completed business functionality.

**Current baseline:** Foundation is complete; 28 verified Phase 1 checklist items are complete and 14 Phase 1–3 checklist items remain pending. The original five portfolio delivery items are retained separately. This roadmap is the workspace-wide source of truth for feature progress; repository-local specifications define implementation and acceptance.

---

## 📦 Scope

**In scope**

- **Phase 1:** All core public website and staff CRM features: 30 checklist items.
- **Phase 2:** Seven enhancement items; select two or three initially, with the remainder retained in the backlog.
- **Phase 3:** Five optional stretch items, including the client portal, after earlier releases are live.
- **Delivery:** Five original portfolio/demo items, tracked separately from product features.

**Out of scope**

- Implementing features simply by recording them here.
- Treating earlier discussion suggestions as approved changes to the original checklist.
- A committed timeline, estimates, hosting selection or unverified completion claims.

---

## ⚙️ Assumptions & Constraints

**Technical**

- Installed tools, planned tools and adoption rules are recorded in the [tech stack document](TECH_STACK.md). Deferred packages remain uninstalled until their features need them.
- Separate `frontend/` and `backend/` Git repositories inside this workspace. Express owns business rules, permissions, persistence and file storage; Next.js consumes its API.
- SQLite and backend local-disk image storage initially. PostgreSQL and S3 remain future migration options requiring explicit data transfer.
- Public discovery, CRM property inventory/lifecycle and listing-photo workflows are implemented with backend-enforced resource authorization. CRM authentication and Admin/Manager/Agent roles, public inquiries, lead ownership, lead follow-up, viewing management, verified follow-up tasks, the P1-10 pipeline and the agency dashboard are implemented; broader reporting remains future work.
- Demo property images are generated illustrative fixtures. The source checklist's free-photo wording is preserved below; this records the agreed change in image sourcing.

**Product / Business**

- Deliver the public website and internal CRM first; add the client portal later.
- Complete and verify one useful slice before moving to the next. Full Phase 1 remains the release target; smaller slices are milestones within it.
- **Design direction:** Maroon (`#701F35`), warm ivory (`#FAF8F5`) and charcoal (`#252329`) are implemented in the public property screens. Property Finder informs clear search, photography and property information while Avenor remains distinct. The selected [homepage mockup](docs/design/homepage-maroon-ivory-charcoal.png) is a visual reference; its branding, imagery and listings are illustrative.
- Preserve Phase 2 and Phase 3 assignments. Suggestions such as moving assignment notifications earlier require a recorded scope decision before changing phase membership.
- The original delivery checklist assumes a portfolio/demo. Its demo accounts, sample-data labeling and case study apply to demo delivery, not automatically to a real client's production system.

**Dependencies**

- Staff authorization must precede access to real private CRM data.
- Property publishing enables public discovery; inquiry capture enables lead follow-up; leads and properties enable viewings.
- Pipeline, source and outcome data are required before trustworthy dashboard and performance reporting.
- Portal access, document permissions, commissions and localization need their own specifications before implementation.

---

## 🧩 Proposed Approach

Shared-document policy: edit shared content in the frontend repository first and synchronize the backend copy in the same delivery. Links in each copy resolve within that repository. Companion-repository source paths are shown as text because GitHub remotes are not configured. Repository-local feature specs and API contracts remain authoritative for their respective projects.

**Completed foundation**

- [x] Independent frontend/backend repositories, tooling, CI and setup documentation.
- [x] Public/CRM shells, shared UI foundations and verified API connectivity.
- [x] Prisma/SQLite connection, local storage adapter and technical boundary tests.
- [x] Repository-local SDD templates and specification conventions.

Foundation evidence: [workspace specification](docs/shared/foundation-spec.md), [frontend specification](specs/project-foundation/spec.md), backend specification (companion repository: `backend/specs/project-foundation/spec.md`).

**Feature specifications**

- Before implementation, create `specs/<feature-name>/spec.md` in each affected repository, using the [frontend template](specs/_template/spec.md) or backend template (companion repository: `backend/specs/_template/spec.md`).
- The spec slugs below are proposed names, not existing specs or a requirement to implement an entire group at once. A group may be split into smaller named slices while preserving its checklist IDs.
- Define permissions, fields, API requests/responses, UI states and observable acceptance criteria. Update the backend-owned API contract (companion repository: `backend/docs/api/openapi.yaml`) when introducing endpoints.
- Public responses must exclude private owner details and staff-only lead data. Keep that requirement explicit in the relevant feature specs.

**Tracking rules**

- Stable IDs identify original checklist items. Every unchecked item starts **Not started**.
- Use **Specifying**, **In progress**, **Blocked** or **Verified** when recording an active item's status below; include the ID and relevant spec links.
- Check an item only after its frontend/backend behavior, permissions and acceptance checks are verified. A partly completed multi-part item stays unchecked.
- When an item is verified, add dated evidence and spec links to the delivery record. Keep this roadmap and the affected specs synchronized in the same delivery.
- Keep the frontend roadmap as the editing source and synchronize the backend copy in the same delivery. Preserve matching checklist IDs and status in both repositories. Each repository's specs remain independently usable if it moves elsewhere.

**Delivered slices:** [staff authentication and roles](specs/staff-authentication-and-roles/spec.md) verifies P1-01 and staff identities for P1-02. [Inquiry capture and lead management](specs/lead-management/spec.md) verifies P1-03–P1-09, P1-16 and P1-20–P1-22.

**Verified maintenance (2026-10-23):** [header/sidebar polish](specs/header-sidebar-polish/spec.md) and [typography](specs/typography/spec.md) improve the delivered public/CRM experience without completing an additional roadmap item. P1-18 remains unchecked because its wider public mobile-layout scope is still incomplete.

**Verified (2026-10-26):** [inquiry capture and lead management](specs/lead-management/spec.md) delivers P1-03–P1-09, P1-16 and P1-20–P1-22: manager-distributed inbox, manual and website leads, ownership, stage changes, notes/calls and timeline. P1-10 Kanban was subsequently verified on 2026-10-27; viewings/tasks, notifications and wider P1-18 mobile acceptance remain separate.

---

## 🚀 Execution Plan

**Suggested delivery sequence** — proposed milestones, not additional requirements:

1. **Staff access** — _(role: fullstack)_ — login, logout and server-enforced staff permissions.
2. **Publish a property** — _(role: fullstack)_ — property management, image handling and public listing/detail display; decide draft/publish behavior in its spec.
3. **Capture and follow up on interest** — _(role: fullstack)_ — inquiry creates a CRM lead, staff assign it, agent records notes and changes its stage. This completes the first business flow.
4. **Arrange viewings and follow-ups** — _(role: fullstack)_ — scheduling, calendar, feedback and dated tasks.
5. **Complete Phase 1** — _(role: fullstack)_ — remaining public pages/search/demo data, activity, drag-and-drop and validated dashboard metrics; deploy the complete core release.
6. **Select Phase 2 enhancements** — _(role: fullstack)_ — specify and deliver two or three chosen features, then reassess the remaining backlog.
7. **Evaluate Phase 3** — _(role: fullstack)_ — specify optional features only after earlier releases are live; client portal remains later work.

### Phase 1 — Core features (MVP)

**Release rule:** Finish and deploy all of Phase 1 first. The following 30 items preserve the source checklist's scope.

#### Authentication and roles

**Verified specification:** [staff authentication and roles](specs/staff-authentication-and-roles/spec.md). Better Auth 1.7.12 React client in Next.js, native Better Auth server in Express, SQLite only. It does not grant any business-resource permissions.

- [x] **P1-01** Staff login and logout
- [x] **P1-02** Three roles: Admin, Manager, Agent
- [x] **P1-03** Agents only see their own leads

#### Lead management

**Verified specification:** [lead management](specs/lead-management/spec.md).

- [x] **P1-04** Create leads manually (call, walk-in)
- [x] **P1-05** Create leads automatically from the website inquiry form
- [x] **P1-06** Fields: name, phone, email, budget, buy or rent, property, source, status, agent
- [x] **P1-07** List with search, filters (status, source, agent) and sorting
- [x] **P1-08** Assign and reassign leads to agents

#### Sales pipeline

**Verified (2026-10-27):** [sales pipeline Kanban](specs/sales-pipeline/spec.md) completes P1-10 using existing lead reads, versioned stage changes and permissions. The responsive board includes accessible pointer/keyboard movement, confirmation, pagination and recovery.

- [x] **P1-09** Stages: New, Contacted, Viewing Scheduled, Offer, Won, Lost
- [x] **P1-10** Kanban board with drag-and-drop between stages

#### Property management

**Status: Verified** — [property management and public discovery](specs/property-management/spec.md) and [demo property presentation](specs/demo-property-data/spec.md). Backend checks passed with 56 tests in 13 files, frontend checks passed with 51 unit tests plus production build/API drift validation, and 40 desktop/mobile browser checks passed.

- [x] **P1-11** Add, edit, delete and archive properties
- [x] **P1-12** Fields: title, type, price, location, beds, baths, area, photos, status, owner name and phone
- [x] **P1-13** Properties show on the public site automatically

#### Public website

**Verified presentation delivery (2026-10-30):** [Cinematic maroon homepage redesign](specs/public-homepage-redesign/spec.md) and its [implementation plan](docs/superpowers/plans/2026-10-30-public-homepage-redesign.md) deliver the selected latest refinement option 3 as frontend presentation only, with no backend contract change. Constituent frontend API drift, lint, formatting and type checks, 271 unit tests and an isolated production build passed; runtime inspection on the normal preview was clean and [visual QA](specs/public-homepage-redesign/design-qa.md) passed. The final selected browser suite passed 102 cases with 20 intentional skips and no failures. It used scratch-preview origin adaptation, so it is not a normal-port-3100 integration claim. This supersedes the earlier homepage composition while preserving pending public-completion acceptance. P1-14/P1-18 remain unchecked and Phase 1 stays 28/30 verified.

**Current specs:** [property management and public discovery](specs/property-management/spec.md), [demo property presentation](specs/demo-property-data/spec.md), and [public contact and agent pages](specs/public-contact-and-agents/spec.md).

**In progress (2026-10-30): P1-14 and P1-18** — homepage completion, long-content wrapping and reduced-motion code changes are under verification; final public mobile and release acceptance checks remain pending. Frontend-owned [specification](specs/phase-one-public-completion/spec.md) and [implementation plan](docs/superpowers/plans/2026-10-30-phase-one-public-completion.md). No backend behavior changes were introduced. Focused public coverage passed 11 cases with 9 intentional skips and no failures; the normal serial legacy run was interrupted early and the dedicated dashboard fixture was not run. Both checklist items remain unchecked and Phase 1 remains 28/30 verified; deployment is separate.

**Verified demo delivery (2026-10-27):** P1-17 provides Contact, Our agents and individual profiles, plus a property-independent enquiry form that creates an unassigned Website/New CRM lead. The public content catalog and APIs use fictional demo content with no published direct contact details. P1-18 remains unchecked; real-business publication still requires approved contact/profile/portrait content and inquiry usage wording.

The verified property and lead deliveries cover filtered listings P1-15, search/featured portions of P1-14, the complete P1-16 detail/gallery/inquiry flow, and responsive property screens within P1-18. P1-14 and P1-18 remain unchecked because their wider scope is incomplete. P1-19 is complete with generated illustrative fixture images, not the source checklist's free photos.

- [ ] **P1-14** Home page with search bar and featured listings
- [x] **P1-15** Listings page with filters
- [x] **P1-16** Property detail page with gallery and inquiry form
- [x] **P1-17** Contact and agent pages
- [ ] **P1-18** Mobile-friendly layout
- [x] **P1-19** Sample data: 15 to 30 demo properties with free photos

P1-18 covers the delivered public feature screens, not just the responsive foundation shell. For P1-19, use generated dummy images as agreed, and label sample records appropriately.

#### Client profile and activity

**Verified specification:** [lead management](specs/lead-management/spec.md).

- [x] **P1-20** One page per lead with all details
- [x] **P1-21** Notes and call logs
- [x] **P1-22** Activity timeline

This is an internal staff view of a lead, not the Phase 3 client portal. Its activity timeline is also distinct from the Phase 3 audit log of who changed records.

#### Viewings

**Verified (2026-10-29):** [viewing management](specs/viewing-management/spec.md) completes P1-23–P1-25 with the [delivery plan](docs/superpowers/plans/2026-10-28-viewing-management.md). Two final-source browser runs passed with no failures: 34/34 viewing cases and 165 existing cases with 9 conditional project/viewport skips.

- [x] **P1-23** Schedule a viewing for a lead and a property
- [x] **P1-24** Calendar view
- [x] **P1-25** Feedback notes after the viewing

#### Tasks and reminders

**Verified (2026-10-29):** The [follow-up tasks specification](specs/follow-up-tasks/spec.md) and [implementation plan](docs/superpowers/plans/2026-10-29-follow-up-tasks.md) record lead-linked dated tasks, assignment-derived responsibility and overdue highlighting. Backend/frontend quality gates passed; every task case has passing evidence across the documented worker/serial reruns, and the unchanged serial legacy regression passed 199 cases with 9 conditional viewport/project skips and no failures.

- [x] **P1-26** Create follow-up tasks with date and time
- [x] **P1-27** Highlight overdue tasks

The source requires dated tasks and overdue highlighting here; scheduled email or WhatsApp reminders are not silently added.

#### Dashboard

**Verified (2026-10-29)** — [agency dashboard](specs/agency-dashboard/spec.md) and its backend-owned contract complete P1-28–P1-30. Backend/frontend full checks passed; the final dedicated dashboard suite passed 16/16 with refreshed desktop/mobile captures and visual QA. The revised pipeline session test passed six focused repeats. Legacy evidence is the union of two non-clean parallel runs but includes a pass for every active case; the feature spec records that limitation. Phase 1 is now 28/30 complete; P1-14 and P1-18 remain unchecked.

- [x] **P1-28** New leads this week, deals won, conversion rate
- [x] **P1-29** Chart: leads by source
- [x] **P1-30** Chart: pipeline by stage

### Phase 2 — Features that make it stand out

**Selection rule:** Pick two or three initially. The original checklist recommends auto-reply, property matching and CSV export as the best value; these are recommendations, not a confirmed selection. Retain all seven items for later prioritization.

#### Automation and matching

**Proposed spec slugs:** `lead-auto-reply`, `lead-assignment-notifications`, `property-matching`.

- [ ] **P2-01** Auto-reply to new leads by email or WhatsApp link
- [ ] **P2-02** Notify the agent when a lead is assigned
- [ ] **P2-03** Suggest properties that fit a lead's budget and preferences

#### Data tools

**Proposed spec slugs:** `csv-import-export`, `lead-duplicate-detection`, `lead-temperature-tags`.

- [ ] **P2-04** CSV import and export for leads and properties
- [ ] **P2-05** Duplicate detection by phone number
- [ ] **P2-06** Hot, warm and cold lead tags

If CSV export is delivered first, P2-04 stays unchecked until both import and export are verified for leads and properties.

#### Reporting

**Proposed spec slug:** `agent-performance-reporting`.

- [ ] **P2-07** Agent performance report: leads handled, deals closed, response time

### Phase 3 — Optional stretch features

**Release rule:** Consider these only after Phases 1 and the selected Phase 2 features are live. No stretch feature is currently selected for implementation.

#### Extras

**Proposed spec slugs, in checklist order:** `client-portal`, `private-document-uploads`, `deal-commissions`, `record-audit-log`, `arabic-english-localization`.

- [ ] **P3-01** Client portal: saved properties and viewing status
- [ ] **P3-02** Document uploads (contracts, IDs)
- [ ] **P3-03** Commission tracking per deal
- [ ] **P3-04** Activity log of who changed what
- [ ] **P3-05** Arabic and English support

Client access must be scoped to the client's own information. Contracts and IDs need private, authorized delivery rather than the existing public-image storage route. Arabic support requires translated content and right-to-left UI acceptance checks.

### Original delivery checklist — Portfolio delivery

These five source items remain separate so they do not disappear from tracking or imply that a real production client needs demo credentials.

**Proposed spec slug:** `release-and-demo-delivery`.

- [ ] **D-01** Deploy the public site and the CRM live
- [ ] **D-02** Add a demo login for each role
- [ ] **D-03** Label it clearly as a demo with sample data
- [ ] **D-04** Take screenshots of the main screens
- [ ] **D-05** Write a short case study: problem, what you built, result

Foundation smoke-test screenshots do not complete D-04: capture the delivered business screens for the release. Deployment of the Phase 1 release does not depend on finishing optional Phase 3 work.

---

## ✅ Acceptance Criteria

**Functional**

- [ ] **Phase 1 release:** P1-01 through P1-30 are verified and the public website and CRM are deployed.
- [ ] **Phase 2 initial release:** Two or three selected enhancements are specified, verified and live; unselected items remain tracked.
- [ ] **Phase 3 delivery:** Each separately selected stretch feature has verified acceptance before being marked complete; optional unselected work remains unchecked.
- [ ] **Demo delivery, if applicable:** D-01 through D-05 are verified for the portfolio/demo release.

**Non-functional** (performance, security, accessibility, reliability)

- [ ] Each delivered slice enforces its server-side permissions and avoids leaking private data.
- [ ] Delivered screens have verified responsive, keyboard, loading, empty and error states.
- [ ] Feature specs define proportionate performance and reliability expectations, with passing checks and evidence.
- [ ] API contracts, migrations, configuration and documentation agree with the delivered behavior.

---

## 🧪 Validation Plan

**Manual tests**

- Verify each feature's user flow across public website and CRM as applicable, including role boundaries and failure states.
- For the first complete business flow, publish a property, submit an inquiry, assign the resulting lead and record agent follow-up.
- Review mobile layouts and feature-specific privacy before checking items off.

**Automated tests**

- Add meaningful backend boundary/business tests and frontend/browser tests with the feature, based on its spec.
- Run affected repository lint, formatting, type checks, tests and builds; run cross-repository smoke tests for integration changes.
- Check roadmap coverage against the original HTML checklist whenever reorganizing it. Preserve stable IDs and every source item.

**Rollback / mitigation**

- Keep feature deliveries independently reviewable and record migration and rollback procedures in their specs.
- Do not mark a partially delivered item verified. Reopen its checkbox if a regression invalidates acceptance and record the affected evidence.

**Delivery record**

- **2026-10-21 — Foundation verified:** Existing foundation specs contain verification evidence. No Phase 1–3 checklist item or delivery item had been completed at this point.
- **2026-10-22 — Staff authentication verified:** P1-01 and P1-02 completed through the [staff authentication and roles specification](specs/staff-authentication-and-roles/spec.md). Evidence: frontend `bun run check` (38 tests), backend `bun run check` (34 tests across 11 files), real SQLite migration and database check, 26 real desktop/mobile browser tests, and six live browser lifecycle checks for deleted, expired and disabled sessions, password reset, current role changes, and outage recovery. P1-03 remains pending.
- **2026-10-22 — Login form refactor verified:** The delivered P1-01 form now uses React Hook Form, Zod and local Base Nova field/input primitives without changing the native authentication protocol. Evidence: frontend `bun run check` (39 tests), backend `bun run check` (34 tests across 11 files), and 28 real desktop/mobile browser tests, including same-tick duplicate submission and held request/navigation transitions. P1-03 remains pending.
- **2026-10-26 — Lead management verified:** P1-03–P1-09, P1-16 and P1-20–P1-22 completed through the [lead-management specification](specs/lead-management/spec.md). Evidence: frontend 122 unit tests in 21 files and production build passed; backend 78 tests in 20 files, SQLite migration and database check passed; browser regression passed 96 tests with 4 existing conditional viewport skips, plus focused lead coverage 18/18 and supplemental desktop/mobile search normalization checks 2/2. Production deployment is not claimed; real-customer collection requires operator-approved privacy/retention wording and trusted ingress configuration.
- **2026-10-26 — CRM route guard/loading maintenance verified:** [CRM route guard and scoped loading](specs/crm-route-guard-loading/spec.md) adds the cookie-presence CRM Proxy gate and scoped account/list loading without completing a roadmap item or changing Express contracts. Evidence: API contract generation, lint, typecheck, 138 unit tests and the final production build passed; the final combined desktop/mobile browser suite passed 97 tests with one conditional skip. Production HTTPS cookie topology remains unverified.
- **2026-10-23 — Frontend data/forms maintenance verified:** The [data/forms refactor specification](specs/frontend-data-and-form-refactor/spec.md) records separated property API/read/mutation modules, authenticated Server Actions for existing property writes, shared form controls, hydration readiness and streamed CRM results. This is maintenance of delivered property workflows, not a new roadmap feature; checklist IDs and completion states are unchanged. Evidence: `bun run api:check`, lint, format check, typecheck and production Webpack build passed; 75 unit tests in 11 files and 44/44 desktop/mobile fixture browser tests passed. Production HTTPS/secure-cookie browser topology remains unverified.
- **2026-10-27 — Sales pipeline verified:** P1-10 completed through the [sales-pipeline specification](specs/sales-pipeline/spec.md). Frontend API drift, lint, formatting and type checks passed with 142 unit tests in 26 files and an isolated production Webpack build. Backend `bun run check` passed with 78 tests in 20 files, including its build. The full isolated desktop/mobile browser regression passed 140 tests with 6 conditional viewport skips (146 total); focused pipeline coverage passed 20 tests with 2 mobile skips for desktop-only dragging. Coverage includes pointer and keyboard drag/cancel, terminal confirmation, conflicts, role ownership/reassignment, pagination/retry, held reads, lost save responses and session loss. Layouts were checked at 320, 390, 768 and 1440px; desktop/mobile screenshots were visually reviewed. Next.js DevTools confirmed an active pipeline browser session with no configuration or session errors. Existing Express lead contracts and authorization remain authoritative; no API/schema change or production deployment is claimed.
- **2026-10-27 — Public contact and agent pages verified:** P1-17 completed through the [public contact and agent pages specification](specs/public-contact-and-agents/spec.md). Backend `bun run check` passed with 90 tests in 22 files and a production build; frontend API drift, lint, formatting, typecheck, 166 unit tests and an isolated production Webpack build passed. The final isolated sequential browser suite passed 161 tests with 7 intentional project-specific skips (168 total), and focused desktop/mobile receipt and validation-summary focus coverage passed 4/4. Coverage includes public-to-CRM assignment/Agent visibility, idempotent retries, held writes, edit-as-new, shared rate limits, 404/503 distinctions, portrait fallback, accessible names/focus, keyboard navigation, four viewport widths, 200% text and reduced motion. Final desktop/mobile screenshots were reviewed with all fictional portraits loaded; runtime inspection reported no configuration or session errors. This verifies the fictional demo delivery only: real contact facts, profile/portrait approvals and live inquiry wording remain required before real-business publication.
- **2026-10-27 — Review remediation evidence:** No roadmap feature or checklist state changed. Frontend API drift, lint, formatting, typecheck, 199 unit tests in 34 files and an isolated production build passed; backend `bun run check` passed with 94 tests in 23 files. Focused browser regressions confirm canonical whitespace phones, full pasted phone preservation, unknown-mode Contact copy, saved-receipt recovery and outcome-accurate pipeline announcements. Runtime inspection confirmed the expected checkout and a 390px Contact probe with no configuration or session errors, without submitting against the user dev server. The full browser run reported 163 passed, 8 intentional skips and one pointer-cancel test synchronization failure. After correcting the test to wait for settled drop-animation geometry and verify an active drag before Escape, that case passed three consecutive isolated reruns. All 164 applicable browser cases are covered across these runs; a single clean full-suite rerun is not claimed. The real-business publication gate remains unchecked.
- **2026-10-29 — Viewing management verified:** P1-23–P1-25 completed through the [viewing management specification](specs/viewing-management/spec.md). Backend `bun run check` passed with 105 tests in 28 files; additive migration and database checks passed, including a populated disposable upgrade and a backed-up local development upgrade. Frontend API drift, lint, formatting, typecheck, 218 unit tests in 39 files and an isolated production build passed. Two final-source browser runs passed with no failures: the viewing suites passed 34/34 desktop/mobile cases in 3.7 minutes, covering booking, rescheduling, cancellation, feedback, receipt recovery, reassignment, pagination, Dubai display in an America/New_York browser, dirty/pristine refresh guards and 320/390/768/1440px layouts; the remaining existing suites passed 165 cases with 9 conditional project/viewport skips in 12.9 minutes. Together, the runs cover 199 passing cases, 9 skips and 208 registered cases, and are not represented as one combined suite. Live runtime inspection confirmed `/crm/viewings` in the expected checkout with no configuration or session errors.
- **2026-10-29 — Follow-up tasks verified:** P1-26/P1-27 completed through the [follow-up-tasks specification](specs/follow-up-tasks/spec.md). Backend `bun run check` passed with 119 tests in 33 files; fresh/populated migration checks and an additive local-database backup/upgrade passed without inferred tasks. Frontend API validation, lint, formatting, typecheck, 241 tests in 45 files and an isolated task build passed. All 36 task cases have passing evidence across a 35/36 worker run plus unchanged exact-timestamp and repeated responsive serial reruns (2/2); this is not represented as one clean 36/36 run. The unchanged serial legacy browser regression passed 199 cases with 9 conditional viewport/project skips and no failures in 16.8 minutes; earlier high-concurrency worker load/router initialization failures were not reproduced and every affected case passed serially. Runtime inspection confirmed `/crm/tasks` in the expected checkout with no configuration/session errors. Final desktop/mobile form, list and detail review passed at 320/390/768/1440px with no overflow. No commit, push or deployment is claimed.
- **2026-10-29 — Agency dashboard verified:** P1-28–P1-30 completed through the [agency dashboard specification](specs/agency-dashboard/spec.md). Backend `bun run check` passed with 126 tests in 35 files, including aggregate authorization, Dubai-boundary, consistency and WAL-snapshot coverage; frontend `bun run check` passed with 271 tests in 46 files. The final dedicated dashboard suite passed 16/16 desktop/mobile cases with no skips or failures, refreshed screenshots and clean runtime diagnostics; [visual QA](design-qa.md) found no P0/P1/P2 findings. The revised pipeline session case passed six focused repeats. Legacy browser evidence covers every active case across two non-clean parallel runs; the dashboard specification records the timing/sign-in-cache limitation and does not claim a single clean full legacy run.
- For later deliveries, append the date, checklist IDs, actual feature-spec links, verification evidence and any remaining gaps.

---

## ⚠️ Risks & Open Questions

**Risks**

- **Risk:** Partial UI or infrastructure is mistaken for a completed feature — _Mitigation:_ leave the original item's checkbox unchecked until its full acceptance is verified.
- **Risk:** Separate repositories drift on API contracts or progress — _Mitigation:_ use backend-owned contracts, repository-local specs and this single master roadmap.
- **Risk:** Phase 1 grows into a single large implementation — _Mitigation:_ deliver the proposed flow in small verified slices while retaining the complete release checklist.
- **Risk:** SQLite or local disk is replaced without migrating data — _Mitigation:_ specify and test the migration separately when needed.

**Open questions** _(blockers for implementation of the relevant feature, not for saving this roadmap)_

- **Staff access:** What can Managers and Agents create, edit, assign, archive or delete? Who manages staff accounts?
- **Properties and leads:** Confirm sales/rentals scope, draft/publish behavior, delete/archive rules and how repeat inquiries or interest in multiple properties should be represented.
- **Pipeline and reports:** What event means Won, how is conversion calculated, and what timestamps define agent response time?
- **Phase 2 selection:** Which two or three enhancements come first? Does WhatsApp mean a user-opened link or an automated messaging integration?
- **Later release scope:** Confirm production versus portfolio delivery, hosting, language needs, and the requirements for each selected Phase 3 feature when it is prioritized.

- **2026-10-27 — Shared-code naming maintenance verified:** [Shared-code naming and ownership](specs/shared-code-naming/spec.md) moves common transaction, HTTP and search helpers out of property-owned modules, separates LoadingState from skyline artwork and explicitly names PropertyInquiryCard. All imports and current documentation are reconciled. Frontend API drift, lint, formatting, TypeScript, 199 tests in 34 files and isolated production build passed; backend complete quality checks passed with 94 tests in 23 files, production build and disposable database verification. Isolated desktop/mobile smoke coverage passed 11 tests with one intentional mobile skip. Fresh scoped review found no actionable findings. No roadmap checklist state or real-business publication gate changed.

- **2026-10-27 — Pipeline drag-stability correction verified:** The [sales-pipeline specification](specs/sales-pipeline/spec.md#drag-stability-correction--2026-10-27) records atomic stage refresh, removal of the conflicting drop animation, stable board/card status space and post-commit focus without scrolling. The 1480×807 forward/return regression stays within 2px for board height, viewport position and both scroll measurements; three consecutive final geometry/focus runs passed. Frontend API drift, lint, formatting, TypeScript, 199 unit tests and isolated production build passed. The complete pipeline suite passed 21 tests with three intentional mobile skips. Scoped review and active pipeline runtime diagnostics were clean. No API/schema/authorization, milestone checklist or real-business publication gate changed.
