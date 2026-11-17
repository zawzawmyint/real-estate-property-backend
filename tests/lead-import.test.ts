import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { afterAll, expect, it } from 'vitest';
import { leadFixture } from './lead-fixture.js';

const fixture = await leadFixture();
afterAll(() => fixture.close());
const base = '/api/v1/staff/leads/imports';
const post = (path: string, body: object, role = 'manager') =>
  request(fixture.app)
    .post(`${base}/${path}`)
    .set('Cookie', fixture.cookies[role]!)
    .set('Origin', fixture.env.APP_ORIGIN)
    .send(body);

it('revalidates malformed Unicode on replay even when UTF-8 replacement bytes share a digest', async () => {
  const csv =
    'name,email,purpose,source\nReplacement\ufffd,a@example.test,sale,call';
  const preview = await post('preview', { csv });
  const payload = {
    csv,
    submissionId: randomUUID(),
    schemaVersion: 2,
    digest: preview.body.digest,
  };
  expect((await post('commit', payload)).status).toBe(201);
  const replay = await post('commit', {
    ...payload,
    csv: csv.replace('\ufffd', '\ud800'),
  });
  expect(replay.status).toBe(400);
  expect(replay.body.error.code).toBe('IMPORT_INVALID_CSV');
});

it('previews without writes and atomically commits/replays unassigned leads with creation history', async () => {
  const csv =
    '\ufeffname,phone,email,purpose,budget_aed,source\r\nÁgent,00971501238888,A@EXAMPLE.TEST,SALE,1.01,CALL\r\nOther,,other@example.test,rent,,walk_in\r\n';
  const before = await fixture.database.lead.count();
  const activities = await fixture.database.leadActivity.count();
  const receipts = await fixture.database.leadSubmissionReceipt.count();
  const notifications = await fixture.database.notification.count();
  const preview = await post('preview', { csv });
  expect(preview.status, JSON.stringify(preview.body)).toBe(200);
  expect(preview.body).toMatchObject({
    valid: true,
    totalRows: 2,
    validRows: 2,
  });
  expect(await fixture.database.lead.count()).toBe(before);
  expect(await fixture.database.leadActivity.count()).toBe(activities);
  const payload = {
    csv,
    submissionId: randomUUID(),
    schemaVersion: 2,
    digest: preview.body.digest,
  };
  const [first, second] = await Promise.all([
    post('commit', payload),
    post('commit', payload),
  ]);
  expect([first.status, second.status].sort()).toEqual([200, 201]);
  expect(first.body.leadIds).toEqual(second.body.leadIds);
  expect(first.body.createdCount).toBe(2);
  const leads = await fixture.database.lead.findMany({
    where: { id: { in: first.body.leadIds } },
    orderBy: { name: 'asc' },
  });
  expect(leads[0]).toMatchObject({
    name: 'Ágent',
    phone: '00971501238888',
    email: 'a@example.test',
    budgetFils: 101n,
    searchName: 'ágent',
    searchPhone: '00971501238888',
    searchEmail: 'a@example.test',
  });
  for (const lead of leads)
    expect(lead).toMatchObject({
      stage: 'new',
      version: 1,
      createdById: fixture.ids.manager,
      propertyId: null,
      propertyTitleSnapshot: null,
      propertyLocationSnapshot: null,
      assignedAgentId: null,
      assignedAgentNameSnapshot: null,
      originalMessage: null,
      searchPropertyTitle: '',
    });
  const events = await fixture.database.leadActivity.findMany({
    where: { leadId: { in: first.body.leadIds } },
  });
  expect(events).toHaveLength(2);
  for (const event of events)
    expect(event).toMatchObject({
      type: 'created',
      actorId: fixture.ids.manager,
      actorNameSnapshot: 'manager',
      nextAgentId: null,
      nextAgentName: null,
      changedFields: '[]',
    });
  expect(await fixture.database.lead.count()).toBe(before + 2);
  expect(await fixture.database.leadActivity.count()).toBe(activities + 2);
  expect(await fixture.database.leadSubmissionReceipt.count()).toBe(receipts);
  expect(await fixture.database.notification.count()).toBe(notifications);
  await fixture.database.lead.update({
    where: { id: first.body.leadIds[0] },
    data: {
      name: 'Later edit',
      assignedAgentId: fixture.ids.agent!,
      version: 2,
    },
  });
  const replay = await post('commit', payload);
  expect(replay.status).toBe(200);
  expect(replay.body).toMatchObject({
    leadIds: first.body.leadIds,
    replayed: true,
  });
  expect(
    await fixture.database.lead.findUnique({
      where: { id: first.body.leadIds[0] },
    }),
  ).toMatchObject({
    name: 'Later edit',
    assignedAgentId: fixture.ids.agent,
    version: 2,
  });
  const conflict = await post('commit', {
    ...payload,
    csv: csv + '\n',
    schemaVersion: 2,
  });
  expect(conflict.status).toBe(409);
  expect(conflict.body.error.code).toBe('IMPORT_CONFLICT');
  expect(JSON.stringify(conflict.body)).not.toContain(first.body.leadIds[0]);
  expect((await post('commit', payload, 'admin')).body.error.code).toBe(
    'IMPORT_CONFLICT',
  );
});

it('rejects invalid final rows atomically and requires fresh previews and strict input', async () => {
  const csv =
    'name,email,purpose,source\nGood,a@example.test,sale,call\nBad,,sale,call';
  const before = await fixture.database.lead.count();
  const preview = await post('preview', { csv });
  expect(preview.status).toBe(200);
  expect(preview.body).toMatchObject({
    valid: false,
    totalRows: 2,
    validRows: 1,
    issueCount: 1,
  });
  const payload = {
    csv,
    submissionId: randomUUID(),
    schemaVersion: 2,
    digest: preview.body.digest,
  };
  const response = await post('commit', payload);
  expect(response.status).toBe(422);
  expect(response.body).toMatchObject({
    error: { code: 'IMPORT_VALIDATION_FAILED' },
    issueCount: 1,
    issues: [
      {
        rowNumber: 3,
        column: 'phone',
        message: 'Provide a phone number or email address.',
      },
    ],
  });
  expect(await fixture.database.lead.count()).toBe(before);
  expect(
    (await post('commit', { ...payload, schemaVersion: 1 })).body.error.code,
  ).toBe('IMPORT_PREVIEW_STALE');
  expect(
    (await post('commit', { ...payload, digest: '0'.repeat(64) })).body.error
      .code,
  ).toBe('IMPORT_PREVIEW_STALE');
  expect(
    (await post('preview', { csv, actorId: fixture.ids.manager })).status,
  ).toBe(400);
  expect((await post('commit', { ...payload, schemaVersion: 0 })).status).toBe(
    400,
  );
});

it('commits 500 leads plus creation history within the existing 15-second budget', async () => {
  const csv =
    'name,email,purpose,budget_aed,source\n' +
    Array.from(
      { length: 500 },
      (_, i) =>
        `Maximum ${i},repeated@example.test,rent,10000000000.00,walk_in`,
    ).join('\n');
  const preview = await post('preview', { csv });
  const before = await fixture.database.leadImportReceipt.count();
  expect(preview.status).toBe(200);
  const started = performance.now();
  const response = await post('commit', {
    csv,
    submissionId: randomUUID(),
    schemaVersion: 2,
    digest: preview.body.digest,
  });
  const elapsed = performance.now() - started;
  console.info(
    `Lead import maximum batch: ${elapsed.toFixed(0)}ms (500 leads + 500 activities + receipt)`,
  );
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  expect(response.body.createdCount).toBe(500);
  expect(elapsed).toBeLessThan(15000);
  expect(
    await fixture.database.lead.count({
      where: { id: { in: response.body.leadIds }, budgetFils: 1000000000000n },
    }),
  ).toBe(500);
  expect(
    await fixture.database.leadActivity.count({
      where: { leadId: { in: response.body.leadIds }, type: 'created' },
    }),
  ).toBe(500);
  expect(await fixture.database.leadImportReceipt.count()).toBe(before + 1);
});

it.each(['lead', 'activity', 'receipt'] as const)(
  'rolls back the entire batch on an injected %s persistence failure',
  async (stage) => {
    const csv =
      'name,email,purpose,source\nFirst,a@example.test,sale,call\nSecond,b@example.test,rent,walk_in';
    const preview = await post('preview', { csv });
    const before = await Promise.all([
      fixture.database.lead.count(),
      fixture.database.leadActivity.count(),
      fixture.database.leadImportReceipt.count(),
      fixture.database.notification.count(),
      fixture.database.leadSubmissionReceipt.count(),
    ]);
    const table =
      stage === 'lead'
        ? 'Lead'
        : stage === 'activity'
          ? 'LeadActivity'
          : 'LeadImportReceipt';
    const condition =
      stage === 'lead'
        ? "WHEN NEW.name='Second'"
        : stage === 'activity'
          ? "WHEN (SELECT name FROM Lead WHERE id=NEW.leadId)='Second'"
          : '';
    await fixture.database.$executeRawUnsafe(
      `CREATE TRIGGER fail_lead_import BEFORE INSERT ON ${table} ${condition} BEGIN SELECT RAISE(ABORT, 'PRIVATE DATABASE FAILURE'); END`,
    );
    try {
      const payload = {
        csv,
        submissionId: randomUUID(),
        schemaVersion: 2,
        digest: preview.body.digest,
      };
      const response = await post('commit', payload);
      expect(response.status).toBeGreaterThanOrEqual(500);
      expect(JSON.stringify(response.body)).not.toContain('PRIVATE');
      expect(
        await Promise.all([
          fixture.database.lead.count(),
          fixture.database.leadActivity.count(),
          fixture.database.leadImportReceipt.count(),
          fixture.database.notification.count(),
          fixture.database.leadSubmissionReceipt.count(),
        ]),
      ).toEqual(before);
      expect(
        await fixture.database.leadImportReceipt.findUnique({
          where: { id: payload.submissionId },
        }),
      ).toBeNull();
    } finally {
      await fixture.database.$executeRawUnsafe('DROP TRIGGER fail_lead_import');
    }
  },
);
