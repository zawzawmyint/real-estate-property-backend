import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { authFixture } from './auth-fixture.js';
const fixture = await authFixture();
const cookies: Record<string, string> = {};
const ids: Record<string, string> = {};
const path = '/api/v1/staff/leads';
beforeAll(async () => {
  for (const label of ['admin', 'manager', 'agent', 'other'] as const) {
    const user = await fixture.operator.create({
      name: label,
      email: `${label}@leads.test`,
      password: 'Test-password-123!',
      role: label === 'other' ? 'agent' : label,
    });
    ids[label] = user.id;
    const response = await request(fixture.app)
      .post('/api/v1/auth/sign-in/email')
      .set('Origin', fixture.env.APP_ORIGIN)
      .send({
        email: `${label}@leads.test`,
        password: 'Test-password-123!',
        rememberMe: true,
      });
    cookies[label] = (
      response.headers['set-cookie'] as unknown as string[]
    )[0]!.split(';')[0]!;
  }
});
afterAll(() => fixture.close());
function write(method: 'post' | 'patch', suffix = '', role = 'manager') {
  const client = request(fixture.app);
  return client[method](`${path}${suffix}`)
    .set('Cookie', cookies[role]!)
    .set('Origin', fixture.env.APP_ORIGIN);
}
function read(suffix = '', role = 'manager') {
  const client = request(fixture.app);
  return client.get(`${path}${suffix}`).set('Cookie', cookies[role]!);
}
function input(extra: object = {}) {
  return {
    submissionId: randomUUID(),
    name: 'José 100%_',
    email: ' LEAD@EXAMPLE.TEST ',
    purpose: 'sale',
    source: 'call',
    ...extra,
  };
}
async function create(extra: object = {}, role = 'manager') {
  const response = await write('post', '', role).send(input(extra));
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response.body;
}
it('creates safe unassigned leads and applies Unicode literal search', async () => {
  const lead = await create();
  expect(lead).toMatchObject({
    stage: 'new',
    assignedAgent: null,
    version: 1,
    email: 'lead@example.test',
    originalMessage: null,
  });
  expect(lead).not.toHaveProperty('searchName');
  const list = await read('?q=JOSÉ%20100%25_');
  expect(list.status).toBe(200);
  expect(list.body.items.map((item: { id: string }) => item.id)).toContain(
    lead.id,
  );
  expect(list.body.items[0]).not.toHaveProperty('originalMessage');
  expect(list.body.pageSize).toBe(20);
});
it('rejects invalid contact, budget, immutable fields and malformed identifiers', async () => {
  for (const extra of [
    { email: null },
    { budgetFils: 0 },
    { budgetFils: 1.2 },
    { budgetFils: 1_000_000_000_001 },
    { stage: 'won' },
    { source: 'website' },
    { phone: '()--', email: null },
    { phone: '' },
  ])
    expect((await write('post').send(input(extra))).status).toBe(400);
  expect((await read('/not-uuid')).status).toBe(400);
  const lead = await create();
  expect(
    (
      await write('patch', `/${lead.id}`).send({
        expectedVersion: 1,
        email: null,
      })
    ).status,
  ).toBe(400);
});
it('enforces current ownership and manager-only assignment', async () => {
  const lead = await create({}, 'agent');
  expect(lead.assignedAgent.id).toBe(ids.agent);
  for (const suffix of [`/${lead.id}`, `/${lead.id}/activity`])
    expect((await read(suffix, 'other')).status).toBe(404);
  expect((await read('?view=all', 'agent')).status).toBe(403);
  expect((await read('/assignment-candidates', 'agent')).status).toBe(403);
  expect(
    (
      await write('patch', `/${lead.id}/assignment`, 'agent').send({
        expectedVersion: 1,
        assignedAgentId: null,
      })
    ).status,
  ).toBe(403);
  const assigned = await write('patch', `/${lead.id}/assignment`).send({
    expectedVersion: 1,
    assignedAgentId: ids.other,
  });
  expect(assigned.status).toBe(200);
  expect(assigned.body.version).toBe(2);
  expect(
    (
      await write('patch', `/${lead.id}/stage`, 'agent').send({
        expectedVersion: 2,
        stage: 'won',
      })
    ).status,
  ).toBe(404);
});
it('atomically deduplicates create/note submissions and rejects stale writes', async () => {
  const body = input({ assignedAgentId: ids.agent });
  const responses = await Promise.all([
    write('post').send(body),
    write('post').send(body),
  ]);
  expect(responses.map((r) => r.status).sort()).toEqual([200, 201]);
  const lead = responses[0]!.body;
  expect(responses[1]!.body.id).toBe(lead.id);
  expect((await write('post').send({ ...body, name: 'Changed' })).status).toBe(
    409,
  );
  const note = {
    submissionId: randomUUID(),
    expectedVersion: 1,
    kind: 'call',
    body: 'Discussed requirements',
  };
  const notes = await Promise.all([
    write('post', `/${lead.id}/notes`, 'agent').send(note),
    write('post', `/${lead.id}/notes`, 'agent').send(note),
  ]);
  expect(notes.map((r) => r.status).sort()).toEqual([200, 201]);
  expect(notes[0]!.body.note.id).toBe(notes[1]!.body.note.id);
  expect(
    (
      await write('patch', `/${lead.id}/stage`).send({
        expectedVersion: 1,
        stage: 'won',
      })
    ).status,
  ).toBe(409);
  const stage = await write('patch', `/${lead.id}/stage`).send({
    expectedVersion: 2,
    stage: 'won',
  });
  expect(stage.body.version).toBe(3);
  expect((await read(`/${lead.id}/activity`)).body.total).toBe(3);
});

it('retains safe snapshots on property/staff deletion and reports assigned leads on deactivation', async () => {
  const property = await fixture.database.property.create({
    data: {
      title: 'Safe home',
      purpose: 'sale',
      city: 'Dubai',
      ownerName: 'SECRET',
    },
  });
  const lead = await create({
    assignedAgentId: ids.other,
    propertyId: property.id,
  });
  expect(JSON.stringify(lead)).not.toContain('SECRET');
  const result = await fixture.operator.deactivate('other@leads.test');
  expect(result).toMatchObject({ assignedLeadCount: expect.any(Number) });
  expect((await read(`/${lead.id}`)).body.assignedAgent.available).toBe(false);
  expect(
    (
      await write('patch', `/${lead.id}/assignment`).send({
        expectedVersion: 1,
        assignedAgentId: ids.other,
      })
    ).status,
  ).toBe(409);
  await fixture.database.property.delete({ where: { id: property.id } });
  await fixture.database.user.delete({ where: { id: ids.other! } });
  const saved = (await read(`/${lead.id}`)).body;
  expect(saved.property).toMatchObject({
    id: null,
    title: 'Safe home',
    available: false,
  });
  expect(saved.previousAgentName).toBe('other');
  expect(saved.assignedAgent).toBeNull();
  expect(
    (
      await write('patch', `/${lead.id}`).send({
        expectedVersion: 1,
        propertyId: null,
      })
    ).body.property,
  ).toBeNull();
});
it('treats omitted nullable defaults as the same canonical manual submission', async () => {
  const payload = input();
  const first = await write('post').send(payload);
  expect(first.status).toBe(201);
  const replay = await write('post').send({
    ...payload,
    phone: null,
    budgetFils: null,
    propertyId: null,
    assignedAgentId: null,
  });
  expect(replay.status).toBe(200);
  expect(replay.body.id).toBe(first.body.id);
});
