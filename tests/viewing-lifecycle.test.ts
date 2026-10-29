import { afterAll, beforeAll, expect, it } from 'vitest';
import { viewingFixture } from './viewing-fixture.js';
import { randomUUID } from 'node:crypto';
let f: Awaited<ReturnType<typeof viewingFixture>>;
beforeAll(async () => {
  f = await viewingFixture();
});
afterAll(async () => {
  await f?.close();
});
it('enforces bounded duration, future starts and strict request fields', async () => {
  for (const minutes of [14, 241, 0])
    expect(
      (
        await f.viewingWrite('post').send({
          ...f.body,
          endsAt: new Date(
            Date.parse(f.body.startsAt) + minutes * 60000,
          ).toISOString(),
        })
      ).status,
    ).toBe(400);
  for (const minutes of [15, 240])
    expect(
      (
        await f.viewingWrite('post').send({
          ...f.body,
          submissionId: randomUUID(),
          endsAt: new Date(
            Date.parse(f.body.startsAt) + minutes * 60000,
          ).toISOString(),
        })
      ).status,
    ).toBe(201);
  expect(
    (
      await f
        .viewingWrite('post')
        .send({ ...f.body, assignedAgentId: f.ids.agent })
    ).status,
  ).toBe(400);
  expect(
    (
      await f.viewingWrite('post').send({
        ...f.body,
        startsAt: new Date(Date.now() - 86400000).toISOString(),
        endsAt: new Date(Date.now() - 82800000).toISOString(),
      })
    ).status,
  ).toBe(400);
  for (const query of [
    '?from=2027-01-01T00:00:00Z&to=2027-03-01T00:00:00Z',
    f.range + '&page=1&page=2',
    f.range + '&pageSize=101',
  ])
    expect((await f.viewingRead(query)).status).toBe(400);
});
it('retains archived history, prevents deletion and guards terminal states and immutable feedback', async () => {
  const row = await f.createViewing();
  expect(
    (
      await f
        .viewingWrite('patch', `/${row.id}/status`)
        .send({ expectedVersion: 1, status: 'completed', feedback: 'Good' })
    ).status,
  ).toBe(409);
  await f.database.property.update({
    where: { id: f.property.id },
    data: { publishingState: 'archived', availability: 'sold' },
  });
  expect(
    (
      await f.viewingWrite('patch', `/${row.id}`).send({
        expectedVersion: 1,
        expectedLeadVersion: 1,
        startsAt: f.body.startsAt,
        endsAt: f.body.endsAt,
      })
    ).status,
  ).toBe(409);
  const history = await f.viewingRead(`/${row.id}`);
  expect(history.body.property.bookable).toBe(false);
  await expect(
    f.database.property.delete({ where: { id: f.property.id } }),
  ).rejects.toThrow();
  await f.database.viewing.update({
    where: { id: row.id },
    data: {
      startsAt: new Date(Date.now() - 3600000),
      endsAt: new Date(Date.now() - 60000),
    },
  });
  expect(
    (
      await f
        .viewingWrite('patch', `/${row.id}/status`)
        .send({ expectedVersion: 1, status: 'completed', feedback: '   ' })
    ).status,
  ).toBe(400);
  const done = await f.viewingWrite('patch', `/${row.id}/status`).send({
    expectedVersion: 1,
    status: 'completed',
    feedback: '  Interested after visit  ',
  });
  expect(done.status).toBe(200);
  expect(done.body.feedback).toBe('Interested after visit');
  expect(done.body.version).toBe(2);
  expect((await f.viewingRead(`/${row.id}`)).body.feedback).toBe(
    'Interested after visit',
  );
  expect(
    (
      await f
        .viewingWrite('patch', `/${row.id}/status`)
        .send({ expectedVersion: 2, status: 'cancelled' })
    ).status,
  ).toBe(409);
  expect(
    (await f.database.lead.findUnique({ where: { id: f.lead.id } }))?.stage,
  ).toBe('new');
});
