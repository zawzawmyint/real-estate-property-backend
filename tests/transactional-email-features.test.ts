import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, expect, it } from 'vitest';
import { leadFixture } from './lead-fixture.js';
import { readProducerConfig } from '../src/modules/email/email.config.js';
import { createEmailCrypto } from '../src/modules/email/email.crypto.js';
import { createEmailRepository } from '../src/modules/email/email.repository.js';
import { createEmailConsumer } from '../src/modules/email/email.consumer.js';
import { createTaskEmailReminderScanner } from '../src/modules/tasks/tasks.emails.js';

const f = await leadFixture({ transactionalEmails: true });
afterAll(() => f.close());
const config = readProducerConfig(f.env)!;
const crypto = createEmailCrypto(config);
const rows = (leadId: string) =>
  f.database.emailNotification.findMany({ where: { leadId } });

function viewingWrite(method: 'post' | 'patch', path = '', role = 'agent') {
  const client = request(f.app);
  return client[method](`/api/v1/staff/viewings${path}`)
    .set('Origin', f.env.APP_ORIGIN)
    .set('Cookie', f.cookies[role]!);
}

it('records repeatable assignment events once and suppresses obsolete ownership even after returning', async () => {
  const lead = await f.create();
  const assign = (version: number, agent: string) =>
    f
      .write('patch', `/${lead.id}/assignment`)
      .send({ expectedVersion: version, assignedAgentId: f.ids[agent] });
  expect((await assign(1, 'agent')).status).toBe(200);
  expect((await assign(2, 'agent')).status).toBe(200);
  expect((await assign(2, 'other')).status).toBe(200);
  expect((await assign(3, 'agent')).status).toBe(200);
  const emails = await rows(lead.id);
  expect(emails.map((row) => row.kind)).toEqual([
    'LEAD_ASSIGNED',
    'LEAD_ASSIGNED',
    'LEAD_ASSIGNED',
  ]);
  expect(emails.filter((row) => row.status === 'PENDING')).toHaveLength(1);
  expect(emails.filter((row) => row.status === 'SUPPRESSED')).toHaveLength(2);
  expect(
    crypto.open(emails.find((row) => row.status === 'PENDING')!),
  ).toMatchObject({ to: 'agent@lead-fixture.test' });
});

it('records one acknowledgement and staff emails for a fresh enquiry, independently of receipt replay', async () => {
  const submissionId = randomUUID();
  const body = {
    submissionId,
    name: 'Visitor',
    email: 'visitor@example.test',
    purpose: 'sale',
    message: 'Private visitor text',
  };
  const submit = () =>
    request(f.app)
      .post('/api/v1/public/inquiries')
      .set('Origin', f.env.APP_ORIGIN)
      .send(body);
  expect((await submit()).status).toBe(201);
  expect((await submit()).status).toBe(200);
  const receipt = await f.database.leadSubmissionReceipt.findUniqueOrThrow({
    where: { id: submissionId },
  });
  const emails = await rows(receipt.leadId);
  expect(
    emails.filter((row) => row.kind === 'WEBSITE_ENQUIRY_RECEIVED'),
  ).toHaveLength(1);
  expect(
    emails.filter((row) => row.kind === 'STAFF_WEBSITE_ENQUIRY_RECEIVED'),
  ).toHaveLength(2);
  expect(JSON.stringify(emails)).not.toContain(body.message);
});

it('books durable customer reminders and replaces stale viewing work on reschedule/cancel', async () => {
  const lead = await f.create({}, 'agent');
  const property = await f.database.property.create({
    data: {
      title: 'Visit property',
      purpose: 'sale',
      publishingState: 'published',
      availability: 'available',
    },
  });
  const startsAt = new Date(Date.now() + 3 * 86400000).toISOString();
  const endsAt = new Date(Date.parse(startsAt) + 3600000).toISOString();
  const body = {
    submissionId: randomUUID(),
    leadId: lead.id,
    propertyId: property.id,
    expectedLeadVersion: 1,
    startsAt,
    endsAt,
  };
  const write = (method: 'post' | 'patch', path = '') =>
    viewingWrite(method, path, 'manager');
  const created = await write('post').send(body);
  expect(created.status).toBe(201);
  expect((await write('post').send(body)).status).toBe(200);
  let emails = await rows(lead.id);
  expect(emails).toHaveLength(2);
  expect(JSON.stringify(emails)).not.toContain('contact@example.test');
  const reminder = emails.find(
    (row) => row.kind === 'CUSTOMER_VIEWING_REMINDER',
  )!;
  expect(reminder.nextAttemptAt.getTime()).toBe(
    Date.parse(startsAt) - 86400000,
  );
  expect(reminder.expiresAt?.getTime()).toBe(Date.parse(startsAt));
  const nextStartsAt = new Date(Date.parse(startsAt) + 86400000).toISOString();
  const nextEndsAt = new Date(Date.parse(endsAt) + 86400000).toISOString();
  const edited = await write('patch', `/${created.body.id}`).send({
    expectedVersion: 1,
    expectedLeadVersion: 1,
    startsAt: nextStartsAt,
    endsAt: nextEndsAt,
  });
  expect(edited.status).toBe(200);
  emails = await rows(lead.id);
  expect(emails.filter((row) => row.status === 'SUPPRESSED')).toHaveLength(2);
  expect(
    emails
      .filter((row) => row.status === 'SUPPRESSED')
      .every((row) => row.lastErrorCode === 'EMAIL_VIEWING_CHANGED'),
  ).toBe(true);
  expect(
    emails.filter((row) => row.status === 'PENDING').map((row) => row.kind),
  ).toEqual(
    expect.arrayContaining([
      'CUSTOMER_VIEWING_RESCHEDULED',
      'CUSTOMER_VIEWING_REMINDER',
      'STAFF_VIEWING_RESCHEDULED',
    ]),
  );
  expect(
    (
      await write('patch', `/${created.body.id}/status`).send({
        expectedVersion: 2,
        status: 'cancelled',
      })
    ).status,
  ).toBe(200);
  emails = await rows(lead.id);
  expect(
    emails
      .filter((row) => row.status === 'PENDING')
      .map((row) => row.kind)
      .sort(),
  ).toEqual(['CUSTOMER_VIEWING_CANCELLED', 'STAFF_VIEWING_CANCELLED']);
  expect(
    emails
      .filter((row) => row.status === 'SUPPRESSED')
      .every((row) => row.lastErrorCode === 'EMAIL_VIEWING_CHANGED'),
  ).toBe(true);
});

it('preserves reminders on no-op saves and dispatches them only when due after a worker restart', async () => {
  const lead = await f.create({}, 'agent');
  const property = await f.database.property.create({
    data: {
      title: 'Reminder visit',
      purpose: 'sale',
      publishingState: 'published',
      availability: 'available',
    },
  });
  const startsAt = new Date(Date.now() + 3 * 86400000).toISOString();
  const endsAt = new Date(Date.parse(startsAt) + 3600000).toISOString();
  const write = viewingWrite;
  const created = await write('post').send({
    submissionId: randomUUID(),
    leadId: lead.id,
    propertyId: property.id,
    expectedLeadVersion: 1,
    startsAt,
    endsAt,
  });
  expect(created.status).toBe(201);
  expect(
    (
      await write('patch', `/${created.body.id}`).send({
        expectedVersion: 1,
        expectedLeadVersion: 1,
        startsAt,
        endsAt,
      })
    ).status,
  ).toBe(200);
  const emails = await rows(lead.id);
  expect(emails).toHaveLength(2);
  expect(emails.every((row) => row.status === 'PENDING')).toBe(true);
  const reminder = emails.find(
    (row) => row.kind === 'CUSTOMER_VIEWING_REMINDER',
  )!;
  const repo = createEmailRepository(f.database, crypto, config);
  let now = reminder.nextAttemptAt.getTime() - 1;
  let sent = 0;
  const consume = () =>
    createEmailConsumer({
      repository: createEmailRepository(f.database, crypto, config),
      clock: () => now,
      sender: {
        async send() {
          sent++;
          return { messageId: 'captured-reminder' };
        },
        close() {},
        activeCount: () => 0,
      },
    });
  await consume()(reminder.id);
  expect(sent).toBe(0);
  now++;
  expect(
    (await repo.due(now, Object.keys(config.keys))).map((row) => row.id),
  ).toContain(reminder.id);
  await consume()(reminder.id);
  await consume()(reminder.id);
  expect(sent).toBe(1);
  expect((await repo.get(reminder.id))?.status).toBe('SUBMITTED');
});

it('treats returning to an earlier viewing slot as a fresh occurrence and suppresses completion work', async () => {
  const lead = await f.create({}, 'agent');
  const property = await f.database.property.create({
    data: {
      title: 'Return slot',
      purpose: 'sale',
      publishingState: 'published',
      availability: 'available',
    },
  });
  const firstStart = Date.now() + 3 * 86400000;
  const write = viewingWrite;
  const times = (start: number) => ({
    startsAt: new Date(start).toISOString(),
    endsAt: new Date(start + 3600000).toISOString(),
  });
  const created = await write('post').send({
    submissionId: randomUUID(),
    leadId: lead.id,
    propertyId: property.id,
    expectedLeadVersion: 1,
    ...times(firstStart),
  });
  expect(created.status).toBe(201);
  for (const [version, start] of [
    [1, firstStart + 86400000],
    [2, firstStart],
  ] as const)
    expect(
      (
        await write('patch', `/${created.body.id}`).send({
          expectedVersion: version,
          expectedLeadVersion: 1,
          ...times(start),
        })
      ).status,
    ).toBe(200);
  const reminders = (await rows(lead.id)).filter(
    (row) => row.kind === 'CUSTOMER_VIEWING_REMINDER',
  );
  expect(reminders).toHaveLength(3);
  expect(reminders.filter((row) => row.status === 'PENDING')).toHaveLength(1);
  await f.database.viewing.update({
    where: { id: created.body.id },
    data: {
      startsAt: new Date(Date.now() - 60000),
      endsAt: new Date(Date.now() + 3600000),
    },
  });
  expect(
    (
      await write('patch', `/${created.body.id}/status`).send({
        expectedVersion: 3,
        status: 'completed',
        feedback: 'Private feedback',
      })
    ).status,
  ).toBe(200);
  expect(
    (await rows(lead.id)).every(
      (row) =>
        row.status === 'SUPPRESSED' &&
        row.lastErrorCode === 'EMAIL_VIEWING_CHANGED',
    ),
  ).toBe(true);
});

it('skips short-notice customer reminders and phone-only customer emails', async () => {
  const property = await f.database.property.create({
    data: {
      title: 'Soon',
      purpose: 'sale',
      publishingState: 'published',
      availability: 'available',
    },
  });
  for (const phoneOnly of [false, true]) {
    const lead = await f.create(
      phoneOnly ? { email: null, phone: '+971501112233' } : {},
      'agent',
    );
    const startsAt = new Date(Date.now() + 3600000).toISOString();
    const result = await request(f.app)
      .post('/api/v1/staff/viewings')
      .set('Origin', f.env.APP_ORIGIN)
      .set('Cookie', f.cookies.agent!)
      .send({
        submissionId: randomUUID(),
        leadId: lead.id,
        propertyId: property.id,
        expectedLeadVersion: 1,
        startsAt,
        endsAt: new Date(Date.parse(startsAt) + 3600000).toISOString(),
      });
    expect(result.status).toBe(201);
    expect((await rows(lead.id)).map((row) => row.kind)).toEqual(
      phoneOnly ? [] : ['CUSTOMER_VIEWING_CONFIRMED'],
    );
  }
});

it('rolls back assignment when email intent cannot be recorded', async () => {
  const lead = await f.create();
  await f.database.$executeRawUnsafe(
    "CREATE TRIGGER reject_email BEFORE INSERT ON EmailNotification BEGIN SELECT RAISE(ABORT, 'test email failure'); END",
  );
  try {
    expect(
      (
        await f
          .write('patch', `/${lead.id}/assignment`)
          .send({ expectedVersion: 1, assignedAgentId: f.ids.agent })
      ).status,
    ).toBe(500);
    expect((await f.read(`/${lead.id}`)).body).toMatchObject({
      version: 1,
      assignedAgent: null,
    });
    expect(await rows(lead.id)).toHaveLength(0);
  } finally {
    await f.database.$executeRawUnsafe('DROP TRIGGER reject_email');
  }
});

it('creates task email despite an existing inbox item and progresses beyond a recorded batch', async () => {
  const lead = await f.create({}, 'agent');
  const dueAt = new Date(Date.now() + 10 * 60000);
  const tasks = Array.from({ length: 105 }, (_, index) => ({
    id: randomUUID(),
    submissionId: randomUUID(),
    actorScope: f.ids.agent!,
    payloadHash: 'test',
    leadId: lead.id,
    title: `Task ${index}`,
    dueAt,
  }));
  await f.database.task.createMany({ data: tasks });
  await f.database.notification.create({
    data: {
      recipientId: f.ids.agent!,
      type: 'task_due_soon',
      createdAt: new Date(),
      leadId: lead.id,
      taskId: tasks[0]!.id,
      occurrenceKey: `task_due_soon:${tasks[0]!.id}:${dueAt.toISOString()}`,
    },
  });
  const scan = createTaskEmailReminderScanner(f.database, config);
  await scan();
  await scan();
  await scan();
  expect(
    (await rows(lead.id)).filter((row) => row.kind === 'TASK_DUE_SOON'),
  ).toHaveLength(105);
  await scan();
  expect(
    (await rows(lead.id)).filter((row) => row.kind === 'TASK_DUE_SOON'),
  ).toHaveLength(105);
  await f.database.task.updateMany({
    where: { leadId: lead.id },
    data: { status: 'completed' },
  });
});

it('records a current task reminder when ownership returns to an earlier agent', async () => {
  const lead = await f.create({}, 'agent');
  await f.database.task.create({
    data: {
      submissionId: randomUUID(),
      actorScope: f.ids.agent!,
      payloadHash: 'test',
      leadId: lead.id,
      title: 'Returned lead task',
      dueAt: new Date(Date.now() + 10 * 60000),
    },
  });
  const scan = createTaskEmailReminderScanner(f.database, config);
  await scan();
  for (const [version, role] of [
    [1, 'other'],
    [2, 'agent'],
  ] as const)
    expect(
      (
        await f
          .write('patch', `/${lead.id}/assignment`)
          .send({ expectedVersion: version, assignedAgentId: f.ids[role] })
      ).status,
    ).toBe(200);
  await scan();
  const reminders = (await rows(lead.id)).filter(
    (row) => row.kind === 'TASK_DUE_SOON',
  );
  expect(reminders).toHaveLength(2);
  expect(reminders.map((row) => row.status).sort()).toEqual([
    'PENDING',
    'SUPPRESSED',
  ]);
  await scan();
  expect(
    (await rows(lead.id)).filter((row) => row.kind === 'TASK_DUE_SOON'),
  ).toHaveLength(2);
});

it('permanently suppresses customer snapshots when contact email changes away and back', async () => {
  const lead = await f.create({}, 'agent');
  const property = await f.database.property.create({
    data: {
      title: 'Contact change',
      purpose: 'sale',
      publishingState: 'published',
      availability: 'available',
    },
  });
  const startsAt = new Date(Date.now() + 3 * 86400000).toISOString();
  const created = await viewingWrite('post').send({
    submissionId: randomUUID(),
    leadId: lead.id,
    propertyId: property.id,
    expectedLeadVersion: 1,
    startsAt,
    endsAt: new Date(Date.parse(startsAt) + 3600000).toISOString(),
  });
  expect(created.status).toBe(201);
  for (const [version, email] of [
    [1, 'replacement@example.test'],
    [2, 'contact@example.test'],
  ] as const)
    expect(
      (
        await f
          .write('patch', `/${lead.id}`)
          .send({ expectedVersion: version, email })
      ).status,
    ).toBe(200);
  const emails = await rows(lead.id);
  expect(emails).toHaveLength(2);
  expect(emails.every((row) => row.status === 'SUPPRESSED')).toBe(true);
});
