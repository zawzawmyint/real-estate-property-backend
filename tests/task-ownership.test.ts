import { afterEach, beforeEach, expect, it } from 'vitest';
import { taskFixture } from './task-fixture.js';
let f: Awaited<ReturnType<typeof taskFixture>>;
beforeEach(async () => {
  f = await taskFixture();
});
afterEach(async () => {
  await f?.close();
});
it('transfers every access surface with lead assignment and hides other-actor receipts', async () => {
  const response = await f.taskWrite('post').send(f.body),
    task = response.body.task;
  expect((await f.taskRead('', 'other')).body.total).toBe(0);
  await f
    .write('patch', `/${f.lead.id}/assignment`)
    .send({ expectedVersion: 1, assignedAgentId: f.ids.other });
  expect((await f.taskRead()).body.total).toBe(0);
  expect((await f.taskRead(`?leadId=${f.lead.id}`)).status).toBe(404);
  expect((await f.taskRead(`/${task.id}`)).status).toBe(404);
  expect(
    (await f.taskWrite('post').send({ ...f.body, title: 'changed' })).status,
  ).toBe(404);
  expect(
    (
      await f.taskWrite('patch', `/${task.id}`).send({
        expectedVersion: 1,
        expectedLeadVersion: 2,
        title: 'x',
        notes: null,
        dueAt: f.body.dueAt,
      })
    ).status,
  ).toBe(404);
  expect(
    (
      await f
        .taskWrite('patch', `/${task.id}/status`)
        .send({ expectedVersion: 1, status: 'cancelled' })
    ).status,
  ).toBe(404);
  expect((await f.taskRead('', 'other')).body.total).toBe(1);
  const conflict = await f.taskWrite('post', '', 'other').send(f.body);
  expect(conflict.status).toBe(409);
  expect(conflict.body.error).not.toHaveProperty('existingTaskId');
  await f
    .write('patch', `/${f.lead.id}/assignment`)
    .send({ expectedVersion: 2, assignedAgentId: null });
  expect((await f.taskRead(`/${task.id}`, 'other')).status).toBe(404);
  expect((await f.taskRead(`/${task.id}`, 'manager')).status).toBe(200);
});
it('rechecks live identity and role inside writes and receipt replays', async () => {
  const lead = await f.create({}, 'agent');
  const { service, actor } = await f.serviceAt(new Date().toISOString());
  await f.database.user.update({
    where: { id: actor.id },
    data: { role: 'manager' },
  });
  await f.database.lead.update({
    where: { id: lead.id },
    data: { assignedAgentId: f.ids.other! },
  });
  const created = await service.create({ ...f.body, leadId: lead.id }, actor);
  if ('receiptConflict' in created)
    throw new Error('Unexpected receipt conflict');
  await f.database.user.update({
    where: { id: actor.id },
    data: { disabled: true },
  });
  await expect(service.detail(created.task.id, actor)).rejects.toMatchObject({
    status: 401,
  });
  await expect(
    service.create({ ...f.body, leadId: lead.id }, actor),
  ).rejects.toMatchObject({ status: 401 });
  await expect(
    service.status(
      created.task.id,
      { expectedVersion: 1, status: 'cancelled' },
      actor,
    ),
  ).rejects.toMatchObject({ status: 401 });
  await f.database.user.update({
    where: { id: actor.id },
    data: { disabled: false, role: 'agent' },
  });
});

it.each(['expired', 'deleted', 'rotated'] as const)(
  'rejects a %s session inside reads, writes and creation replay',
  async (revocation) => {
    const { service, actor } = await f.serviceAt(new Date().toISOString());
    const created = await service.create(f.body, actor);
    if ('receiptConflict' in created)
      throw new Error('Unexpected receipt conflict');

    if (revocation === 'deleted')
      await f.database.session.delete({ where: { id: actor.sessionId } });
    else
      await f.database.session.update({
        where: { id: actor.sessionId },
        data:
          revocation === 'expired'
            ? { expiresAt: new Date(0) }
            : { credentialVersion: { increment: 1 } },
      });

    const denied = { status: 401 };
    await expect(
      service.list(
        { status: 'open', due: 'all', page: 1, pageSize: 20 },
        actor,
      ),
    ).rejects.toMatchObject(denied);
    await expect(service.detail(created.task.id, actor)).rejects.toMatchObject(
      denied,
    );
    await expect(service.create(f.body, actor)).rejects.toMatchObject(denied);
    await expect(
      service.update(
        created.task.id,
        {
          expectedVersion: 1,
          expectedLeadVersion: 1,
          title: 'Changed title',
          notes: null,
          dueAt: f.body.dueAt,
        },
        actor,
      ),
    ).rejects.toMatchObject(denied);
    await expect(
      service.status(
        created.task.id,
        { expectedVersion: 1, status: 'completed' },
        actor,
      ),
    ).rejects.toMatchObject(denied);
  },
);
