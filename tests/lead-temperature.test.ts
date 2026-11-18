import { afterAll, expect, it } from 'vitest';
import { leadFixture } from './lead-fixture.js';
import { createLeadService } from '../src/modules/leads/leads.service.js';
import request from 'supertest';

const f = await leadFixture();
afterAll(() => f.close());
const change = (
  id: string,
  temperature: string,
  expectedVersion: number,
  role = 'manager',
) =>
  f
    .write('patch', `/${id}/temperature`, role)
    .send({ temperature, expectedVersion });

it('changesTemperatureAtomically and sameValueDoesNotWrite while staleSameValueConflicts', async () => {
  let lead = await f.create();
  expect(lead.temperature).toBe('unassessed');
  for (const temperature of ['hot', 'warm', 'cold', 'unassessed']) {
    const before = await f.database.lead.findUniqueOrThrow({
      where: { id: lead.id },
    });
    const result = await change(lead.id, temperature, lead.version);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      temperature,
      version: lead.version + 1,
      stage: lead.stage,
      assignedAgent: lead.assignedAgent,
    });
    const events = await f.read(`/${lead.id}/activity`);
    const event = events.body.items.find(
      (item: { type: string }) => item.type === 'temperature_changed',
    );
    expect(event).toMatchObject({
      actor: { id: f.ids.manager },
      temperatureChange: { from: lead.temperature, to: temperature },
    });
    expect(
      events.body.items.find(
        (item: { type: string }) => item.type === 'created',
      ).temperatureChange,
    ).toBeNull();
    lead = result.body;
    const noOp = await change(lead.id, temperature, lead.version);
    expect(noOp.status).toBe(200);
    expect(noOp.body.version).toBe(lead.version);
    const row = await f.database.lead.findUniqueOrThrow({
      where: { id: lead.id },
    });
    expect(row.version).toBe(before.version + 1);
    expect(noOp.body.updatedAt).toBe(row.updatedAt.toISOString());
    expect((await change(lead.id, temperature, lead.version - 1)).status).toBe(
      409,
    );
  }
  expect(
    await f.database.leadActivity.count({
      where: { leadId: lead.id, type: 'temperature_changed' },
    }),
  ).toBe(4);
  for (const stage of ['won', 'lost']) {
    const updated = await f
      .write('patch', `/${lead.id}/stage`)
      .send({ expectedVersion: lead.version, stage });
    expect(updated.body.temperature).toBe(lead.temperature);
    lead = (
      await change(
        lead.id,
        stage === 'won' ? 'hot' : 'cold',
        updated.body.version,
      )
    ).body;
    expect(lead.stage).toBe(stage);
  }
});

it('enforces ownership, strict inputs and independent filtered list/export queries', async () => {
  const lead = await f.create({}, 'agent');
  expect((await change(lead.id, 'hot', 1, 'other')).status).toBe(404);
  expect((await change(lead.id, 'hot', 1, 'agent')).status).toBe(200);
  for (const body of [
    { temperature: null, expectedVersion: 2 },
    { temperature: 'Hot', expectedVersion: 2 },
    { temperature: 'hot', expectedVersion: 0 },
    { temperature: 'hot', expectedVersion: 2, stage: 'won' },
  ])
    expect(
      (await f.write('patch', `/${lead.id}/temperature`).send(body)).status,
    ).toBe(400);
  expect(
    (
      await f
        .write('patch', `/${lead.id}`)
        .send({ expectedVersion: 2, temperature: 'cold' })
    ).status,
  ).toBe(400);
  expect(
    (
      await f.write('post').send({
        name: 'Invalid',
        email: 'a@example.test',
        purpose: 'sale',
        source: 'call',
        submissionId: crypto.randomUUID(),
        temperature: 'hot',
      })
    ).status,
  ).toBe(400);
  const assigned = await f
    .write('patch', `/${lead.id}/assignment`)
    .send({ expectedVersion: 2, assignedAgentId: f.ids.other });
  expect(assigned.body.temperature).toBe('hot');
  expect((await change(lead.id, 'cold', 3, 'agent')).status).toBe(404);
  expect(
    (
      await f
        .write('patch', `/${lead.id}/assignment`, 'agent')
        .send({ expectedVersion: 3, assignedAgentId: null })
    ).status,
  ).toBe(403);
  const visible = await f.read('?temperature=hot', 'other');
  expect(visible.body.items.map((row: { id: string }) => row.id)).toContain(
    lead.id,
  );
  expect((await f.read('?temperature=hot', 'agent')).body.total).toBe(0);
  for (const suffix of [
    '?temperature=Hot',
    '?temperature=',
    '?temperature=hot&temperature=cold',
    '/export?temperature=hot&temperature=cold',
  ])
    expect((await f.read(suffix)).status).toBe(400);
  const exported = await f.read('/export?view=all&temperature=hot');
  expect(exported.status).toBe(200);
  expect(exported.text.split('\n')[0]).not.toContain('temperature');
  expect(exported.text).toContain(lead.id);
  expect(
    (await f.read('/export?view=all&temperature=warm')).text,
  ).not.toContain(lead.id);
});

it('concurrentUpdatesDoNotOverwrite and eventFailureRollsBackLead', async () => {
  const lead = await f.create();
  const results = await Promise.all([
    change(lead.id, 'hot', 1),
    change(lead.id, 'cold', 1),
  ]);
  expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  expect(
    await f.database.leadActivity.count({
      where: { leadId: lead.id, type: 'temperature_changed' },
    }),
  ).toBe(1);
  await f.database.$executeRawUnsafe(
    `CREATE TRIGGER fail_temperature_event BEFORE INSERT ON LeadActivity WHEN NEW.type='temperature_changed' BEGIN SELECT RAISE(ABORT, 'test failure'); END`,
  );
  try {
    const before = await f.database.lead.findUniqueOrThrow({
      where: { id: lead.id },
    });
    expect((await change(lead.id, 'warm', 2)).status).toBe(500);
    expect(
      await f.database.lead.findUniqueOrThrow({ where: { id: lead.id } }),
    ).toEqual(before);
  } finally {
    await f.database.$executeRawUnsafe('DROP TRIGGER fail_temperature_event');
  }
});

it('disabledActorCannotWrite with the existing 401 semantics', async () => {
  const lead = await f.create({}, 'agent');
  await f.database.user.update({
    where: { id: f.ids.agent! },
    data: { disabled: true },
  });
  expect((await change(lead.id, 'hot', 1, 'agent')).status).toBe(401);
  expect((await f.read(`/${lead.id}`)).body.temperature).toBe('unassessed');
});

it('defaults CSV and public inquiries without exposing temperature or accepting a public assessment', async () => {
  const csv =
    'name,email,purpose,source\nImported temperature,temperature-import@example.test,sale,call';
  const preview = await f.write('post', '/imports/preview').send({ csv });
  const result = await f.write('post', '/imports/commit').send({
    csv,
    submissionId: crypto.randomUUID(),
    schemaVersion: preview.body.schemaVersion,
    digest: preview.body.digest,
  });
  expect(result.status).toBe(201);
  expect(
    await f.database.lead.findFirst({
      where: { email: 'temperature-import@example.test' },
    }),
  ).toMatchObject({ temperature: 'unassessed' });
  const payload = {
    submissionId: crypto.randomUUID(),
    name: 'Temperature inquiry',
    email: 'temperature-public@example.test',
    purpose: 'sale',
    message: 'Interested in available homes',
  };
  const inquiry = await request(f.app)
    .post('/api/v1/public/inquiries')
    .set('Origin', f.env.APP_ORIGIN)
    .send(payload);
  expect(inquiry.status).toBe(201);
  expect(inquiry.body).toEqual({ received: true });
  expect(
    await f.database.lead.findFirst({ where: { email: payload.email } }),
  ).toMatchObject({ temperature: 'unassessed' });
  expect(
    (
      await request(f.app)
        .post('/api/v1/public/inquiries')
        .set('Origin', f.env.APP_ORIGIN)
        .send({
          ...payload,
          submissionId: crypto.randomUUID(),
          temperature: 'hot',
        })
    ).status,
  ).toBe(400);
});

it('revalidates disabled, banned and revoked actors inside the service transaction', async () => {
  const lead = await f.create({ assignedAgentId: f.ids.other });
  const session = await f.database.session.findFirstOrThrow({
    where: { userId: f.ids.other! },
  });
  const identity = {
    id: f.ids.other!,
    name: 'other',
    role: 'agent' as const,
    sessionId: session.id,
  };
  const service = createLeadService(f.database);
  for (const data of [{ disabled: true }, { banned: true }]) {
    await f.database.user.update({ where: { id: identity.id }, data });
    await expect(
      service.temperature(
        lead.id,
        { expectedVersion: 1, temperature: 'hot' },
        identity,
      ),
    ).rejects.toMatchObject({ status: 401 });
    await f.database.user.update({
      where: { id: identity.id },
      data: { disabled: false, banned: false },
    });
  }
  await f.database.session.delete({ where: { id: session.id } });
  await expect(
    service.temperature(
      lead.id,
      { expectedVersion: 1, temperature: 'hot' },
      identity,
    ),
  ).rejects.toMatchObject({ status: 401 });
});

it('filters before pagination/count/export while retaining other filter predicates', async () => {
  const rows = Array.from({ length: 24 }, (_, i) => ({
    id: crypto.randomUUID(),
    name: `Temperature pagination ${i}`,
    email: `pagination-${i}@example.test`,
    searchName: `temperature pagination ${i}`,
    searchEmail: `pagination-${i}@example.test`,
    searchPhone: '',
    searchPropertyTitle: '',
    purpose: 'sale',
    source: 'call',
    stage: 'contacted',
    temperature: i < 23 ? 'hot' : 'cold',
    assignedAgentId: f.ids.other!,
  }));
  await f.database.lead.createMany({ data: rows });
  const query = `view=all&q=temperature%20pagination&temperature=hot&source=call&stage=contacted&agentId=${f.ids.other}&sort=oldest`;
  const first = await f.read(`?${query}&page=1`);
  const second = await f.read(`?${query}&page=2`);
  expect(first.body.total).toBe(23);
  expect(first.body.items).toHaveLength(20);
  expect(second.body.total).toBe(23);
  expect(second.body.items).toHaveLength(3);
  expect(
    new Set(
      [...first.body.items, ...second.body.items].map(
        (row: { id: string }) => row.id,
      ),
    ).size,
  ).toBe(23);
  const exported = await f.read(`/export?${query}`);
  for (const row of rows.slice(0, 23)) expect(exported.text).toContain(row.id);
  expect(exported.text).not.toContain(rows[23]!.id);
});
