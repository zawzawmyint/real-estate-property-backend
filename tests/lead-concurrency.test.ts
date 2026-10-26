import request from 'supertest';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { leadFixture } from './lead-fixture.js';
import { createDatabase } from '../src/infrastructure/database/client.js';
import { createStaffAuth } from '../src/modules/auth/auth.js';
import { createApp } from '../src/app.js';
let f: Awaited<ReturnType<typeof leadFixture>>;
beforeAll(async () => {
  f = await leadFixture();
});
afterAll(() => f.close());
it('rolls back note, receipt, activity and version when SQLite rejects an event', async () => {
  const lead = await f.create({ assignedAgentId: f.ids.agent });
  const submissionId = randomUUID();
  await f.database.$executeRawUnsafe(
    "CREATE TRIGGER reject_note BEFORE INSERT ON LeadActivity WHEN NEW.type = 'note_added' BEGIN SELECT RAISE(ABORT, 'fixture rejection'); END",
  );
  try {
    const response = await f.write('post', `/${lead.id}/notes`, 'agent').send({
      submissionId,
      expectedVersion: 1,
      kind: 'note',
      body: 'Sensitive private body',
    });
    expect(response.status).toBe(500);
    expect(JSON.stringify(response.body)).not.toContain('Sensitive');
    expect(
      await f.database.leadNote.count({ where: { leadId: lead.id } }),
    ).toBe(0);
    expect(
      await f.database.leadSubmissionReceipt.count({
        where: { id: submissionId },
      }),
    ).toBe(0);
    expect((await f.read(`/${lead.id}`)).body.version).toBe(1);
  } finally {
    await f.database.$executeRawUnsafe('DROP TRIGGER reject_note');
  }
});
it('prevents lost updates and former-owner writes when assignment commits first', async () => {
  const lead = await f.create({ assignedAgentId: f.ids.agent });
  const writes = await Promise.all([
    f
      .write('patch', `/${lead.id}/stage`, 'agent')
      .send({ expectedVersion: 1, stage: 'won' }),
    f
      .write('patch', `/${lead.id}/stage`, 'agent')
      .send({ expectedVersion: 1, stage: 'lost' }),
  ]);
  expect(writes.map((r) => r.status).sort()).toEqual([200, 409]);
  const assigned = await f
    .write('patch', `/${lead.id}/assignment`)
    .send({ expectedVersion: 2, assignedAgentId: f.ids.other });
  expect(assigned.status).toBe(200);
  expect(
    (
      await f.write('post', `/${lead.id}/notes`, 'agent').send({
        submissionId: randomUUID(),
        expectedVersion: 3,
        kind: 'call',
        body: 'Old ownership',
      })
    ).status,
  ).toBe(404);
  expect((await f.read(`/${lead.id}/activity`)).body.total).toBe(3);
});
it('orders active-target assignment against deactivation and preserves existing assigned leads', async () => {
  const lead = await f.create();
  const assignedBefore = await f.database.lead.count({
    where: { assignedAgentId: f.ids.other! },
  });
  const assignment = f
    .write('patch', `/${lead.id}/assignment`)
    .send({ expectedVersion: 1, assignedAgentId: f.ids.other });
  const results = await Promise.all([
    assignment,
    f.operator.deactivate('other@lead-fixture.test'),
  ]);
  expect([200, 409]).toContain(results[0].status);
  expect(results[1].assignedLeadCount).toBe(
    assignedBefore + (results[0].status === 200 ? 1 : 0),
  );
  expect(
    (
      await f.write('patch', `/${lead.id}/assignment`).send({
        expectedVersion: results[0].status === 200 ? 2 : 1,
        assignedAgentId: f.ids.other,
      })
    ).status,
  ).toBe(409);
});
it('deduplicates identical submissions from two real SQLite clients', async () => {
  const second = await createDatabase(f.env.DATABASE_URL),
    app = createApp(f.env, createStaffAuth(f.env, second), second);
  const payload = {
    submissionId: randomUUID(),
    name: 'Two clients',
    phone: '12345',
    purpose: 'sale',
    source: 'call',
  };
  try {
    const results = await Promise.all([
      f.write('post').send(payload),
      request(app)
        .post('/api/v1/staff/leads')
        .set('Cookie', f.cookies.manager!)
        .set('Origin', f.env.APP_ORIGIN)
        .send(payload),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 201]);
    expect(
      await f.database.leadSubmissionReceipt.count({
        where: { id: payload.submissionId },
      }),
    ).toBe(1);
  } finally {
    await second.$disconnect();
  }
});
