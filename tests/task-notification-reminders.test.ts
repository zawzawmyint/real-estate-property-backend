import { randomUUID } from 'node:crypto';
import { afterAll, expect, it } from 'vitest';
import { createDatabase } from '../src/infrastructure/database/client.js';
import { serializedTransaction } from '../src/infrastructure/database/transaction.js';
import { createNotificationService } from '../src/modules/notifications/notifications.service.js';
import { scanDueTaskReminders } from '../src/modules/tasks/tasks.reminders.js';
import { taskFixture } from './task-fixture.js';

const f = await taskFixture();
afterAll(() => f.close());

const now = new Date('2037-01-01T12:00:00.000Z');
const dueAt = (minutes: number) =>
  new Date(now.getTime() + minutes * 60000).toISOString();

async function scan(database = f.database) {
  await scanDueTaskReminders(createNotificationService(database), () => now);
}

function reminders(taskId: string) {
  return f.database.notification.findMany({
    where: { taskId, type: 'task_due_soon' },
    select: { recipientId: true, retiredAt: true },
  });
}

it('records one reminder across repeated scans, a second connection and a restart', async () => {
  const inside = await f.createTask({ dueAt: dueAt(30) });
  const atDueTime = await f.createTask({ dueAt: dueAt(0) });
  const overdue = await f.createTask({ dueAt: dueAt(-1) });
  const outside = await f.createTask({ dueAt: dueAt(31) });
  const cancelled = await f.createTask({ dueAt: dueAt(20) });
  expect(
    (
      await f.taskWrite('patch', `/${cancelled.id}/status`).send({
        expectedVersion: 1,
        status: 'cancelled',
      })
    ).status,
  ).toBe(200);

  await Promise.all([scan(), scan()]);
  const second = await createDatabase(f.env.DATABASE_URL);
  try {
    await scan(second);
  } finally {
    await second.$disconnect();
  }

  for (const task of [inside, atDueTime]) {
    expect(await reminders(task.id)).toEqual([
      { recipientId: f.ids.agent, retiredAt: null },
    ]);
  }
  for (const task of [overdue, outside, cancelled]) {
    expect(await reminders(task.id)).toEqual([]);
  }
});

it('reads current ownership, status and due time after an earlier write commits', async () => {
  const lead = await f.create({}, 'agent');
  const reassigned = await f.createTask({ leadId: lead.id, dueAt: dueAt(9) });
  const cancelled = await f.createTask({ leadId: lead.id, dueAt: dueAt(9) });
  const deferred = await f.createTask({ leadId: lead.id, dueAt: dueAt(9) });

  const edit = serializedTransaction(f.database, async (tx) => {
    await tx.lead.update({
      where: { id: lead.id },
      data: { assignedAgentId: f.ids.other! },
    });
    await tx.task.update({
      where: { id: cancelled.id },
      data: { status: 'cancelled' },
    });
    await tx.task.update({
      where: { id: deferred.id },
      data: { dueAt: dueAt(60) },
    });
  });
  await Promise.all([edit, scan()]);

  expect(await reminders(reassigned.id)).toEqual([
    { recipientId: f.ids.other, retiredAt: null },
  ]);
  expect(await reminders(cancelled.id)).toEqual([]);
  expect(await reminders(deferred.id)).toEqual([]);
});

it('uses the clock after waiting for another transaction', async () => {
  const expiredWhileQueued = await f.createTask({ dueAt: dueAt(1) });
  const enteredWindowWhileQueued = await f.createTask({ dueAt: dueAt(32) });
  let instant = now;
  let queued!: Promise<void>;

  await serializedTransaction(f.database, async (tx) => {
    await tx.$executeRaw`UPDATE Task SET version=version WHERE 0`;
    queued = scanDueTaskReminders(
      createNotificationService(f.database),
      () => instant,
    );
    instant = new Date(dueAt(2));
  });
  await queued;

  expect(await reminders(expiredWhileQueued.id)).toEqual([]);
  expect(await reminders(enteredWindowWhileQueued.id)).toEqual([
    { recipientId: f.ids.agent, retiredAt: null },
  ]);
});

it('retires stale reminders on due time changes, ownership changes and completion', async () => {
  const lead = await f.create({}, 'agent');
  const task = await f.createTask({ leadId: lead.id, dueAt: dueAt(5) });
  await scan();
  expect(await reminders(task.id)).toEqual([
    { recipientId: f.ids.agent, retiredAt: null },
  ]);

  const edit = (expectedVersion: number, dueAt: string) =>
    f.taskWrite('patch', `/${task.id}`).send({
      expectedVersion,
      expectedLeadVersion: 1,
      title: 'Updated title',
      notes: null,
      dueAt,
    });
  expect((await edit(1, dueAt(5))).status).toBe(200);
  expect(await reminders(task.id)).toEqual([
    { recipientId: f.ids.agent, retiredAt: null },
  ]);
  expect((await edit(2, dueAt(10))).status).toBe(200);
  expect(await reminders(task.id)).toEqual([
    { recipientId: f.ids.agent, retiredAt: expect.anything() },
  ]);

  await scan();
  expect(
    (await reminders(task.id)).filter((row) => row.retiredAt === null),
  ).toEqual([{ recipientId: f.ids.agent, retiredAt: null }]);
  expect(
    (
      await f.write('patch', `/${lead.id}/assignment`).send({
        expectedVersion: 1,
        assignedAgentId: f.ids.other,
      })
    ).status,
  ).toBe(200);
  expect(
    (await reminders(task.id)).filter((row) => row.retiredAt === null),
  ).toEqual([]);

  await scan();
  expect(
    (await reminders(task.id)).filter((row) => row.retiredAt === null),
  ).toEqual([{ recipientId: f.ids.other, retiredAt: null }]);
  expect(
    (
      await f.taskWrite('patch', `/${task.id}/status`, 'other').send({
        expectedVersion: 3,
        status: 'completed',
      })
    ).status,
  ).toBe(200);
  await f.database.task.update({
    where: { id: task.id },
    data: { status: 'open', completedAt: null },
  });
  await scan();
  const rows = await reminders(task.id);
  expect(rows).toHaveLength(3);
  expect(rows.every((row) => row.retiredAt !== null)).toBe(true);
});

it('keeps scanning later tasks after an earlier batch is already recorded', async () => {
  const lead = await f.create({}, 'agent');
  await f.database.task.createMany({
    data: Array.from({ length: 100 }, () => ({
      submissionId: randomUUID(),
      actorScope: f.ids.agent!,
      payloadHash: 'fixture',
      leadId: lead.id,
      title: 'Early due task',
      dueAt: dueAt(1),
    })),
  });
  const last = await f.createTask({ leadId: lead.id, dueAt: dueAt(2) });
  await scan();
  await scan();
  expect(await reminders(last.id)).toEqual([
    { recipientId: f.ids.agent, retiredAt: null },
  ]);
});
