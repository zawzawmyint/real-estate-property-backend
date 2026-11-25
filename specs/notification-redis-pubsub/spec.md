# Redis Pub/Sub for CRM notification signals

Status: Implemented locally — 2026-11-23. Local verification is complete; production activation and deployment remain separate.

## Goal

Deliver live CRM inbox-change signals across cooperating Express processes while retaining the database inbox, current authorization and browser SSE contract.

## Scope and exclusions

- Add an opt-in Redis implementation of `NotificationSignalTransport`, selected at API startup. Reuse installed ioredis 6.0.0 and the email Redis service through dedicated connections.
- Cover all existing assignment, viewing, task and website-enquiry notifications, including retirement/read changes that already publish through the notification service. Do not add new business triggers.
- Preserve default in-process mode. No database migration, dependency addition, separate worker, queue, public endpoint or frontend product change is required.
- Exclude durable signal replay, Redis Streams, a signal outbox, browser push, WebSockets, customer notifications, preferences, Redis Cluster/Sentinel topology, and general multi-host deployment readiness.
- SQLite API/worker same-host/shared-file constraints, process-local auth/chat limits and other scaling requirements remain independently applicable. Pub/Sub alone does not approve multiple production instances.

## Behavior and contracts

### Ownership and interfaces

- Business services keep recipient/occurrence rules and transactional writes. `notifications.service.ts` publishes only after commit; rollback must produce no signal. Stored inbox/read/retirement state remains authoritative.
- Preserve `NotificationSignalTransport.publish(recipientIds: readonly string[]): void | Promise<void>` and `subscribe(recipientId: string, changed: () => void): () => void`. Browser subscriptions stay local; they do not open Redis connections.
- `notifications.redis-transport.ts` owns `startRedisNotificationTransport(config, logger): Promise<{ transport: NotificationSignalTransport; close(): Promise<void> }>` and a process-unique UUID origin. Its local listener map preserves local delivery without reusing email queue connections.
- `notifications.config.ts` owns `readNotificationTransportConfig(input)` and a discriminated `NotificationTransportConfig` union: `{ mode: 'memory' }` or `{ mode: 'redis'; redisUrl: string; channel: string }`. It validates before opening connections and remains independent of SMTP/email-worker configuration.
- `server.ts` owns async creation, passes `transport` through the existing `createApp` notification options, and closes the runtime on startup failure or shutdown. `createApp` remains synchronous and defaults to memory for existing callers/tests.

### Configuration

- `NOTIFICATION_SIGNAL_TRANSPORT=memory|redis`, default `memory`. Only Redis mode requires `REDIS_URL` and `NOTIFICATION_REDIS_CHANNEL`.
- Reuse backend-only `REDIS_URL`; do not duplicate SMTP settings or connect using email queue/worker connections. In memory mode, unrelated Redis settings do not open clients or require validation by this feature.
- Require an explicit channel of 1–128 ASCII letters, digits, colons, underscores or hyphens. Operators must give each application/environment a different channel, for example `avenor:development:notifications`. Redis database numbers do not isolate Pub/Sub channels.
- Redis URLs accept `redis:`/`rediss:` with a host. Production Redis mode requires authenticated `rediss:` and certificate verification; validate errors by field/code without printing URLs or credentials. Follow existing email Redis production policy without importing its SMTP-dependent config reader.
- Add examples and operations guidance only when implementing. Do not add actual values to tracked environment files or enable Redis mode as part of writing these documents.

### Internal Redis message contract (backend-owned)

- Subscribe to one exact configured channel per API process, using one dedicated subscriber plus one dedicated publisher. Clients never receive Redis credentials or subscribe directly.
- JSON shape: `{ "version": 1, "origin": "<process UUID>", "recipientIds": ["<staff ID>"] }`. This is a refresh hint, not an authorization claim or notification record.
- Strictly validate keys/version/origin and 1–100 unique recipient IDs, each a nonempty string of at most 128 characters. Reject frames larger than 32 KiB before parsing. Deduplicate outgoing IDs and split larger recipient sets into batches of at most 100. Do not assume staff IDs are UUIDs.
- Publish no contact information, message text, lead/task/viewing IDs, cookies or notification payloads. Accept messages only on the configured exact channel; malformed/unknown-version messages produce a bounded safe warning and no callback.
- Deliver locally once immediately, then publish remotely. Ignore Redis messages bearing this runtime's origin to prevent self-echo. Other origins notify only matching local listeners. A duplicate remote hint may cause an extra safe refresh; do not add a durable dedupe store or promise exactly-once signals.
- Isolate listener callback failures so one bad connection does not block other recipients or remote publication. Preserve existing SSE slow-client cleanup and permission checks.

### Connections, outages and recovery

- Use lazy-created dedicated clients with 3-second connect/command timeouts. Publisher offline buffering and command auto-resend are disabled; do not retain an unbounded publish backlog. Apply one total 3-second remote-publication budget across all batches in a single signal; after a publish failure or deadline, skip remaining remote hints while retaining already-delivered local callbacks. Bound request retries to one and reconnect delays to a 250ms–5s backoff. Do not await a command indefinitely.
- Own subscriber restoration explicitly (`autoResubscribe: false`): on each Redis `ready`, issue `SUBSCRIBE` and wait for its acknowledgement before declaring the subscription established. Serialize restoration and ignore stale completions after another disconnect or shutdown.
- Allow at most 3 seconds for initial subscription establishment before API startup continues in degraded local-only delivery. Continue reconnecting in the background. Invalid configuration fails startup; a Redis network outage does not block business APIs or database inbox access.
- After every successful subscription acknowledgement, including late initial connection and recovery, invoke each currently registered local listener once. This refreshes browsers whose SSE connection stayed open while Redis was unavailable; a TCP `ready` event alone is insufficient proof of resubscription.
- Publishing or subscriber failure leaves database writes successful and local listeners operational. Emit allowlisted transition warnings/recovery logs, not one raw error per reconnect attempt. A failed remote publish does not retroactively fail a committed business operation.
- Pub/Sub is at-most-once and has no replay. Reconnection refresh recovers subscriber gaps; it does not guarantee delivery for a publisher-only failure or a crash between commit and publish. Such notifications remain available on the next normal inbox refresh/reconnect. Do not add periodic polling or stronger delivery claims in this slice.
- Shutdown first stops reminder production/new HTTP work and closes SSE streams, drains active business requests/reminder scans, then closes the notification transport before disconnecting Prisma. Runtime `close()` is idempotent, stops reconnect/restoration work, removes listeners and closes both clients within a total 3-second budget, falling back to disconnect. Preserve the API's existing overall shutdown bound.
- Startup errors after transport creation must close its clients; failed listen and repeated shutdown must not leak handles. No notification worker or email-worker change is needed.

### Existing HTTP contracts and permissions

- Preserve [notifications OpenAPI](../../docs/api/notifications.openapi.yaml): authenticated `GET /api/v1/staff/notifications`, `PATCH /api/v1/staff/notifications/:id/read`, and `GET /api/v1/staff/notifications/stream`.
- Preserve payload-free `notifications.changed` SSE frames, initial refresh, 15-second live authorization heartbeat, no-store/no-transform headers and browser account/session handling. No DTO, role, pagination, generated-type or frontend snapshot change is intended.
- API reads/read mutations enforce live staff identity and resource access. Recipient IDs from Redis can request a refresh but never return data or grant access. Revoked users and former owners retain existing restrictions.

## Acceptance criteria

- [x] Review follow-up (2026-11-24): integration-fixture teardown attempts every child, stream, disposer and database cleanup even when a prior cleanup or shutdown assertion fails; reports collected failures only after cleanup completes. Shutdown timers are cleared on success and failure, and a lost IPC channel falls back to terminating the owned child.

- [x] Memory mode remains the default and works without Redis or SMTP configuration.
- [x] Valid Redis mode uses two dedicated connections per API process, one exact environment channel and no separate worker; invalid enabled configuration fails safely.
- [x] Assignment in API process A causes an authorized Agent connected to process B to receive an SSE hint and see the persisted inbox row without manual reload.
- [x] Existing viewing/task/enquiry/read/retirement producers use the same transport without changed recipient rules; rollback produces no publication and local origin produces no duplicate self-echo.
- [x] Unrelated recipients/channels, malformed/oversized/version-mismatched messages and throwing listeners cannot expose data or disrupt other delivery.
- [x] Startup outage is bounded, local delivery/database writes continue, and subscription acknowledgement after recovery refreshes existing SSE clients without browser reconnection.
- [x] Publish failures have one bounded remote-publication budget/no buffered backlog; documented skipped-batch and publisher/crash gaps remain recoverable by inbox read, without claiming guaranteed instant delivery. The two failing-first budget regressions and refreshed full backend gate pass.
- [x] Disconnect during subscription restoration and shutdown during reconnect leave no leaked connections, timers, callbacks or unhandled rejections; startup/listen failure cleans up.
- [x] Existing auth/inbox/SSE behavior and email queue/worker tests pass; cross-process Redis integration and desktop/mobile browser compatibility pass.
- [x] Specs, operations, tech-stack adoption status and both roadmaps are reconciled after local verification. Production activation remains separately recorded.

## Validation

- Focused tests were observed failing before implementation, then passed: seven config/environment assertions, seven transport assertions (including two failing-first total-publication-budget regressions), and two initially red cross-process/lifecycle wiring assertions. The full new Redis coverage is 15 tests: five configuration, seven transport, and three real-Redis integration/lifecycle tests.
- The integration test runs two child APIs with a shared disposable SQLite file and a unique channel. It verifies remote authorized SSE/inbox refreshes, reads and retirements, recipient/channel isolation, rollback silence, subscriber outage/recovery, bounded degraded startup, and listen-collision cleanup.
- The refreshed backend `bun run check` passed lint, formatting, typecheck, 365 tests in 79 files and build after the two failing-first total-publication-budget regressions passed in the focused transport suite (7/7). Fresh and rerun disposable migrations plus `bun run db:check` passed. Frontend `bun run check` passed contract parity, lint, formatting, typecheck, 440 tests in 62 files and build.
- The 2026-11-24 test-only teardown follow-up first reproduced the defect in extracted cleanup (a later healthy child was not sent its shutdown request after an earlier failure). The five `notification-fixture-cleanup` regressions now pass, covering later cleanup after an unhealthy child, forced termination, disposer/database failure collection, disconnected IPC, and throwing or asynchronously rejected sends. A fresh backend `bun run check` passed lint, formatting, typecheck, 370 tests in 80 files and production build; the three real-Redis API integration cases also passed. Evidence: `.delivery-work/notification-redis-pubsub-review/cleanup-red.log`, `cleanup-green.log`, and `backend-check.log`.
- One Redis-enabled isolated browser run passed all four existing desktop/mobile notification cases. The active port-3100 checkout was identified with Next DevTools while `/crm/leads/[id]` was open; configuration and session errors were empty.
- Local evidence used Redis 7.2.4. Compose/CI pin Redis 8.2.10 but Docker was unavailable, so that image and CI were not run. No production ingress/Redis deployment, normal-database migration, live SMTP, commit or push is claimed.

## Risks and rollout

- Local implementation evidence is recorded above and in [the implementation plan](../../docs/superpowers/plans/2026-11-23-notification-redis-pubsub.md). Preserve original P2-02 verified scope in [CRM notifications](../crm-notifications/spec.md).
- Deploy with memory mode first. Provision TLS/authenticated Redis, restricted channel permissions and process configuration; enable Redis mode consistently in cooperating API processes sharing the supported database. Mixed modes retain local delivery but cannot promise cross-process updates.
- Roll back by restoring `NOTIFICATION_SIGNAL_TRANSPORT=memory` and restarting affected APIs. Keep persisted notifications and email queue settings intact; no schema rollback or Redis flush is required.
- Reusing Redis shares availability/capacity with email. Use separate connections/channels and monitor connection count/errors. Pub/Sub adds no email jobs and cannot consume email rate-limit allocation.
- This is a follow-up enhancement to P2-02, not a new original checklist item or evidence of a live Phase 2 release. Deployment topology, credentials and channel ownership must be confirmed before activation.

References: [Redis Pub/Sub guarantees](https://redis.io/docs/latest/develop/pubsub/) and [pinned ioredis 6.0.0 connection behavior](https://github.com/redis/ioredis/blob/v6.0.0/README.md).
