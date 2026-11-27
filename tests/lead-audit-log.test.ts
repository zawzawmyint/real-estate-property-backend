import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { afterAll, expect, it } from 'vitest';
import { leadFixture } from './lead-fixture.js';

const f = await leadFixture();
afterAll(() => f.close());

it('retains one redacted staff lead creation across receipt replay', async () => {
  const submissionId = randomUUID();
  const name = 'Private customer sentinel';
  const input = {
    submissionId,
    name,
    email: 'private@example.test',
    purpose: 'sale',
    source: 'call',
    budgetFils: 12345,
  };
  const first = await f.write('post', '', 'admin').send(input);
  expect(first.status).toBe(201);
  expect((await f.write('post', '', 'admin').send(input)).status).toBe(200);
  const rows = await f.database.recordAuditEvent.findMany({
    where: { entityId: first.body.id },
  });
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    action: 'lead.created',
    actorRole: 'admin',
    actorId: f.ids.admin,
    entityLabel: `Lead ${first.body.id}`,
  });
  expect(JSON.parse(rows[0]!.changesJson)).toEqual(
    expect.arrayContaining([
      { field: 'name', redacted: true },
      { field: 'email', redacted: true },
      { field: 'budgetFils', redacted: false, before: null, after: '12345' },
    ]),
  );
  expect(JSON.stringify(rows)).not.toContain(name);
  expect(JSON.stringify(rows)).not.toContain(input.email);
});

it('logs lead edits and workflow actions once, preserving the operational timeline', async () => {
  const lead = await f.create({}, 'agent');
  const suffix = '/' + lead.id;
  const changes: [string, object][] = [
    ['', { name: 'Private renamed lead' }],
    ['/stage', { stage: 'contacted' }],
    ['/temperature', { temperature: 'hot' }],
    ['/assignment', { assignedAgentId: f.ids.other }],
  ];
  let version = lead.version;
  for (const [route, body] of changes) {
    const response = await f
      .write('patch', suffix + route)
      .send({ expectedVersion: version, ...body });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    version = response.body.version;
  }
  for (const kind of ['note', 'call']) {
    const input = {
      submissionId: randomUUID(),
      expectedVersion: version,
      kind,
      body: 'Private communication sentinel',
    };
    expect((await f.write('post', suffix + '/notes').send(input)).status).toBe(
      201,
    );
    expect((await f.write('post', suffix + '/notes').send(input)).status).toBe(
      200,
    );
    version++;
  }
  expect((await f.read(suffix + '/activity', 'other')).status).toBe(200);
  const rows = await f.database.recordAuditEvent.findMany({
    where: { entityId: lead.id },
  });
  expect(rows.map((r) => r.action).sort()).toEqual(
    [
      'lead.created',
      'lead.assigned',
      'lead.updated',
      'lead.stage_changed',
      'lead.temperature_changed',
      'lead.note_added',
      'lead.call_logged',
    ].sort(),
  );
  for (const row of rows.filter((r) =>
    ['lead.note_added', 'lead.call_logged'].includes(r.action),
  ))
    expect(JSON.parse(row.changesJson)).toEqual([
      { field: 'body', redacted: true },
    ]);
  expect(JSON.stringify(rows)).not.toMatch(
    /Private renamed lead|Private communication sentinel/,
  );
});

it('records retained snapshot clears without inventing ID changes and ignores subsequent true noops', async () => {
  const lead = await f.create();
  await f.database.lead.update({
    where: { id: lead.id },
    data: {
      propertyTitleSnapshot: 'Prior private title',
      propertyLocationSnapshot: 'Prior private location',
      assignedAgentNameSnapshot: 'Prior private agent',
    },
  });
  const path = '/' + lead.id;
  let version = 1;
  for (const [route, values] of [
    [path, { propertyId: null }],
    [path + '/assignment', { assignedAgentId: null }],
  ] as const) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await f
        .write('patch', route)
        .send({ expectedVersion: version, ...values });
      expect(result.status, JSON.stringify(result.body)).toBe(200);
      version = result.body.version;
    }
  }
  const rows = await f.database.recordAuditEvent.findMany({
    where: { entityId: lead.id, action: { not: 'lead.created' } },
  });
  expect(rows).toHaveLength(2);
  const marker = (field: string) => ({ field, redacted: true });
  expect(
    JSON.parse(rows.find((r) => r.action === 'lead.updated')!.changesJson),
  ).toEqual(
    expect.arrayContaining([
      marker('propertyTitleSnapshot'),
      marker('propertyLocationSnapshot'),
    ]),
  );
  expect(
    JSON.parse(rows.find((r) => r.action === 'lead.assigned')!.changesJson),
  ).toEqual([marker('assignedAgentNameSnapshot')]);
  expect(JSON.stringify(rows)).not.toMatch(/Prior private|propertyId/);
});

it('rolls back business data, timeline and submission receipt when audit storage rejects a write', async () => {
  const counts = () =>
    Promise.all([
      f.database.lead.count(),
      f.database.leadActivity.count(),
      f.database.leadSubmissionReceipt.count(),
      f.database.recordAuditEvent.count(),
    ]);
  const before = await counts();
  await f.database.$executeRawUnsafe(
    "CREATE TRIGGER reject_lead_audit BEFORE INSERT ON RecordAuditEvent WHEN NEW.action='lead.created' BEGIN SELECT RAISE(ABORT,'test audit unavailable'); END",
  );
  try {
    const result = await f.write('post').send({
      submissionId: randomUUID(),
      name: 'Rollback sentinel',
      email: 'rollback@example.test',
      purpose: 'sale',
      source: 'call',
    });
    expect(result.status).toBe(500);
    expect(await counts()).toEqual(before);
  } finally {
    await f.database.$executeRawUnsafe('DROP TRIGGER reject_lead_audit');
  }
});

it('attributes agency and property enquiries to Website, retaining no contact or message content', async () => {
  const property = await f.database.property.create({
    data: {
      title: 'Public audit fixture',
      purpose: 'sale',
      publishingState: 'published',
    },
  });
  const message = 'Private enquiry message sentinel';
  for (const [path, details] of [
    ['/api/v1/public/inquiries', { purpose: 'sale' }],
    [`/api/v1/public/properties/${property.id}/inquiries`, {}],
  ] as const) {
    const input = {
      submissionId: randomUUID(),
      email: 'guest@example.test',
      name: 'Guest sentinel',
      message,
      ...details,
    };
    const submit = () =>
      request(f.app).post(path).set('Origin', f.env.APP_ORIGIN).send(input);
    expect((await submit()).status).toBe(201);
    expect((await submit()).status).toBe(200);
    const receipt = await f.database.leadSubmissionReceipt.findUniqueOrThrow({
      where: { id: input.submissionId },
    });
    const rows = await f.database.recordAuditEvent.findMany({
      where: { entityId: receipt.leadId },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorKind: 'website',
      actorId: null,
      actorName: null,
      actorRole: null,
      action: 'lead.created',
    });
    expect(JSON.parse(rows[0]!.changesJson)).toContainEqual({
      field: 'originalMessage',
      redacted: true,
    });
    for (const privateValue of [input.name, input.email, message])
      expect(JSON.stringify(rows)).not.toContain(privateValue);
  }
});
