# Staff authentication API contract

Status: Implemented and verified on 2026-10-22. Backend-owned Better Auth 1.7.12 native protocol contract. Frontend snapshot: `docs/contracts/staff-authentication.md`. Change this source first and synchronize the snapshot. OpenAPI documents this supported native subset and the foundation routes.

## Native client/server boundary

- Next.js browser code uses `createAuthClient` from `better-auth/react`, with same-origin `basePath: /api/v1/auth`. Express alone runs the Better Auth server using its Prisma adapter with SQLite. Better Auth 1.7.12 is pinned independently in both repositories.
- Use `authClient.signIn.email()`, `authClient.signOut()` and `authClient.useSession()`/`getSession()` with standard endpoint names, status codes and native response shapes. No custom authentication response wrapper or generic OpenAPI auth client is introduced.
- Mount the native handler through Better Auth's vendor Node/Web Request adapter before Express JSON parsing. An exact method/path allowlist exposes only the three operations below. Signup is also disabled in Better Auth configuration. No browser administration, impersonation, credential management or raw extra library endpoints are exposed.
- Preserve native protocol fields and errors; verify them against the selected stable version using real client-to-handler tests. Auth errors use the native `{code,message}` style, not the project's nested error envelope. Native optional response fields are allowed; do not hard-code an exact bespoke DTO that breaks client compatibility.
- Add `Cache-Control: no-store` and `X-Request-Id` to successful, anonymous and failed auth responses. Preserve Set-Cookie headers individually. Edge/network outages may yield non-JSON 5xx; clients must distinguish those from absent sessions or incorrect credentials.

## POST /api/v1/auth/sign-in/email

- Browser caller: `authClient.signIn.email({email,password,rememberMe:true})`. The fixed true value retains the configured eight-hour database/cookie expiry; there is no remember-me UI. Do not request the library's alternative nonpersistent-session lifetime.
- Email is normalized by trim/lowercase with provisioning/login parity, valid syntax and maximum 254 characters. Password remains unmodified, nonempty and at most 128 characters. Provisioning uses the 12–128-character policy. No browser role, user ID, privilege input or arbitrary callback URL is accepted; fixed navigation to `/crm` is handled by the frontend.
- Native 200 success contains the library's user/token and redirect metadata as defined by the pinned version, plus session Set-Cookie header(s). Do not convert it into `{user,session:{expiresAt}}` or strip required native fields. Database expiry is exactly 28,800 seconds after issue; sliding renewal is disabled.
- Unknown email, wrong password and disabled account share a generic native-compatible credential failure, normally 401. Verify/configure a shared code/status/message for the selected version without exposing disabled-state reasons. No valid session is issued on failure.
- Use native-compatible 400 validation errors, 403 origin errors, 415 unsupported media errors and 429 throttling with Retry-After seconds. Unexpected failure is a safe non-2xx native error with correlation headers. Do not expose database errors or stack traces.

## GET /api/v1/auth/get-session

- Browser caller: `authClient.useSession()` or `authClient.getSession()`. Server rendering uses a bounded no-store GET to the private Express origin, forwarding only required auth cookies. Native server-side checks use `auth.api.getSession` as appropriate. No second auth server is created in Next.js.
- Native 200 authenticated result has standard `{user,session}` data. `user` includes the server-owned role; session includes native metadata, such as expiry and token fields, defined by the selected version. Current database role/disabled status is authoritative and cookie caching is disabled.
- Native 200 `null` is the successful unauthenticated result for an absent, tampered, expired or revoked cookie, or disabled/deleted staff. The React client must treat that as anonymous without considering it a network failure.
- A store outage, timeout, invalid JSON/schema or non-2xx native response is a service/error state. Do not convert it to successful `null` or redirect repeatedly between login and CRM.
- Session lookup is read-only, without sliding renewal or a Set-Cookie dependency. Server-rendered view data is narrowed to `{id,name,email,role,expiresAt}` before being passed to UI components; do not spread the native session response into page props.

## POST /api/v1/auth/sign-out

- Browser caller: `authClient.signOut()`, using the native JSON request. Accept an empty native body/object as emitted by the selected client; do not impose a custom 204 protocol.
- Native 200 `{success:true}` revokes the current session and expires its cookie. Missing/expired sessions also succeed idempotently. Other devices' sessions remain valid unless an operator resets credentials or disables the user.
- Frontend navigates to `/login` only on confirmed client success, clears/refetches client session state through supported library behavior, and refreshes router state. Failure offers retry and does not claim logout succeeded.

## Origin, validation and session security

- POST operations require Origin exactly matching `APP_ORIGIN`. Sign-in and nonempty bodies require JSON; accept an empty sign-out request with the headers emitted by the native client, rather than demanding a fabricated body/content-type. Absent/null/untrusted origins are rejected before mutations, including sign-out without a session. Keep library CSRF checks enabled. GET server lookups can omit Origin.
- Implement credential normalization, fixed rememberMe policy, privilege-field rejection and account throttling in library validation/hooks. The boundary reads the raw stream once only to enforce the 100 KiB limit, then supplies the equivalent Web Request to the native handler. Preserve native request processing; do not parse and reconstruct auth responses as a custom API.
- Bound the native auth request stream to 100 KiB (102,400 bytes) before JSON parsing, including chunked bodies. Oversized declared or streamed bodies receive a native-compatible 413 with no-store/correlation headers. A bounded vendor Node/Web Request adapter may be used to retain the native Better Auth handler without bypassing the size limit.
- Cookie is HttpOnly, SameSite=Lax, Path=/, host-only; production is Secure with `__Host-agency.session`, local HTTP uses `agency.session`. Keep library signing. Browser API calls remain same-origin through the Next.js proxy; no credential CORS or exposed backend origin is required.
- Native responses may contain token fields. The application must not log, render, copy to localStorage/sessionStorage, add to URLs or use them as bearer credentials. Do not enable the bearer plugin. Credential hashes are never returned. Avoid forwarding raw sessions into server-rendered client props.
- Per-account and service-wide login throttling follow the backend spec, with native-compatible 429 responses and Retry-After. Library request parsing/validation failures do not adopt business endpoint error envelopes.

## Protected business API boundary

The project's non-auth resources retain `{error:{code,message,requestId}}`, with 401 `UNAUTHENTICATED` and 403 `FORBIDDEN` as appropriate. Their guards validate current database sessions/roles independently of frontend state. Auth's native 200 `null` semantics do not change private business API authorization responses. Test guards with test-only routes rather than inventing production business endpoints.

## Persistence and scope

Only SQLite schema, migrations and integration tests are in scope. No PostgreSQL driver/provider/configuration, portability infrastructure, migration SQL or tests are required. PostgreSQL remains a separately scoped future migration option.

Password reset atomically replaces credentials, increments the server-owned User credentialVersion and revokes sessions. Sessions carry the version captured before credential verification; authoritative reads reject mismatches, so an in-flight old-password login cannot establish usable access after reset. These version fields do not change the native browser API or allow browser-controlled privileges.

## Verification evidence

- Backend `bun run check` passed with 34 tests across 11 files. A real SQLite `bun run db:migrate` applied both auth migrations and `bun run db:check` verified all auth tables.
- Cross-repository Playwright coverage passed 26 desktop/mobile tests using real Express and SQLite. Six live browser lifecycle checks covered deleted, expired and disabled sessions, password reset, current role change, and backend outage/recovery.
- Production cookie attributes are covered by backend HTTP integration tests. Production browser deployment remains unverified until a coordinated HTTPS frontend and backend deployment is available.
