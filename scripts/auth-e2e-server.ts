// Standalone fixture process: temporary SQLite, no production accounts or HTTP backdoors.
import { authFixture } from '../tests/auth-fixture.js';
import { writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { LocalStorage } from '../src/infrastructure/storage/local-storage.js';
import { seedDemoProperties } from '../src/modules/properties/demo-seed.js';
import { leadSearch } from '../src/modules/leads/leads.repository.js';

const password = process.env.STAFF_E2E_PASSWORD;

process.env.INQUIRY_RELAY_SECRET ??=
  'test-only-inquiry-relay-secret-for-browser-fixtures';

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

// Lead workflows have independent identities so permissions and reassignment
// checks cannot interfere with property/authentication test accounts.
for (const project of ['desktop', 'mobile'])
  for (const identity of ['admin', 'manager', 'agent', 'other-agent'] as const)
    await fixture.operator.create({
      name: `Lead E2E ${project} ${identity}`,
      email: `e2e-lead-${project}-${identity}@example.com`,
      password,
      role: identity === 'other-agent' ? 'agent' : identity,
    });

// Pipeline tests have their own sign-in budget alongside the lead regression suite.
for (const project of ['desktop', 'mobile'])
  for (const role of ['manager', 'agent'] as const)
    await fixture.operator.create({
      name: `Pipeline E2E ${project} ${role}`,
      email: `e2e-pipeline-${project}-${role}@example.com`,
      password,
      role,
    });

// Contact journeys use a separate budget from existing lead/pipeline checks.
for (const project of ['desktop', 'mobile'])
  for (const role of ['manager', 'agent'] as const)
    await fixture.operator.create({
      name: `Contact E2E ${project} ${role}`,
      email: `e2e-contact-${project}-${role}@example.com`,
      password,
      role,
    });

// Viewing journeys do not consume existing lead/pipeline sign-in budgets.
for (const project of ['desktop', 'mobile'])
  for (const identity of ['manager', 'agent', 'other-agent'] as const)
    await fixture.operator.create({
      name: `Viewing E2E ${project} ${identity}`,
      email: `e2e-viewing-${project}-${identity}@example.com`,
      password,
      role: identity === 'manager' ? 'manager' : 'agent',
    });

// A started appointment exercises feedback without weakening booking-time rules.
const viewingProperty = await fixture.database.property.findFirst({
  where: { publishingState: 'published', availability: 'available' },
});
if (viewingProperty)
  for (const project of ['desktop', 'mobile']) {
    const agent = await fixture.database.user.findUniqueOrThrow({
      where: { email: `e2e-viewing-${project}-agent@example.com` },
    });
    const data = {
      name: `Started viewing ${project}`,
      phone: '+971 50 123 4567',
      email: null,
      propertyTitleSnapshot: null,
    };
    const lead = await fixture.database.lead.create({
      data: {
        ...data,
        ...leadSearch(data),
        purpose: 'sale',
        source: 'call',
        assignedAgentId: agent.id,
        assignedAgentNameSnapshot: agent.name,
      },
    });
    await fixture.database.viewing.create({
      data: {
        submissionId: randomUUID(),
        actorScope: agent.id,
        payloadHash: 'disposable-started-viewing-fixture',
        leadId: lead.id,
        propertyId: viewingProperty.id,
        propertyTitleSnapshot: viewingProperty.title,
        propertyLocationSnapshot: viewingProperty.city,
        startsAt: new Date(Date.now() - 3_600_000),
        endsAt: new Date(Date.now() - 1_800_000),
        createdById: agent.id,
      },
    });
  }

for (const project of ['desktop', 'mobile']) {
  const email = `e2e-lead-${project}-inactive@example.com`;
  const inactive = await fixture.operator.create({
    name: `Lead E2E ${project} inactive agent`,
    email,
    password,
    role: 'agent',
  });
  const data = {
    name: `Inactive assignment ${project}`,
    phone: '+971 50 123 4567',
    email: null,
    propertyTitleSnapshot: null,
  };

  await fixture.database.lead.create({
    data: {
      ...data,
      ...leadSearch(data),
      purpose: 'sale',
      source: 'call',
      assignedAgentId: inactive.id,
      assignedAgentNameSnapshot: inactive.name,
    },
  });
  await fixture.operator.deactivate(email);
}

// Task browser cases use isolated identities and deliberately overdue records.
// These fixtures exist only in the disposable test process, never production.
for (const project of ['desktop', 'mobile']) {
  for (const suite of ['task', 'task-recovery'])
    for (const identity of ['manager', 'agent', 'other-agent'] as const)
      await fixture.operator.create({
        name: `${suite} E2E ${project} ${identity}`,
        email: `e2e-${suite}-${project}-${identity}@example.com`,
        password,
        role: identity === 'manager' ? 'manager' : 'agent',
      });

  const agent = await fixture.database.user.findUniqueOrThrow({
    where: { email: `e2e-task-${project}-agent@example.com` },
  });

  for (const scenario of ['overdue', 'exact timestamp']) {
    const data = {
      name: `Task ${scenario} ${project}`,
      phone: '+971 50 123 4567',
      email: null,
      propertyTitleSnapshot: null,
    };
    const lead = await fixture.database.lead.create({
      data: {
        ...data,
        ...leadSearch(data),
        purpose: 'sale',
        source: 'call',
        assignedAgentId: agent.id,
        assignedAgentNameSnapshot: agent.name,
      },
    });
    const count = scenario === 'overdue' ? 23 : 1;

    for (let index = 0; index < count; index++)
      await fixture.database.task.create({
        data: {
          submissionId: randomUUID(),
          actorScope: agent.id,
          payloadHash: 'disposable-task-fixture',
          leadId: lead.id,
          title: `Follow-up ${scenario} ${project} ${String(index + 1).padStart(2, '0')}`,
          notes: 'Fictional follow-up for browser acceptance checks.',
          dueAt: new Date(Date.now() - 86_400_000 + index * 1000),
          createdById: agent.id,
        },
      });
  }
}

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
