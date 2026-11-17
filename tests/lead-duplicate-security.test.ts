import { afterAll, expect, it } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import { leadFixture } from './lead-fixture.js';
import { importDigest } from '../src/modules/leads/lead-import.schema.js';
const f = await leadFixture();
afterAll(() => f.close());
const hash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const input = (phone: string) => ({
  submissionId: randomUUID(),
  name: 'Review',
  phone,
  email: 'a@example.test',
  purpose: 'sale',
  source: 'call',
});
const preview = (phone: string, role = 'manager', excludeLeadId?: string) =>
  f
    .write('post', '/duplicate-check', role)
    .send({ phone, ...(excludeLeadId ? { excludeLeadId } : {}) });
it('invalid supplied phones fail safely despite email and unchanged legacy text stays editable', async () => {
  expect(
    (await f.write('post').send(input('0012345'))).body.fieldErrors.phone
      .length,
  ).toBe(1);
  const old = await f.database.lead.create({
    data: {
      searchName: '',
      searchPhone: '',
      searchEmail: '',
      searchPropertyTitle: '',
      name: 'Legacy',
      phone: '0012345',
      email: 'a@example.test',
      purpose: 'sale',
      source: 'call',
    },
  });
  expect(
    (
      await f
        .write('patch', `/${old.id}`)
        .send({ expectedVersion: 1, name: 'Edited', phone: '0012345' })
    ).status,
  ).toBe(200);
  expect(
    (
      await f
        .write('patch', `/${old.id}`)
        .send({ expectedVersion: 2, phone: '0012346' })
    ).status,
  ).toBe(400);
});
it('uses complete scoped membership in tokens without leaking hidden matches or presentation edits', async () => {
  const own = await f.create({ phone: '0502223344' }, 'agent');
  const before = await preview('0502223344', 'agent');
  const hidden = await f.database.lead.create({
    data: {
      searchName: '',
      searchPhone: '',
      searchEmail: '',
      searchPropertyTitle: '',
      name: 'Hidden',
      phone: '0502223344',
      phoneCanonical: '+971502223344',
      assignedAgentId: f.ids.other!,
      stage: 'lost',
      purpose: 'sale',
      source: 'call',
    },
  });
  expect((await preview('0502223344', 'agent')).body).toEqual(before.body);
  await f.database.lead.update({
    where: { id: own.id },
    data: {
      searchName: '',
      searchPhone: '',
      searchEmail: '',
      searchPropertyTitle: '',
      name: 'New name',
      stage: 'won',
    },
  });
  expect((await preview('0502223344', 'agent')).body.reviewToken).toBe(
    before.body.reviewToken,
  );
  await f.database.lead.update({
    where: { id: hidden.id },
    data: { assignedAgentId: f.ids.agent! },
  });
  expect((await preview('0502223344', 'agent')).body.reviewToken).not.toBe(
    before.body.reviewToken,
  );
  const excluded = await preview('0502223344', 'agent', own.id);
  expect(excluded.body.totalMatches).toBe(1);
});
it('concurrent creates invalidate earlier membership and formatting-equivalent edits need no acknowledgement', async () => {
  const first = await f.create({ phone: '0503334455' });
  const review = await preview('0503334455');
  const ack = { reviewToken: review.body.reviewToken };
  const results = await Promise.all([
    f
      .write('post')
      .send({ ...input('0503334455'), duplicateAcknowledgement: ack }),
    f
      .write('post')
      .send({ ...input('0503334455'), duplicateAcknowledgement: ack }),
  ]);
  expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
  const patch = await f
    .write('patch', `/${first.id}`)
    .send({ expectedVersion: 1, phone: '+971 (50) 333-4455' });
  expect(patch.status).toBe(200);
  expect(
    (
      await f
        .write('patch', `/${first.id}`)
        .send({ expectedVersion: 1, name: 'Stale' })
    ).status,
  ).toBe(409);
  expect(
    (
      await f
        .write('patch', `/${first.id}`)
        .send({ expectedVersion: 2, duplicateAcknowledgement: ack })
    ).status,
  ).toBe(400);
});
it('replays historical manual receipts before new phone validation', async () => {
  const body = input('0012345');
  const lead = await f.database.lead.create({
    data: {
      searchName: '',
      searchPhone: '',
      searchEmail: '',
      searchPropertyTitle: '',
      name: body.name,
      phone: body.phone,
      email: body.email,
      purpose: 'sale',
      source: 'call',
    },
  });
  await f.database.leadSubmissionReceipt.create({
    data: {
      id: body.submissionId,
      operation: 'create',
      actorScope: f.ids.manager!,
      payloadHash: hash({
        name: body.name,
        phone: body.phone,
        email: body.email,
        purpose: body.purpose,
        source: body.source,
        budgetFils: null,
        propertyId: null,
        assignedAgentId: null,
      }),
      leadId: lead.id,
    },
  });
  expect((await f.write('post').send(body)).status).toBe(200);
});
it('replays committed v1 imports with legacy phones but rejects fresh v1 batches', async () => {
  const csv = 'name,phone,purpose,source\nLegacy,0012345,sale,call',
    submissionId = randomUUID(),
    digest = importDigest(csv, 1);
  const lead = await f.database.lead.create({
    data: {
      searchName: '',
      searchPhone: '',
      searchEmail: '',
      searchPropertyTitle: '',
      name: 'Old import',
      phone: '0012345',
      purpose: 'sale',
      source: 'call',
    },
  });
  await f.database.leadImportReceipt.create({
    data: {
      id: submissionId,
      actorId: f.ids.manager!,
      schemaVersion: 1,
      contentDigest: digest,
      createdCount: 1,
      leadIdsJson: JSON.stringify([lead.id]),
    },
  });
  const body = { csv, submissionId, digest, schemaVersion: 1 };
  const replay = await f.write('post', '/imports/commit').send(body);
  expect(replay.status).toBe(200);
  expect(replay.body.leadIds).toEqual([lead.id]);
  expect(
    (
      await f
        .write('post', '/imports/commit')
        .send({ ...body, submissionId: randomUUID() })
    ).body.error.code,
  ).toBe('IMPORT_PREVIEW_STALE');
  expect(
    (await f.write('post', '/imports/commit', 'admin').send(body)).body.error
      .code,
  ).toBe('IMPORT_CONFLICT');
});
it('caps examples while including all rows and stale commits write zero records', async () => {
  const csv =
    'name,phone,purpose,source\n' +
    Array.from({ length: 125 }, (_, i) => `Row ${i},0504445566,sale,call`).join(
      '\n',
    );
  const p = await f.write('post', '/imports/preview').send({ csv });
  expect(p.body.duplicateReview).toMatchObject({
    affectedRows: 125,
    warningCount: 125,
    existingMatchRows: 0,
    withinFileRows: 125,
    truncated: true,
  });
  expect(p.body.duplicateReview.warnings).toHaveLength(100);
  expect(p.body.duplicateReview.warnings[0].sameFileRowCount).toBe(124);
  expect(p.body.duplicateReview.warnings[0].sameFileRowNumbers).toHaveLength(
    20,
  );
  await f.create({ phone: '0504445566' });
  const before = await f.database.lead.count(),
    submissionId = randomUUID();
  const result = await f.write('post', '/imports/commit').send({
    csv,
    submissionId,
    digest: p.body.digest,
    schemaVersion: 2,
    duplicateAcknowledgement: {
      reviewToken: p.body.duplicateReview.reviewToken,
    },
  });
  expect(result.status).toBe(409);
  expect(await f.database.lead.count()).toBe(before);
  expect(
    await f.database.leadImportReceipt.findUnique({
      where: { id: submissionId },
    }),
  ).toBeNull();
  expect(result.body.duplicateReview.existingMatchRows).toBe(125);
});
