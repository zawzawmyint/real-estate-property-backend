import { afterAll, beforeAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { leadFixture } from './lead-fixture.js';
let f: Awaited<ReturnType<typeof leadFixture>>;
beforeAll(async () => {
  f = await leadFixture();
});
afterAll(() => f.close());
it('scopes counts/search/activity and checks replay ownership after reassignment', async () => {
  const body = {
    submissionId: randomUUID(),
    name: 'HiddenOwnerProbe',
    email: 'own@example.test',
    purpose: 'sale',
    source: 'call',
  };
  const created = await f.write('post', '', 'agent').send(body);
  expect(created.status).toBe(201);
  const lead = created.body;
  expect((await f.read('?q=HiddenOwnerProbe', 'other')).body.total).toBe(0);
  expect((await f.read('?q=HiddenOwnerProbe', 'agent')).body.total).toBe(1);
  expect((await f.read('', 'agent')).body.unassignedCount).toBeNull();
  const note = {
    submissionId: randomUUID(),
    expectedVersion: 1,
    kind: 'note',
    body: 'Owned note',
  };
  expect(
    (await f.write('post', `/${lead.id}/notes`, 'agent').send(note)).status,
  ).toBe(201);
  expect(
    (
      await f
        .write('patch', `/${lead.id}/assignment`)
        .send({ expectedVersion: 2, assignedAgentId: f.ids.other })
    ).status,
  ).toBe(200);
  for (const suffix of [`/${lead.id}`, `/${lead.id}/activity`])
    expect((await f.read(suffix, 'agent')).status).toBe(404);
  expect(
    (await f.write('post', `/${lead.id}/notes`, 'agent').send(note)).status,
  ).toBe(404);
  expect((await f.write('post', '', 'agent').send(body)).status).toBe(404);
  for (const [suffix, payload] of [
    [`/${lead.id}`, { expectedVersion: 3, name: 'Forged' }],
    [`/${lead.id}/stage`, { expectedVersion: 3, stage: 'won' }],
  ] as const)
    expect((await f.write('patch', suffix, 'agent').send(payload)).status).toBe(
      404,
    );
  const reopened = (await f.read(`/${lead.id}`, 'other')).body;
  expect(reopened.name).toBe('HiddenOwnerProbe');
});
it('keeps pagination/counts bounded and excludes unavailable candidate identities', async () => {
  const lead = await f.create();
  const list = await f.read('?page=1000000');
  expect(list.body.items).toEqual([]);
  expect(list.body.total).toBeGreaterThan(0);
  expect(list.body.unassignedCount).toBeGreaterThan(0);
  for (const query of [
    '?page=1&page=2',
    '?unknown=x',
    '?agentId=other&view=mine',
  ])
    expect((await f.read(query)).status).toBe(400);
  expect(
    (await f.read('/assignment-candidates?q=ÁGENT%20%25_')).body.items.map(
      (item: { id: string }) => item.id,
    ),
  ).toContain(f.ids.other);
  await f.database.user.update({
    where: { id: f.ids.other! },
    data: { role: 'manager' },
  });
  expect(
    (await f.read('/assignment-candidates')).body.items.map(
      (item: { id: string }) => item.id,
    ),
  ).not.toContain(f.ids.other);
  expect(
    (
      await f
        .write('patch', `/${lead.id}/assignment`)
        .send({ expectedVersion: 1, assignedAgentId: f.ids.other })
    ).status,
  ).toBe(409);
  await f.database.user.update({
    where: { id: f.ids.other! },
    data: { role: 'agent', banned: true },
  });
  expect(
    (
      await f
        .write('patch', `/${lead.id}/assignment`)
        .send({ expectedVersion: 1, assignedAgentId: f.ids.other })
    ).status,
  ).toBe(409);
});
it('checks live deactivation even when a previously valid session cookie remains', async () => {
  const lead = await f.create({}, 'agent');
  await f.operator.deactivate('agent@lead-fixture.test');
  expect((await f.read(`/${lead.id}`, 'agent')).status).toBe(401);
  expect((await f.read(`/${lead.id}`)).body.assignedAgent.available).toBe(
    false,
  );
});
