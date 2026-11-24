# 📡 Redis Notification Pub/Sub Implementation Plan

> **Goal:** Add opt-in cross-process notification signals through Redis while preserving database-backed inboxes, existing SSE and local-only fallback.

---

## 🎯 Objective

The current in-memory transport reaches browsers connected to one Express process. The [backend specification](../../../specs/notification-redis-pubsub/spec.md) is now implemented locally so cooperating API processes can refresh each other's connected staff inboxes. This plan records local delivery; it is not an activation or deployment record.

---

## 📦 Scope

**In scope**

- Conditional transport configuration, dedicated Redis publisher/subscriber, bounded message validation and local delivery.
- Startup, acknowledged resubscription recovery, graceful shutdown, real cross-process tests and frontend compatibility verification.
- Reconcile feature specs, operations, existing notification docs and frontend-first shared roadmap/tech-stack records after verification.

**Out of scope**

- New notification triggers, frontend product behavior, API/schema changes, new dependencies, workers, durable event replay and full multi-host readiness.
- Production activation, live SMTP changes, customer portal, and automatic commit/push/deployment without authorization.

---

## ⚙️ Assumptions & Constraints

**Technical**

- Node 24.14.1, Bun 1.3.14 and installed ioredis 6.0.0. No new dependency or Prisma migration. Current APIs remain in [notifications OpenAPI](../../../docs/api/notifications.openapi.yaml).
- `NotificationSignalTransport` retains its existing synchronous `subscribe` cleanup interface and `void | Promise<void>` publish signature. `createApp` stays synchronous and defaults to memory.
- `NOTIFICATION_SIGNAL_TRANSPORT` defaults to `memory`. Redis mode requires `REDIS_URL` and an explicit `NOTIFICATION_REDIS_CHANNEL`; production requires authenticated verified TLS.
- Follow the spec's exact message bounds: version 1, UUID origin, 1–100 unique recipient IDs of at most 128 characters, 32 KiB frame limit, and channel length 1–128 with the documented ASCII allowlist.
- Connection/command/initial establishment budgets are 3 seconds; one signal's remote publication across every batch also has a total 3-second budget, after which remaining remote hints are skipped while local callbacks remain delivered. Reconnect backoff is 250ms–5s. Publisher offline buffering/auto-resend is disabled. Runtime close is idempotent with a total 3-second cleanup budget.
- Pub/Sub signals are best-effort. Database writes/permissions remain authoritative; recovery cannot promise replay or guarantee the commit-to-publish gap.

**Product / Business**

- Existing P2-02 and supplemental notification behavior stays verified at its current scope. This enhancement is locally verified and does not change the original checklist item.
- Local same-process delivery continues during Redis outages. Frontend appearance and staff permissions remain unchanged.

**Dependencies**

- Existing [notification transport](../../../src/modules/notifications/notifications.transport.ts), [service](../../../src/modules/notifications/notifications.service.ts), [SSE streams](../../../src/modules/notifications/notifications.stream.ts), [app wiring](../../../src/app.ts) and [API lifecycle](../../../src/server.ts).
- A dedicated disposable Redis test endpoint, unique environment/test channels, two child API processes sharing supported disposable SQLite, and existing browser fixtures.
- Production channel ownership, credentials and hosting are activation inputs; no production values are needed for implementation.

---

## 🧩 Proposed Approach

**Architecture:** Keep business transactions and inbox storage unchanged. A Redis transport notifies local listeners immediately, publishes a recipient-only envelope, ignores its own origin on receipt and dispatches remote hints to matching local SSE listeners. Every successful acknowledged subscription refreshes all local listeners to repair subscriber gaps.

**Alternatives considered:** Keep memory-only delivery for a single API process; add Redis Pub/Sub for cross-process refresh hints; or introduce durable queued signals. Pub/Sub is the proposed approach from the discussion because inbox persistence already handles recovery and durable signal delivery is outside the current need.

**Files and interfaces**

- Create `src/modules/notifications/notifications.config.ts`: `readNotificationTransportConfig(input)` returns the exact memory/redis discriminated union defined in the spec. Modify [env validation](../../../src/config/env.ts) and [.env.example](../../../.env.example) only as needed to expose and conditionally validate those fields.
- Create `src/modules/notifications/notifications.redis-transport.ts`: `startRedisNotificationTransport(config, logger)` returns `Promise<{ transport: NotificationSignalTransport; close(): Promise<void> }>`. Reuse the memory listener map, not email queue connections. Keep restoration generation and cleanup state feature-local.
- Modify [server lifecycle](../../../src/server.ts) to create/inject/close the chosen transport and handle startup/listen failures. Use existing `createApp(..., notificationOptions)` injection; do not introduce a generic runtime container.
- Preserve current HTTP bodies/statuses, SSE payload, notification DTOs, database shape and frontend generated types. The backend spec owns the new internal Redis envelope; no new HTTP contract file is necessary.
- Extend backend tests and the existing frontend notification browser suite only where needed. Companion frontend compatibility spec: `frontend/specs/notification-redis-pubsub/spec.md`.

**Review focus**

- A subscriber disconnects between TCP readiness and `SUBSCRIBE` acknowledgement: no premature recovered state; refresh after the current subscription succeeds (Task 2).
- A Manager action commits while Redis publication fails: successful write/local update and bounded remote failure, with documented refresh recovery (Tasks 2–3).
- Untrusted, oversized or cross-environment Redis messages: no callback/data disclosure and safe bounded logging (Task 2).
- Two APIs share a database and emit origin echoes/duplicate signals: one local happy-path hint, correct remote authorized inbox, no duplicate persisted notification (Tasks 2–3).
- Shutdown/startup failure overlaps reconnect or reminder work: no late callback, open client or blocked process exit (Task 3).

---

## 🚀 Execution Plan

**Execution guidance:** Implement task by task using the executing-plans skill, or subagent-driven-development if the user selects delegation. Observe failing tests before implementation; leave each task unchecked until verified. Do not implement during this documentation request.

1. **Define conditional configuration** — _(role: backend)_ — a tested config reader that keeps memory mode dependency-free.

**Files:** create `src/modules/notifications/notifications.config.ts` and `tests/notification-transport-config.test.ts`; modify `src/config/env.ts`, `.env.example`, and `tests/env.test.ts` where integration requires it. **Consumes:** raw server environment. **Produces:** `NotificationTransportConfig = { mode: 'memory' } | { mode: 'redis'; redisUrl: string; channel: string }` and `readNotificationTransportConfig(input: Record<string, string | undefined>): NotificationTransportConfig`.

- [ ] Write tests named `defaults to memory without Redis or SMTP`, `requires channel and Redis URL only in Redis mode`, `rejects malformed mode/channel/URL`, and `requires authenticated verified TLS in production`. Assert field/code-only errors, exact channel bounds and no Redis client creation in memory mode.
- [ ] Run `bun run test -- tests/notification-transport-config.test.ts tests/env.test.ts`; confirm new assertions fail because the reader/validation is absent.
- [ ] Implement the reader and integrate conditional validation without changing email-worker validation or persisting secrets in docs/examples.
- [ ] Repeat the focused tests and `bun run typecheck`; require exit 0. Review the diff for accidental SMTP coupling.

2. **Implement Redis signal transport and recovery** — _(role: backend)_ — a compatible transport with deterministic outage/lifecycle behavior.

**Files:** create `src/modules/notifications/notifications.redis-transport.ts` and `tests/notification-redis-transport.test.ts`; reuse `notifications.transport.ts`. **Consumes:** Task 1 Redis config and a safe logger. **Produces:** `startRedisNotificationTransport(config: Extract<NotificationTransportConfig, { mode: 'redis' }>, logger: Pick<ReturnType<typeof createLogger>, 'warn' | 'info'>): Promise<{ transport: NotificationSignalTransport; close(): Promise<void> }>`.

- [ ] Write focused tests for two dedicated clients, exact-channel subscription, dedupe/batch bounds, strict envelope rejection, local-first dispatch, self-origin suppression and throwing-listener isolation. Assert 101 recipients form 100/1 batches and oversized incoming frames never reach JSON parsing/listeners.
- [ ] Add controlled-client tests named `recovers only after subscription acknowledgement`, `ignores stale restoration after another disconnect`, `continues locally through bounded startup and publish failure`, and `closes once during reconnect without late callbacks`. Assert initial 3-second bound, current listener refresh after acknowledgement, no offline publish backlog and total 3-second close budget.
- [ ] Run `bun run test -- tests/notification-redis-transport.test.ts`; observe relevant failures before implementing.
- [ ] Implement dedicated lazy clients, local listener forwarding, origin envelope and explicit acknowledged restoration (`autoResubscribe: false`) with spec budgets, transition logging and safe cleanup. Do not introduce a generic message bus, delivery queue or new worker.
- [ ] Run config/transport tests and `bun run typecheck`; require all pass. Inspect one actual Redis exchange in Task 3 rather than treating mocked clients as integration evidence.

3. **Wire API lifecycle and prove cross-process delivery** — _(role: backend)_ — working remote SSE updates with safe fallback and cleanup.

**Files:** modify `src/server.ts`; create `tests/notification-redis-integration.test.ts` and, if needed, `tests/notification-runtime.test.ts` plus feature-local child-process fixtures under `tests/`. Preserve `src/app.ts` injection and existing synchronous callers; adjust `scripts/auth-e2e-server.ts`/test fixture teardown only to opt into Redis verification.

- [ ] Add real-Redis tests with unique channels and two child API processes sharing one migrated temporary SQLite file. Commit an assignment through A, receive its remote SSE hint through B, and confirm the correct recipient's inbox row. Test unread/read and retirement changes across processes, unrelated recipient/channel isolation, rollback silence and no duplicate stored rows.
- [ ] Add failure tests for separate publisher/subscriber disconnects, Redis unavailable during startup, recovery while SSE remains connected, and shutdown/listen failure during restoration. Assert successful business writes/local delivery, current-subscription refresh, bounded exit and closed clients. Use controlled clients for deterministic race timing and real Redis for actual routing/reconnection.
- [ ] Run new integration/lifecycle tests and observe failures before wiring startup. Use `EMAIL_TEST_REDIS_URL` as test-only input mapped into each child's notification `REDIS_URL`, never the normal database or live SMTP.
- [ ] Wire selected transport before listen, preserve default memory fixtures, close SSE first and transport after request/reminder drain, and clean up on startup/listen failure. Keep ownership/dedupe rules, email worker and reminder scan semantics intact.
- [ ] Run `bun run test -- tests/notification-transport-config.test.ts tests/notification-redis-transport.test.ts tests/notification-redis-integration.test.ts tests/notifications.test.ts tests/notification-stream.test.ts tests/notification-triggers.test.ts tests/task-notification-reminders.test.ts` plus the new lifecycle test if created. Require exit 0, then `bun run check` and disposable migration/rerun/`bun run db:check`.

4. **Verify browser compatibility and reconcile delivery records** — _(role: fullstack)_ — demonstrated unchanged frontend behavior and accurate adoption docs.

**Files:** companion frontend `tests/e2e/notifications.spec.ts` only for missing assertions; feature specs and indexes in both repositories; existing CRM notification specs; backend `docs/development.md`, both root `spec.md`, and frontend-first `ROADMAP.md`/`TECH_STACK.md` copies.

- [ ] Run frontend `bun run check` and the desktop/mobile notification browser suite against the Redis-enabled isolated fixture. Preserve API snapshot parity, account isolation, keyboard/focus, 320px layout, read persistence and browser reconnect behavior. Add only absent recovery assertions with a failing-first test.
- [ ] Identify the actual port-3100 checkout through Next DevTools, open an affected CRM page, and inspect `get_errors`/`get_page_metadata`; record an active browser session, not an absent-session result. Test deployed proxy behavior separately before production activation.
- [ ] Request scoped review of startup/reconnect/shutdown, message validation, database/authorization boundaries and email coexistence. Fix confirmed issues and rerun affected gates; do not claim broad production scaling from a two-process local test.
- [ ] Reconcile documentation after code/tests settle, delegating final documentation ownership to `spec-updater` when available. Review its diff, preserve original roadmap IDs/counts, record actual Redis version and check only criteria with evidence. Synchronize shared docs frontend first, then backend.
- [ ] Run final formatting, local-link, contract/checklist parity and Git whitespace checks. Report local verification separately from deployment/activation. Commit/push only if authorized for the implementation delivery.

---

## 📋 Delivery record

Tasks 1–3 completed locally. Focused tests first observed the missing config reader (then seven config/environment assertions passed), missing transport (then five original transport assertions passed), and missing cross-process wiring (then two red integration/lifecycle assertions passed). Scoped review then added two failing-first sequential-batch publication-budget regressions; the transport suite is now green at 7/7. The final Redis coverage is 15 tests: five configuration, seven transport and three real-Redis integration/lifecycle tests.

Task 4 completed its product/documentation checks and a scoped review correction. The two new failing-first sequential-batch publication-budget regressions are green; the refreshed backend `bun run check` passed lint, format, typecheck, 365 tests in 79 files and build. Frontend `bun run check` passed parity, lint, format, typecheck, 440 tests in 62 files and build. Disposable migration/rerun/database checks passed. One `STAFF_E2E_NOTIFICATION_REDIS=1` desktop/mobile browser run passed 4/4; active `/crm/leads/[id]` runtime diagnostics were clean. Local Redis was 7.2.4; compose/CI Redis 8.2.10 and CI were not run because Docker was unavailable.

- [x] **2026-11-24 review follow-up:** The test-only integration-fixture cleanup repair now attempts all child, stream, disposer and database cleanup even after prior failures, aggregates failures after cleanup, clears shutdown timers in `finally`, and force-terminates an owned child when IPC is unavailable. The extracted cleanup test first reproduced the skipped later healthy-child shutdown; all five new `notification-fixture-cleanup` cases are green. A fresh backend `bun run check` passed lint, format, typecheck, 370 tests in 80 files and production build, and the three real-Redis API integration cases passed. Evidence is retained in `.delivery-work/notification-redis-pubsub-review/cleanup-red.log`, `cleanup-green.log`, and `backend-check.log`. This changes no production behavior, API, configuration, schema or migration; no frontend/browser rerun was needed. The Redis 8.2.10/CI caveat remains unchanged.

## ✅ Acceptance Criteria

**Functional**

- [x] Another API process can signal the recipient's existing browser SSE/inbox flow after commit.
- [x] Existing trigger/read/retirement/permissions behavior and memory mode remain compatible.
- [x] Acknowledged subscriber recovery refreshes connected inboxes; business writes/local delivery survive Redis outages.

**Non-functional** (performance, security, accessibility, reliability)

- [x] Connections, payloads, batching, timeouts and shutdown meet the backend spec's explicit bounds.
- [x] Recipient/channel isolation, no sensitive message/log data and existing accessible UI behavior pass verification.
- [x] No new dependency/schema/worker/API surface; docs distinguish local verification from activation.

---

## 🧪 Validation Plan

**Manual tests**

- With two cooperating local APIs, assign/reassign a lead in one process and observe the correct Agent's bell through the other; verify old-owner retirement and read synchronization.
- Interrupt only the owned Redis/subscriber connection, keep the browser open, restore it and observe recovery. Inspect safe logs and stop owned processes cleanly.

**Automated tests**

- Tasks 1–3 cover config/envelope bounds, recovery races and real Redis across separate API processes; retain all existing notification/email regressions.
- Required backend/frontend gates, disposable migration/database checks, notification browser cases and active runtime checks must pass. Record compose/CI Redis 8.2.10 execution separately from fallback local 7.2.4 evidence.

**Rollback / mitigation**

- Restore memory mode and restart APIs; preserve the database inbox and email queue. No migration reversal or Redis flush. Keep selected-process topology and other production activation gates explicit.

---

## ⚠️ Risks & Open Questions

**Risks**

- **Risk:** Pub/Sub gaps are mistaken for durable delivery — _Mitigation:_ database inbox remains authoritative; resubscription refresh repairs subscriber gaps and docs state commit/publish gaps plainly.
- **Risk:** Shared Redis contention affects email — _Mitigation:_ dedicated connections/channels, bounded messages, no email connection reuse, and coexistence tests.
- **Risk:** Redis transport is mistaken for complete horizontal scalability — _Mitigation:_ preserve SQLite, process-local limit and deployed-ingress constraints as separate release gates.
- **Risk:** Listener restoration races shutdown — _Mitigation:_ generation guards, acknowledged subscription tests, bounded idempotent cleanup and process-exit verification.

**Open questions** _(blockers for implementation)_

- None for the proposed local feature. Production channel ownership, Redis credentials/ACLs and deployment topology must be settled before activation, not invented by this plan.
