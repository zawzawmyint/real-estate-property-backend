# 🧭 Real Estate Agency Master Roadmap

> **Goal:** Deliver the public property website and internal CRM feature by feature, then add selected enhancements and the optional client portal.

---

## 🎯 Objective

Track every Phase 1, 2 and 3 feature from the original **Real Estate CRM Checklist**, without treating project setup as completed business functionality.

**Current baseline:** Foundation is complete; 18 verified Phase 1 checklist items are complete and 24 Phase 1–3 checklist items remain pending. The original five portfolio delivery items are retained separately. This roadmap is the workspace-wide source of truth for feature progress; repository-local specifications define implementation and acceptance.

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
- Public discovery, CRM property inventory/lifecycle and listing-photo workflows are implemented with backend-enforced resource authorization. CRM authentication and Admin/Manager/Agent roles, public inquiries, lead ownership and follow-up are implemented; pipeline and dashboards remain future work.
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

**Verified maintenance (2026-10-23):** the frontend specifications at `frontend/specs/header-sidebar-polish/spec.md` and `frontend/specs/typography/spec.md` improve the delivered public/CRM experience without completing an additional roadmap item. P1-18 remains unchecked because its wider public mobile-layout scope is still incomplete.

**Verified (2026-10-26):** [inquiry capture and lead management](specs/lead-management/spec.md) delivers P1-03–P1-09, P1-16 and P1-20–P1-22: manager-distributed inbox, manual and website leads, ownership, stage changes, notes/calls and timeline. P1-10 Kanban, viewings/tasks, notifications and wider P1-18 mobile acceptance remain separate.

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

**Proposed spec slug:** `sales-pipeline`.

- [x] **P1-09** Stages: New, Contacted, Viewing Scheduled, Offer, Won, Lost
- [ ] **P1-10** Kanban board with drag-and-drop between stages

#### Property management

**Status: Verified** — [property management and public discovery](specs/property-management/spec.md) and [demo property presentation](specs/demo-property-data/spec.md). Backend checks passed with 56 tests in 13 files, frontend checks passed with 51 unit tests plus production build/API drift validation, and 40 desktop/mobile browser checks passed.

- [x] **P1-11** Add, edit, delete and archive properties
- [x] **P1-12** Fields: title, type, price, location, beds, baths, area, photos, status, owner name and phone
- [x] **P1-13** Properties show on the public site automatically

#### Public website

**Current specs:** [property management and public discovery](specs/property-management/spec.md), [demo property presentation](specs/demo-property-data/spec.md); `public-contact-and-agents` remains proposed.

The verified property and lead deliveries cover filtered listings P1-15, search/featured portions of P1-14, the complete P1-16 detail/gallery/inquiry flow, and responsive property screens within P1-18. P1-14 and P1-18 remain unchecked because their wider scope is incomplete. P1-19 is complete with generated illustrative fixture images, not the source checklist's free photos.

- [ ] **P1-14** Home page with search bar and featured listings
- [x] **P1-15** Listings page with filters
- [x] **P1-16** Property detail page with gallery and inquiry form
- [ ] **P1-17** Contact and agent pages
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

**Proposed spec slug:** `viewing-management`.

- [ ] **P1-23** Schedule a viewing for a lead and a property
- [ ] **P1-24** Calendar view
- [ ] **P1-25** Feedback notes after the viewing

#### Tasks and reminders

**Proposed spec slug:** `follow-up-tasks`.

- [ ] **P1-26** Create follow-up tasks with date and time
- [ ] **P1-27** Highlight overdue tasks

The source requires dated tasks and overdue highlighting here; scheduled email or WhatsApp reminders are not silently added.

#### Dashboard

**Proposed spec slug:** `agency-dashboard`.

- [ ] **P1-28** New leads this week, deals won, conversion rate
- [ ] **P1-29** Chart: leads by source
- [ ] **P1-30** Chart: pipeline by stage

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
- **2026-10-23 — Frontend data/forms maintenance verified:** The data/forms refactor specification (`../frontend/specs/frontend-data-and-form-refactor/spec.md`) records separated property API/read/mutation modules, authenticated Server Actions for existing property writes, shared form controls, hydration readiness and streamed CRM results. This is maintenance of delivered property workflows, not a new roadmap feature; checklist IDs and completion states are unchanged. Evidence: `bun run api:check`, lint, format check, typecheck and production Webpack build passed; 75 unit tests in 11 files and 44/44 desktop/mobile fixture browser tests passed. Production HTTPS/secure-cookie browser topology remains unverified.
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
