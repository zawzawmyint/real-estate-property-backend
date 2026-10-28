# Development

## Setup and configuration

Follow README installation steps from the backend working directory. `.env.example` documents every supported variable. Copy it to `.env`, replace `BETTER_AUTH_SECRET` and `INQUIRY_RELAY_SECRET` with independently generated random values of at least 32 characters each, then run `bun run db:generate`, `bun run db:migrate` and `bun run db:check`. Runtime scripts use Node's environment-file loader.

- `NODE_ENV`: development, test or production.
- `HOST`: defaults to loopback `127.0.0.1`; set appropriately for a container deployment.
- `PORT`: integer 1–65535, default 4311.
- `LOG_LEVEL`: Pino level or silent.
- `DATABASE_URL`: SQLite `file:` URL; relative paths resolve from backend working directory.
- `STORAGE_ROOT`: disk directory, default `./var/uploads`.
- `PUBLIC_ORIGIN`: absolute HTTP(S) backend origin, default `http://localhost:4311`, no path or credentials. This controls public image URLs, not API authorization.
- `APP_ORIGIN`: exact frontend origin permitted to make native auth POST requests; default `http://localhost:3100`.
- `BETTER_AUTH_URL`: exact public auth base URL, `${APP_ORIGIN}/api/v1/auth`.
- `BETTER_AUTH_SECRET`: server-only random secret, at least 32 characters; never commit it.
- `INQUIRY_RELAY_SECRET`: server-only random secret, at least 32 characters and independent of the auth secret. It must exactly match the trusted frontend relay configuration; never commit it.
- Public inquiry identity is accepted only from the relay or direct loopback development fallback. The backend verifies the signed relay header and socket identity; it does not trust arbitrary `X-Forwarded-For` values.

No Redis, queue, email or S3 integration is installed. The inquiry limiter is in-process: five attempts per identity in 15 minutes, capped at 10,000 live identities; restart resets it and a multi-instance deployment requires a shared limiter decision. Staff auth, property/photo and lead models are implemented. Environment validation names invalid fields without printing input values.

## Database maintenance and browser fixtures

For an existing database, migrations require a maintenance window: stop the backend and all operator writes, back up SQLite (including any WAL files) and its matching media, then deploy the updated source and run `bun run db:generate`, `bun run db:migrate`, and `bun run db:check` before restarting. The migration command also backfills NFC/lowercase property, lead and staff search fields in bounded batches without changing business timestamps; running `prisma migrate deploy` alone does not complete this data migration. Keep writes stopped until the updated application starts. The backfill is idempotent, so a failed run can be retried while offline. Restore the compatible database/media/application backup together if rolling back. This is a single-process offline migration, not a rolling-deployment procedure.

The disposable browser fixture includes fictional featured demo listings by default so public photo tests do not depend on other tests. Set `STAFF_E2E_SEED_PROPERTIES=0` only for targeted suites that do not require public property media. Ordinary application startup never seeds data.

## Feature development

1. Create `specs/<feature-name>/spec.md` before code changes.
2. Agree observable behavior, data exposure, permissions, errors and exclusions.
3. Implement a small working slice under `src/modules/<feature>/`: routes attach middleware, controllers handle HTTP, services enforce business/resource permissions and coordinate transactions, and repositories contain Prisma queries. Pass transaction clients explicitly when required. Keep Better Auth native and do not create empty business modules to demonstrate the convention.
4. Add meaningful boundary tests and update the OpenAPI contract.
5. Verify acceptance criteria and reconcile documentation before marking implemented.

## Verification

Run `bun run check`, then `bun run db:generate`, `bun run db:migrate` and `bun run db:check` against the intended SQLite URL. CI performs a frozen install followed by code checks on Node 24.14.1. Tests use real Express requests and disposable filesystem directories/databases. Avoid reusing production files in tests. Check SQLite and storage remain ignored with `git status`.

For the frontend browser suite, do not start a manually provisioned database on port 4311. Run `bun run db:generate`, set a temporary 12–128 character `STAFF_E2E_PASSWORD` with PowerShell `Read-Host -MaskInput`, then start `bun run test:auth:e2e-server`. The fixture creates a disposable SQLite database, applies migrations and provisions Admin, Manager, Agent, a dedicated transition-test Agent, and separate desktop/mobile navigation Manager accounts; Ctrl+C removes it. Set the same temporary password and `API_URL=http://127.0.0.1:4311` in the frontend test terminal before `bun run test:e2e`. The frontend runs this suite with four workers. Do not use a production password or database for this suite.

For manual checks, start the migrated backend on 4311 and sibling frontend on 3100, bootstrap an Admin using `bun run staff -- bootstrap-admin`, then sign in at `/login` and confirm `/crm` protection. `bun run staff -- deactivate` reports assigned-lead count; redistribute through the lead workflow before or after deactivation as appropriate. Build before `bun run start`; clean builds generate the ignored Prisma client automatically. Use a coordinated HTTPS deployment to validate production `__Host-` cookie behavior; local HTTP uses the development cookie name.

## Demo data

After applying migrations to a local or demo database, run `bun run demo:seed -- --confirm-demo`. The command refuses `NODE_ENV=production`, refuses missing or unknown arguments before connecting, adds only missing deterministic demo records, and never resets or overwrites existing records. It creates 15 fictional published listings from the versioned fixture library in `fixtures/demo-properties/photos`; all stored runtime copies receive generated keys. The fixture [README](../fixtures/demo-properties/README.md) records image provenance and reuse. Demo records and images are illustrative and must remain visibly labelled in the frontend.

## Public agency catalog and portraits

The public Contact/Agents catalog is authored in [`src/modules/agency/agency.catalog.ts`](../src/modules/agency/agency.catalog.ts), not in a live CMS or Better Auth. Edit only approved public fields and each profile's `published` flag; the catalog has no automatic synchronization with staff accounts. Direct phone, email, address and map values stay `null`, and office hours stay an empty array, until approved for public use. The shipped catalog is fictional demo content (`isDemo: true`), so the public pages remain noindex.

Deploy catalog changes together with matching frontend portraits at `frontend/public/images/agents/`. Every referenced portrait must be a local 800×1000 WebP file, and its provenance must be recorded in the frontend directory's `README.md`. Coordinate the two repository deployments so a published catalog path never points to a missing asset. Before real-business publication, obtain approved agency contact details, profile/portrait approval and inquiry usage wording, set the relevant demo flags correctly, and verify the catalog/asset pair. See the [public contact and agent feature specification](../specs/public-contact-and-agents/spec.md) and [contract](../specs/public-contact-and-agents/contract.md).

## Media reconciliation

Use this procedure only in a maintenance window after a property cleanup log reports a `storageKey` and `requestId`. It handles a successful database commit followed by a failed physical deletion. Do not delete a file while the database outcome is uncertain.

1. Stop writes, then back up the matching SQLite database and the complete `STORAGE_ROOT` directory together. Work only on copies until the final removal step.
2. Inventory database references against the same database copy. From `backend/`, use the existing Prisma factory in a read-only one-off `tsx` session or an approved SQL client to list keys: `SELECT storageKey FROM PropertyPhoto ORDER BY storageKey;`. Save this reference list with the request IDs and timestamps from the cleanup failures.
3. Enumerate only regular files directly under the copied `STORAGE_ROOT`; do not traverse symlinks or directories. Compare their literal filenames with the reference list. The dry-run orphan set is files present on disk but absent from `PropertyPhoto.storageKey`.
4. Preserve every referenced file and every unexpected entry (including directories, symbolic links, malformed names and files that cannot be inspected). Record those entries for review. Do not infer that an unexpected entry is safe to remove.
5. For each logged key, query `PropertyPhoto` again immediately before retrying. If it is referenced, retain it: a failed attachment may have committed and an unknown database outcome must keep media. If it is absent and appears in the dry-run orphan set, remove that exact literal path from the copied/in-service storage only after the operator confirms the matched backup is restorable. Database deletion always precedes physical cleanup.
6. Re-enumerate the copied storage and reference list after removal. Keep an operator log of each retained/removed key, request ID, timestamps, database query outcome and filesystem error. Escalate unresolved keys rather than broadening a deletion glob.

## Operation

The server logs safe startup failure codes, returns generic unexpected error responses and stops accepting requests on SIGINT/SIGTERM with a 10-second connection shutdown window. Windows process termination may not deliver Unix signals; exercise deployment shutdown on its actual process manager.

Use persistent storage and database backups before deployment. There is no deployment automation yet. Remove disposable development data only when intentionally resetting local work; database files and public assets are not source code or reproducible migrations.
