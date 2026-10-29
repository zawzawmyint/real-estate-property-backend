import { afterAll, beforeAll, expect, it } from 'vitest';
import { viewingFixture } from './viewing-fixture.js';
let f: Awaited<ReturnType<typeof viewingFixture>>;
beforeAll(async () => {
  f = await viewingFixture();
});
afterAll(async () => {
  await f?.close();
});
it('transfers history, counts and replay access with current lead assignment', async () => {
  const created = await f.viewingWrite('post').send(f.body);
  expect(created.status).toBe(201);
  expect((await f.viewingRead(f.range, 'other')).body.total).toBe(0);
  expect((await f.viewingRead(f.range)).body.total).toBe(1);
  await f
    .write('patch', `/${f.lead.id}/assignment`)
    .send({ expectedVersion: 1, assignedAgentId: f.ids.other });
  expect((await f.viewingRead(`/${created.body.id}`)).status).toBe(404);
  expect((await f.viewingWrite('post').send(f.body)).status).toBe(404);
  expect(
    (
      await f
        .viewingWrite('patch', `/${created.body.id}/status`)
        .send({ expectedVersion: 1, status: 'cancelled' })
    ).status,
  ).toBe(404);
  expect((await f.viewingRead(f.range)).body.total).toBe(0);
  expect((await f.viewingRead(f.range, 'other')).body.total).toBe(1);
  expect(
    (await f.viewingRead(`/${created.body.id}`, 'other')).body.assignedAgent.id,
  ).toBe(f.ids.other);
  expect((await f.viewingWrite('post', '', 'other').send(f.body)).status).toBe(
    409,
  );
  await f
    .write('patch', `/${f.lead.id}/assignment`)
    .send({ expectedVersion: 2, assignedAgentId: null });
  expect((await f.viewingRead(`/${created.body.id}`, 'other')).status).toBe(
    404,
  );
  expect((await f.viewingRead(`/${created.body.id}`, 'manager')).status).toBe(
    200,
  );
});
it('uses inclusive/exclusive range boundaries and stable pages without privacy leaks', async () => {
  const startsAt = new Date(Date.now() + 2 * 86400000).toISOString();
  const rows = [];
  for (let index = 0; index < 3; index++)
    rows.push(
      await f.createViewing({
        leadId: (await f.create({}, 'agent')).id,
        startsAt,
        endsAt: new Date(Date.parse(startsAt) + 3600000).toISOString(),
      }),
    );
  const base = `?from=${encodeURIComponent(startsAt)}&to=${encodeURIComponent(new Date(Date.parse(startsAt) + 1).toISOString())}&pageSize=2`;
  const first = await f.viewingRead(base),
    second = await f.viewingRead(base + '&page=2');
  expect(first.body.total).toBe(3);
  expect(second.body.items).toHaveLength(1);
  expect(
    [...first.body.items, ...second.body.items].map(
      (row: { id: string }) => row.id,
    ),
  ).toEqual(rows.map((row) => row.id).sort());
  const excluded = await f.viewingRead(
    `?from=${encodeURIComponent(new Date(Date.parse(startsAt) - 1).toISOString())}&to=${encodeURIComponent(startsAt)}`,
  );
  expect(excluded.body.total).toBe(0);
  const json = JSON.stringify(first.body);
  for (const key of [
    'payloadHash',
    'actorScope',
    'ownerPhone',
    'createdById',
    'email',
    'phone',
  ])
    expect(json).not.toContain(`"${key}"`);
});

it('rejects inactive assignees while retaining manager historical access', async () => {
  const lead = await f.create({}, 'agent');
  await f.database.user.update({
    where: { id: f.ids.agent! },
    data: { disabled: true },
  });
  expect(
    (
      await f
        .viewingWrite('post', '', 'manager')
        .send({ ...f.body, leadId: lead.id })
    ).status,
  ).toBe(409);
  expect((await f.viewingRead(f.range)).status).toBe(401);
});
