import { afterEach, beforeEach, expect, it } from 'vitest';
import { taskFixture } from './task-fixture.js';
let f: Awaited<ReturnType<typeof taskFixture>>;
beforeEach(async () => {
  f = await taskFixture();
});
afterEach(async () => {
  await f?.close();
});
it('retains exact overdue instants for text edits, rejects rescheduling into past, and resolves closed leads', async () => {
  const task = await f.createTask();
  const now = new Date(Date.parse(task.dueAt) + 1000).toISOString();
  const { service, actor } = await f.serviceAt(now);
  const updated = await service.update(
    task.id,
    {
      expectedVersion: 1,
      expectedLeadVersion: 1,
      title: 'Corrected',
      notes: null,
      dueAt: task.dueAt,
    },
    actor,
  );
  expect(updated.task).toMatchObject({
    title: 'Corrected',
    dueAt: task.dueAt,
    isOverdue: true,
    version: 2,
  });
  await expect(
    service.update(
      task.id,
      {
        expectedVersion: 2,
        expectedLeadVersion: 1,
        title: 'Changed',
        notes: null,
        dueAt: new Date(Date.parse(task.dueAt) - 1).toISOString(),
      },
      actor,
    ),
  ).rejects.toMatchObject({ status: 400 });
  await f.database.lead.update({
    where: { id: f.lead.id },
    data: { stage: 'won', version: { increment: 1 }, assignedAgentId: null },
  });
  const manager = await f.serviceAt(now, 'manager');
  await expect(
    manager.service.update(
      task.id,
      {
        expectedVersion: 2,
        expectedLeadVersion: 2,
        title: 'Changed',
        notes: null,
        dueAt: task.dueAt,
      },
      manager.actor,
    ),
  ).rejects.toMatchObject({ status: 409 });
  const done = await manager.service.status(
    task.id,
    { expectedVersion: 2, status: 'completed' },
    manager.actor,
  );
  expect(done.task).toMatchObject({
    status: 'completed',
    completedAt: now,
    isOverdue: false,
    version: 3,
  });
});
it('validates explicit instants, limits and selected write fields', async () => {
  const lead = await f.create({}, 'agent');
  f.body.leadId = lead.id;
  for (const extra of [
    { dueAt: '2028-01-01T12:00:00' },
    { dueAt: '2028-02-30T12:00:00Z' },
    { dueAt: '1999-12-31T23:59:59Z' },
    { title: ' ' },
    { title: 'a'.repeat(161) },
    { notes: 'a'.repeat(2001) },
    { status: 'completed' },
    { assignedAgentId: f.ids.other },
  ])
    expect(
      (await f.taskWrite('post').send({ ...f.body, ...extra })).status,
    ).toBe(400);
  expect(
    (
      await f
        .taskWrite('post')
        .send({ ...f.body, dueAt: '2000-01-01T00:00:00Z' })
    ).status,
  ).toBe(400);
  const task = await f.createTask();
  await f.database.user.update({
    where: { id: f.ids.agent! },
    data: { disabled: true },
  });
  expect(
    (await f.taskWrite('post', '', 'manager').send({ ...f.body })).status,
  ).toBe(409);
  expect(
    (
      await f
        .taskWrite('patch', `/${task.id}/status`, 'manager')
        .send({ expectedVersion: 1, status: 'cancelled' })
    ).status,
  ).toBe(200);
  expect((await f.taskRead()).status).toBe(401);
});
it('checks future dates against transaction clock and preserves offset-equivalent overdue text edits', async () => {
  const lead = await f.create({}, 'agent');
  const due = '2031-01-01T12:34:56.789Z';
  const { service, actor } = await f.serviceAt(due);
  await expect(
    service.create({ ...f.body, leadId: lead.id, dueAt: due }, actor),
  ).rejects.toMatchObject({ status: 400 });
  const earlier = await f.serviceAt('2031-01-01T12:34:56.788Z');
  const created = await earlier.service.create(
    { ...f.body, leadId: lead.id, dueAt: due },
    earlier.actor,
  );
  if ('receiptConflict' in created)
    throw new Error('Unexpected receipt conflict');
  const later = await f.serviceAt('2031-01-01T12:34:56.790Z');
  const edit = await later.service.update(
    created.task.id,
    {
      expectedVersion: 1,
      expectedLeadVersion: 1,
      title: 'Keep exact instant',
      notes: null,
      dueAt: '2031-01-01T16:34:56.789+04:00',
    },
    later.actor,
  );
  expect(edit.task).toMatchObject({ dueAt: due, isOverdue: true });
});
