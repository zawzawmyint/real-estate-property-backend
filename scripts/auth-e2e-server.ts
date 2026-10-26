// Standalone fixture process: temporary SQLite, no production accounts or HTTP backdoors.
import { authFixture } from '../tests/auth-fixture.js';
import { writeFile } from 'node:fs/promises';
import { LocalStorage } from '../src/infrastructure/storage/local-storage.js';
import { seedDemoProperties } from '../src/modules/properties/demo-seed.js';

const password = process.env.STAFF_E2E_PASSWORD;

if (!password || password.length < 12 || password.length > 128)
  throw new Error('STAFF_E2E_PASSWORD must be 12-128 characters');

const fixture = await authFixture();

if (process.env.STAFF_E2E_SEED_PROPERTIES !== '0')
  await seedDemoProperties(
    fixture.database,
    new LocalStorage(fixture.env.STORAGE_ROOT, fixture.env.PUBLIC_ORIGIN),
  );
if (process.env.STAFF_E2E_STATE_FILE)
  await writeFile(
    process.env.STAFF_E2E_STATE_FILE,
    JSON.stringify({ databaseUrl: fixture.env.DATABASE_URL, pid: process.pid }),
    { mode: 0o600 },
  );

for (const role of ['admin', 'manager', 'agent'] as const)
  await fixture.operator.create({
    name: `E2E ${role}`,
    email: `e2e-${role}@example.com`,
    password,
    role,
  });
// Property browser workers reuse their own role sessions, leaving authentication
// test accounts and the real sign-in limiter independent of workflow coverage.
for (const project of ['desktop', 'mobile'])
  for (const role of ['admin', 'manager', 'agent'] as const)
    await fixture.operator.create({
      name: `Property E2E ${project} ${role}`,
      email: `e2e-property-${project}-${role}@example.com`,
      password,
      role,
    });

await fixture.operator.create({
  name: 'E2E transition Agent',
  email: 'e2e-transition@example.com',
  password,
  role: 'agent',
});

// Navigation checks have a separate per-account sign-in budget from auth tests.
for (const project of ['desktop', 'mobile'])
  await fixture.operator.create({
    name: `Navigation E2E ${project}`,
    email: `e2e-navigation-${project}@example.com`,
    password,
    role: 'manager',
  });

const port = Number(process.env.PORT ?? 4311);
const server = fixture.app.listen(port, '127.0.0.1', () =>
  console.info('AUTH_E2E_READY'),
);

server.on('error', async () => {
  await fixture.close();
  process.exitCode = 1;
});

let stopping = false;

function stop() {
  if (stopping) return;

  stopping = true;
  server.close(async () => {
    await fixture.close();
  });
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);
