# Staff authentication and roles

Status: Delivered and verified on 2026-10-22.

## Goal

Allow provisioned agency staff to sign in and out, protect CRM access with revocable database sessions, and establish Admin, Manager and Agent identities before business records exist. Covers P1-01 and the authentication portion of P1-02. P1-03 remains pending until lead ownership can be enforced against real records.

## Scope and exclusions

- In scope: email/password login, logout, session lookup, database migrations, backend authentication and role helpers, trusted operator commands for staff provisioning/recovery/deactivation, configuration and security tests.
- Proposed defaults for review: staff-only access; no public signup; operational account management through a backend command rather than an Admin screen; fixed eight-hour sessions; no remember-me option.
- Out of scope: public customer accounts, OAuth, MFA, invitations, email verification or reset emails, staff-management UI, property/lead permissions and a customer portal. Do not add SMTP, Redis or a new database provider for this slice.
- Approaches considered: existing planned Better Auth with SQLite-backed sessions (recommended); a hosted identity service (adds an external account and migration decision); custom password/session infrastructure (unnecessary ownership of authentication primitives).

## Behavior and contracts

### Ownership and dependencies

- Express runs the Better Auth server, credential hashing, database sessions and staff role checks. Next.js uses `createAuthClient` from `better-auth/react` for browser authentication and owns presentation/redirects; it never validates credentials or accesses the database. There is no second Better Auth server in Next.js.
- Use the Better Auth Prisma adapter with the current generated Prisma client and SQLite driver adapter. Better Auth 1.7.12 is pinned. Credential creation/login/session/revocation are verified against temporary real SQLite databases.
- Use Better Auth's Admin plugin only for trusted server-side account provisioning/password operations as needed. Configure exactly `admin`, `manager`, `agent` roles and prevent role input from public requests. Plugin administration, impersonation and signup operations must never be reachable over HTTP; the boundary allowlist denies those paths before the native handler.
- Mount the native Better Auth handler at `/api/v1/auth` through Better Auth's vendor Node/Web Request adapter. An exact method/path allowlist admits only POST `/sign-in/email`, GET `/get-session` and POST `/sign-out`; all other auth paths, including plugin administration, are denied before the library handler. The adapter bounds raw request bodies to 100 KiB before native JSON parsing and preserves native responses and Set-Cookie headers; it does not rebuild sign-in/session/logout as custom response wrappers.
- Preserve native Better Auth response/status/error semantics for the React client, including successful anonymous session lookup returning `null`. Keep the project's `{error:{code,message,requestId}}` envelope for non-auth business endpoints only. Apply auth boundary failures in the native `{code,message}` style and retain `X-Request-Id` correlation. Preserve all Set-Cookie headers separately.
- `docs/api/openapi.yaml` documents the implemented auth subset separately from project business errors; this [native protocol contract](contract.md) is backend-owned with an identical frontend snapshot. Better Auth client types cover auth; no OpenAPI client generator is used solely for auth. No cross-repository source imports.
- SQLite is the only database for this feature and its tests. No PostgreSQL provider, driver, migrations, compatibility layer or dual-database tests are included. A later PostgreSQL migration would be a separate feature and data-transfer decision.

### Staff and persistence

- Generate and review the selected Better Auth version's required User, Account, Session and Verification models as applicable, rather than guessing their adapter fields. Prisma migrations are the first persisted business-feature migration.
- Each staff user has a normalized unique email, display name, exactly one role and an active/disabled state. Application roles are lowercase in storage/API and shown as Admin, Manager and Agent in UI. Reject unknown roles; no implicit privilege fallback.
- Persist a server-controlled integer `credentialVersion` on User and Session. Capture the User version before credential verification and store that captured value on the issued Session. Reset increments the User version atomically with password replacement and session revocation; session reads/guards reject mismatches. Version fields are implementation metadata, never browser-controlled privileges or secrets, and existing session/token response compatibility is retained.
- Roles are server-controlled. Admin, Manager and Agent may enter the current CRM shell; this slice grants no unspecified business-resource permissions. Future modules define their own permission matrices and apply a deny-by-default rule.
- Session verification reads the current database user/role/active state on every protected request. Disable cookie session caching and cross-request authorization caching. Disabled/deleted users and revoked/expired sessions are unauthenticated immediately on the next request.
- Session duration is 28,800 seconds from issue time, without sliding renewal (`session.expiresIn` and `disableSessionRefresh: true`, cookie cache disabled). The client sends `rememberMe: true` as a fixed internal choice so the persistent cookie follows the database expiry; no remember-me control is shown. Do not accept `rememberMe: false` to silently select the library's alternate shorter expiry. Verify absolute expiry with a controlled clock; rendering a Server Component must not require cookie renewal.
- Credential hashes must never be returned. Native Better Auth responses may contain token/session metadata required by its protocol: do not rewrite them into the old sanitized contract or promise token-free JSON. Application code must not log, render, persist or use those fields as bearer credentials. Keep cookie-based authentication; no bearer plugin, localStorage or sessionStorage credentials. Use library hashing/verification, not custom cryptography.

### Login, logout and errors

- Normalize email by trimming surrounding whitespace and lowercasing, with the same rule for provisioning and login. Do not trim or transform passwords. Provisioned passwords are 12–128 characters; login validates nonempty input up to 128 without rejecting existing credentials for not meeting creation policy.
- Wrong password, unknown email and disabled account must present the same generic credential failure to the client, using a native Better Auth-compatible error code/status/message verified for the selected version. Configure library hooks for disabled-account normalization as needed; do not mint a valid session for disabled staff or expose ban reasons. Review timing differences during implementation.
- Use library validation/hooks for credential input. Allow the fixed `rememberMe: true` sent by the React client; reject role/user-ID injection, arbitrary callback URLs and attempts to alter the eight-hour policy. Frontend navigation is fixed to `/crm`. A successful login issues a fresh session rather than trusting an incoming session ID.
- Native logout returns its success object, revokes the current session and expires the corresponding cookie; it is idempotent for missing/expired sessions. Other devices' sessions remain valid unless an operator resets the password or disables the account.
- Validate origin before credential/session mutations, including logout without a session. Missing, `null` or nonmatching origins return 403. Sign-in and nonempty mutation bodies require JSON; accept the native client's empty sign-out request without inventing a mandatory body/content-type. Keep library CSRF checks enabled. The bounded adapter reads the raw body once to enforce the size limit, then passes an equivalent Web Request to the native handler.
- Apply a 100 KiB (102,400-byte) request-body limit at the auth HTTP boundary before native JSON parsing, for declared-length and chunked requests. Mounting before `express.json()` must not bypass the application's existing body-size bound. Return generic native-compatible 413 with no-store/correlation headers; use a bounded native stream adapter and preserve normal React client request/response behavior.
- Native GET `/get-session` returns 200 `null` when no valid active staff session exists; a store outage returns a safe non-2xx native error, never anonymous success. Non-auth protected routes continue using project 401/403 errors.
- Unexpected auth dependency/database failures must be generic native-compatible errors with correlation headers; never expose SQL, stack traces, hashes or secrets. Leave business endpoint errors unchanged.

### Cookie, proxy and configuration

- Browser calls go to the frontend's same-origin `/api/v1` proxy. The backend API is not a browser-facing cross-origin authentication service; do not enable wildcard CORS.
- `APP_ORIGIN` is the exact browser origin, initially `http://localhost:3100`; it is explicitly trusted. `BETTER_AUTH_URL` is the browser-visible auth base URL `http://localhost:3100/api/v1/auth` locally. Keep `API_URL` as the frontend's private Express origin and `PUBLIC_ORIGIN` as backend public-media configuration; do not overload either for auth trust.
- `BETTER_AUTH_SECRET` is a server-only secret of at least 32 characters with no fallback. Examples use placeholders, never working credentials. Validate origin/URL consistency at startup. Production requires HTTPS and secure cookies.
- Session cookie: HttpOnly, SameSite=Lax, Path=/, no Domain attribute; Secure in production. Target name `agency.session` locally and `__Host-agency.session` in production. Configure the library cookie name consistently and preserve its signing format. Clear with identical name/path/domain policy.
- Session and authentication responses have `Cache-Control: no-store`, including failures. Native token fields are not a custom bearer API, and no authorization decision uses cookie presence or browser hook state alone.
- Server-rendered frontend GET session requests forward only the needed auth cookie to the configured backend, not arbitrary incoming headers. They do not mutate cookies. Test both browser proxy Set-Cookie forwarding and server Cookie forwarding with real HTTP.
- For the initial single backend process, throttle login before password verification: at most 5 attempts per normalized email in 15 minutes, plus a service-wide ceiling of 100 attempts per minute. Include successful attempts; do not reset the account bucket after success. Return a native-compatible generic 429 with Retry-After seconds. Implement account checks in library hooks after native parsing; do not place `express.json()` before the handler. Bound and expire limiter keys; reject excess new keys at capacity rather than evict active limits. These are account/service limits, not end-user IP limits behind the proxy. Multi-process deployment requires shared limits before scaling; memory limits reset on restart.

### Trusted operator lifecycle

- Proposed script interface: `bun run staff -- bootstrap-admin`, `create`, `reset-password`, `deactivate`. This command runs only on the trusted backend host with database/configuration access; it is not a public API or a browser Admin feature.
- `bootstrap-admin` prompts for name/email/password and creates an Admin only when no Admin exists; refuse reruns and duplicate email. `create` prompts for name/email/role/password and supports all three exact roles. Password entry and confirmation are masked; secrets must not appear in arguments, output or logs.
- `reset-password` targets a normalized email, prompts for a new password and revokes all sessions for that user. `deactivate` disables the target and revokes all sessions. Refuse deactivation of the last active Admin. Unknown users fail without fabricating success. No role-change command or staff HTTP management in this slice.
- Password reset is also a barrier for in-flight old-credential logins: a request that verified the old hash before reset must not establish a usable session after reset completes. Coordinate credential/session issuance with reset using a database-backed generation or equivalent atomic strategy, and validate that generation on all authoritative session reads. A process-only mutex cannot protect the separate operator command. Add a controlled concurrency regression that pauses real credential verification across reset.
- Commands use the library-supported credential APIs where available, with no temporary enabling of public signup and no direct plaintext credential storage. Verify migration/command compatibility before documenting the commands as available.

## Acceptance criteria

- [x] Real SQLite migration and library adapter round-trip work with installed Prisma/runtime versions.
- [x] Operator can bootstrap once, provision every role, reset a password and deactivate staff; passwords never appear in CLI arguments/output or logs.
- [x] Public signup, administration/impersonation and unknown auth routes are unavailable; body role injection is rejected.
- [x] Better Auth React client signs in and out against the native Express handler through the actual proxy; native session/null/error semantics are preserved.
- [x] Correct active credentials issue the required cookie; unknown/wrong/disabled credentials share the same generic failure response.
- [x] Session lookup and guards use current database state and reject missing/tampered/revoked/expired sessions; hashes remain private and application code does not log or persist native token fields.
- [x] Fixed eight-hour expiry, current-session logout, all-session reset/deactivation revocation and last-active-Admin protection are verified.
- [x] Role helper denies unknown/unauthorized roles; each provisioned role can enter the CRM shell. No business permissions are implicitly granted.
- [x] Mutation origin checks, JSON validation, throttling, Retry-After, cache headers and production cookie settings are verified.
- [x] Native handler is mounted before body parsing with the exact route allowlist; frontend proxy/server rendering preserve cookies and authorization, and health/media remain public and unchanged.
- [x] Migration, provisioning and all database integration tests use SQLite only; no PostgreSQL artifacts are introduced.
- [x] Quality checks and real cross-repository smoke tests pass; API contract and operational docs describe delivered behavior.

## Validation

- The isolated browser fixture provisions the three role identities and a separate `e2e-transition@example.com` Agent for the held-request/navigation regression. This prevents shared test identities from exhausting real per-account login limits; application account policy and public endpoints are unchanged.
- Backend tests: temporary real SQLite with isolated migrations, all roles, credential hashing, duplicate/normalized email, disabled user, rejected privilege fields, native malformed-JSON errors, generic credential errors, origin/content-type failures and denied hidden library routes. Test middleware ordering with the real handler, plus fixed rememberMe policy, native 200 null session and native logout success responses.
- Controlled clock tests: eight-hour absolute expiry, expired limiter windows and bounded limiter state. Test sign-out with a missing session and wrong origin, cookie tampering, password reset/deactivation revocation and backend restart with persisted sessions.
- Authorization tests use the real guard in a test-only restricted route; do not add a production endpoint merely to test Admin permissions.
- Integration/browser checks: direct API calls cannot bypass guards; real proxy login sets host cookie, server CRM validation forwards it, logout prevents reuse, backend outage renders a recoverable error rather than a redirect loop.
- Verification completed: `bun run check` passed (34 tests across 11 files), `bun run db:migrate` applied the additive credential-version migration to a real SQLite database, `bun run db:check` verified SQLite and the auth tables, and the frontend's real browser suite passed 26 desktop/mobile tests. Six live browser lifecycle checks passed for deleted, expired and disabled sessions, password reset, current role changes, and backend outage/recovery.

## Risks and rollout

- The approved staff-only, fixed-session and operator-recovery defaults are implemented. Business-resource permissions remain explicitly deferred.
- Library/SQLite adapter compatibility and operator commands passed the implementation gate. Revalidate these integrations when upgrading pinned dependencies; do not weaken sessions or expose extra library endpoints.
- Back up an existing database before applying the additive auth migration; apply migrations, configure secret/origin, bootstrap Admin and verify login before exposing the protected CRM. Keep the database out of Git.
- Rollback: stop staff access, restore a known-good application/database backup as required, revoke sessions and rotate the secret if compromised. Never reopen the old publicly accessible CRM as an auth rollback.
- Failed login/session logs contain correlation IDs and safe categories only. Email reset/MFA and distributed throttling are future requirements to reassess before production needs expand.

## Implementation evidence

- Better Auth 1.7.12 and better-call 1.4.4 are installed. The Prisma SQLite schema includes User, Session, Account and Verification models plus server-owned credential versions; the second migration is additive.
- The exact native auth allowlist, 100 KiB pre-parse body bound, origin/content-type checks, throttling, secure cookie settings, current-state session checks and password-reset generation barrier are covered by backend tests.
- `bun run staff -- bootstrap-admin|create|reset-password|deactivate` is the trusted operator interface. It uses masked prompts and has no HTTP counterpart.

## Documentation sources

- [Better Auth Express integration](https://www.better-auth.com/docs/integrations/express), [server API](https://www.better-auth.com/docs/concepts/api), [session management](https://www.better-auth.com/docs/concepts/session-management), [Admin plugin](https://www.better-auth.com/docs/plugins/admin).
- Queried through Context7 on 2026-10-22. Recheck exact selected package APIs during implementation.
