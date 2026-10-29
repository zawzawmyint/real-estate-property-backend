import { afterEach, beforeEach, expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { taskFixture as leadFixture } from './task-fixture.js';
let f: Awaited<ReturnType<typeof leadFixture>>;
beforeEach(async () => {
  f = await leadFixture();
});
afterEach(async () => {
  await f?.close();
});
it('creates safe dated tasks, canonical replays, strict lists and immutable completion', async () => {
  const lead = await f.create({}, 'agent');
  const body = {
    submissionId: randomUUID(),
    leadId: lead.id,
    expectedLeadVersion: 1,
    title: ' Call customer ',
    notes: ' ',
    dueAt: new Date(Date.now() + 86400000).toISOString(),
  };
  const client = request(f.app);
  const write = (method: 'post' | 'patch', suffix = '') =>
    client[method](`/api/v1/staff/tasks${suffix}`)
      .set('Cookie', f.cookies.agent!)
      .set('Origin', f.env.APP_ORIGIN);
  const created = await write('post').send(body);
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  expect(created.body.task).toMatchObject({
    title: 'Call customer',
    notes: null,
    status: 'open',
    isOverdue: false,
    version: 1,
  });
  expect(created.body.task).not.toHaveProperty('actorScope');
  expect(created.body.task.lead).toEqual({ id: lead.id, name: lead.name });
  expect(
    (await write('post').send({ ...body, title: 'Call customer', notes: null }))
      .status,
  ).toBe(200);
  const changed = await write('post').send({ ...body, title: 'Changed' });
  expect(changed.status).toBe(409);
  expect(changed.body.error.existingTaskId).toBe(created.body.task.id);
  const list = await request(f.app)
    .get('/api/v1/staff/tasks')
    .set('Cookie', f.cookies.agent!);
  expect(list.body).toMatchObject({ page: 1, pageSize: 20, total: 1 });
  for (const query of [
    '?due=overdue&status=all',
    '?pageSize=101',
    '?status=open&status=open',
    '?unknown=1',
  ])
    expect(
      (
        await request(f.app)
          .get(`/api/v1/staff/tasks${query}`)
          .set('Cookie', f.cookies.agent!)
      ).status,
    ).toBe(400);
  const done = await write('patch', `/${created.body.task.id}/status`).send({
    expectedVersion: 1,
    status: 'completed',
  });
  expect(done.status).toBe(200);
  expect(done.body.task).toMatchObject({
    status: 'completed',
    version: 2,
    isOverdue: false,
  });
  expect(
    (
      await write('patch', `/${created.body.task.id}/status`).send({
        expectedVersion: 2,
        status: 'cancelled',
      })
    ).status,
  ).toBe(409);
  expect((await write('post').send(body)).body.task.status).toBe('completed');
});
it('uses one clock for equality, Dubai midnight and bounded stable privacy-safe pages', async () => {
  const lead = await f.create({}, 'agent');
  const at = '2030-01-01T20:00:00.000Z';
  const base = {
    submissionId: randomUUID(),
    actorScope: f.ids.agent!,
    payloadHash: 'test',
    leadId: lead.id,
    title: 'Boundary',
    dueAt: new Date(at),
    createdById: f.ids.agent!,
  };
  const equal = await f.database.task.create({ data: base });
  const before = await f.database.task.create({
    data: {
      ...base,
      submissionId: randomUUID(),
      dueAt: new Date(Date.parse(at) - 1),
    },
  });
  const after = await f.database.task.create({
    data: {
      ...base,
      submissionId: randomUUID(),
      dueAt: new Date(Date.parse(at) + 1),
    },
  });
  await f.database.task.create({
    data: {
      ...base,
      submissionId: randomUUID(),
      dueAt: new Date(Date.parse(at) - 1),
      status: 'completed',
      completedAt: new Date(at),
    },
  });
  const { service, actor } = await f.serviceAt(at);
  const query = {
    leadId: lead.id,
    status: 'open' as const,
    due: 'all' as const,
    page: 1,
    pageSize: 2,
  };
  const first = await service.list(query, actor),
    second = await service.list({ ...query, page: 2 }, actor);
  expect(first.asOf).toBe(at);
  expect(first.total).toBe(3);
  expect(first.items.map((row) => row.id)).toEqual([before.id, equal.id]);
  expect(second.items.map((row) => row.id)).toEqual([after.id]);
  expect(first.items.map((row) => row.isOverdue)).toEqual([true, false]);
  expect(
    (await service.list({ ...query, due: 'overdue' }, actor)).items.map(
      (row) => row.id,
    ),
  ).toEqual([before.id]);
  expect((await service.list({ ...query, due: 'upcoming' }, actor)).total).toBe(
    2,
  );
  expect((await service.list({ ...query, due: 'today' }, actor)).total).toBe(2);
  for (const key of [
    'email',
    'phone',
    'payloadHash',
    'actorScope',
    'createdById',
    'leadId',
  ])
    expect(JSON.stringify(first)).not.toContain(`"${key}"`);
});
