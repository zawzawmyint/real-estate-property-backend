import { afterAll, expect, it } from 'vitest';
import { taskFixture } from './task-fixture.js';
import { viewingFixture } from './viewing-fixture.js';

const tasks = await taskFixture();
const viewings = await viewingFixture();
afterAll(async () => {
  await Promise.all([tasks.close(), viewings.close()]);
});

it('records task creation, date and text edits and both terminal states', async () => {
  const f = tasks;
  const first = await f.taskWrite('post').send(f.body);
  expect(first.status).toBe(201);
  expect((await f.taskWrite('post').send(f.body)).status).toBe(200);
  const task = first.body.task;
  const dueAt = new Date(Date.parse(task.dueAt) + 60000).toISOString();
  const notes = 'Private task note sentinel';
  const title = 'Private task title sentinel';
  const patch = await f
    .taskWrite('patch', '/' + task.id)
    .send({ expectedVersion: 1, expectedLeadVersion: 1, title, notes, dueAt });
  expect(patch.status).toBe(200);
  expect(
    (
      await f
        .taskWrite('patch', `/${task.id}/status`)
        .send({ expectedVersion: 2, status: 'completed' })
    ).status,
  ).toBe(200);
  const second = await f.createTask();
  expect(
    (
      await f
        .taskWrite('patch', `/${second.id}/status`)
        .send({ expectedVersion: 1, status: 'cancelled' })
    ).status,
  ).toBe(200);
  const rows = await f.database.recordAuditEvent.findMany({
    where: { entityType: 'task' },
  });
  expect(rows.map((row) => row.action).sort()).toEqual(
    [
      'task.created',
      'task.created',
      'task.updated',
      'task.completed',
      'task.cancelled',
    ].sort(),
  );
  expect(
    rows.every((r) => r.actorRole === 'agent' && r.actorId === f.ids.agent),
  ).toBe(true);
  const changes = JSON.parse(
    rows.find((r) => r.action === 'task.updated')!.changesJson,
  );
  expect(changes).toEqual(
    expect.arrayContaining([
      { field: 'title', redacted: true },
      { field: 'notes', redacted: true },
      { field: 'dueAt', redacted: false, before: task.dueAt, after: dueAt },
    ]),
  );
  for (const value of [notes, title, f.body.title])
    expect(JSON.stringify(rows)).not.toContain(value);
});

it('records rescheduling, cancellation and redacted completion with exact instants', async () => {
  const f = viewings;
  const first = await f.viewingWrite('post').send(f.body);
  expect(first.status).toBe(201);
  expect((await f.viewingWrite('post').send(f.body)).status).toBe(200);
  const id = first.body.id;
  const startsAt = new Date(Date.parse(f.body.startsAt) + 60000).toISOString();
  const endsAt = new Date(Date.parse(f.body.endsAt) + 60000).toISOString();
  expect(
    (
      await f
        .viewingWrite('patch', '/' + id)
        .send({ expectedVersion: 1, expectedLeadVersion: 1, startsAt, endsAt })
    ).status,
  ).toBe(200);
  expect(
    (
      await f
        .viewingWrite('patch', `/${id}/status`)
        .send({ expectedVersion: 2, status: 'cancelled' })
    ).status,
  ).toBe(200);
  const second = await f.createViewing();
  await f.database.viewing.update({
    where: { id: second.id },
    data: {
      startsAt: new Date(Date.now() - 3600000),
      endsAt: new Date(Date.now() - 60000),
    },
  });
  const feedback = 'Private viewing feedback sentinel';
  expect(
    (
      await f
        .viewingWrite('patch', `/${second.id}/status`)
        .send({ expectedVersion: 1, status: 'completed', feedback })
    ).status,
  ).toBe(200);
  const rows = await f.database.recordAuditEvent.findMany({
    where: { entityType: 'viewing' },
  });
  expect(rows.map((row) => row.action).sort()).toEqual(
    [
      'viewing.created',
      'viewing.created',
      'viewing.rescheduled',
      'viewing.cancelled',
      'viewing.completed',
    ].sort(),
  );
  expect(
    JSON.parse(
      rows.find((r) => r.action === 'viewing.rescheduled')!.changesJson,
    ),
  ).toContainEqual({
    field: 'startsAt',
    redacted: false,
    before: f.body.startsAt,
    after: startsAt,
  });
  expect(
    JSON.parse(rows.find((r) => r.action === 'viewing.completed')!.changesJson),
  ).toContainEqual({ field: 'feedback', redacted: true });
  expect(JSON.stringify(rows)).not.toContain(feedback);
});
