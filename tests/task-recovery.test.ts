import { afterEach, beforeEach, expect, it } from 'vitest';
import { taskFixture } from './task-fixture.js';
let f: Awaited<ReturnType<typeof taskFixture>>;
beforeEach(async () => {
  f = await taskFixture();
});
afterEach(async () => {
  await f?.close();
});
it('replays the current task after edits and eligibility changes with normalized canonical hashes', async () => {
  const response = await f
    .taskWrite('post')
    .send({ ...f.body, title: '  Call customer ', notes: '  ' });
  const task = response.body.task;
  const offset = new Date(Date.parse(f.body.dueAt) + 4 * 3600000)
    .toISOString()
    .replace('Z', '+04:00');
  expect(
    (await f.taskWrite('post').send({ ...f.body, dueAt: offset })).status,
  ).toBe(200);
  await f.taskWrite('patch', `/${task.id}`).send({
    expectedVersion: 1,
    expectedLeadVersion: 1,
    title: 'Updated task',
    notes: 'New notes',
    dueAt: f.body.dueAt,
  });
  await f.database.lead.update({
    where: { id: f.lead.id },
    data: { stage: 'lost', version: { increment: 1 } },
  });
  const replay = await f.taskWrite('post').send(f.body);
  expect(replay.status).toBe(200);
  expect(replay.body.task).toMatchObject({ title: 'Updated task', version: 2 });
  const conflict = await f
    .taskWrite('post')
    .send({ ...f.body, expectedLeadVersion: 2 });
  expect(conflict.status).toBe(409);
  expect(conflict.body.error).toMatchObject({
    code: 'TASK_RECEIPT_CONFLICT',
    existingTaskId: task.id,
  });
  await f
    .taskWrite('patch', `/${task.id}/status`)
    .send({ expectedVersion: 2, status: 'cancelled' });
  expect((await f.taskWrite('post').send(f.body)).body.task.status).toBe(
    'cancelled',
  );
  expect(await f.database.task.count()).toBe(1);
});
it('lets delayed and corrected payloads compete for one durable receipt', async () => {
  const lead = await f.create({}, 'agent');
  const body = { ...f.body, leadId: lead.id };
  const responses = await Promise.all([
    f.taskWrite('post').send(body),
    f.taskWrite('post').send({ ...body, title: 'Corrected' }),
  ]);
  expect(responses.map((response) => response.status).sort()).toEqual([
    201, 409,
  ]);
  const saved = responses.find((response) => response.status === 201)!.body
    .task;
  expect(
    responses.find((response) => response.status === 409)!.body.error,
  ).toMatchObject({ code: 'TASK_RECEIPT_CONFLICT', existingTaskId: saved.id });
  expect(
    await f.database.task.count({ where: { submissionId: body.submissionId } }),
  ).toBe(1);
});
