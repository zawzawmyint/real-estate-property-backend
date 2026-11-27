import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { afterAll, expect, it } from 'vitest';
import { leadFixture } from './lead-fixture.js';

const f = await leadFixture();
afterAll(() => f.close());

async function verifyBatch(kind: 'property' | 'lead', submissionId: string) {
  const path = kind === 'property' ? 'properties' : 'leads';
  const post = (action: string, data: object) =>
    request(f.app)
      .post(`/api/v1/staff/${path}/imports/${action}`)
      .set('Cookie', f.cookies.manager!)
      .set('Origin', f.env.APP_ORIGIN)
      .send(data);

  const count = kind === 'property' ? 500 : 2;
  const csv = [
    kind === 'property'
      ? 'title,purpose,owner_name'
      : 'name,purpose,email,source',
    ...Array.from({ length: count }, (_, i) =>
      kind === 'property'
        ? `Property ${i},sale,Private owner sentinel`
        : `Private lead sentinel ${i},sale,person${i}@example.test,walk_in`,
    ),
  ].join('\n');
  const before = await f.database.recordAuditEvent.count();
  const preview = await post('preview', { csv });
  expect(preview.body.valid).toBe(true);
  expect(await f.database.recordAuditEvent.count()).toBe(before);
  const input = {
    csv,
    digest: preview.body.digest,
    schemaVersion: kind === 'property' ? 1 : 2,
    submissionId,
  };
  const first = await post('commit', input);
  expect(first.status, JSON.stringify(first.body)).toBe(201);
  expect((await post('commit', input)).status).toBe(200);
  const ids: string[] = first.body[kind + 'Ids'];
  const rows = await f.database.recordAuditEvent.findMany({
    where: { importKind: kind },
  });
  expect(rows).toHaveLength(count + 1);
  const summary = rows.find((row) => row.action === 'import.completed')!;
  expect(summary).toMatchObject({
    entityType: 'import',
    createdCount: count,
    actorId: f.ids.manager,
    entityId: summary.importId,
  });
  expect(summary.importId).toBeTruthy();
  const created = rows.filter((row) => row.action === kind + '.created');
  expect(created.map((row) => row.entityId).sort()).toEqual([...ids].sort());
  expect(
    created.every(
      (row) => row.importId === summary.importId && row.createdCount === null,
    ),
  ).toBe(true);
  const retained = JSON.stringify(rows);
  for (const secret of [
    'Private lead sentinel',
    'Private owner sentinel',
    '@example.test',
    preview.body.digest,
  ])
    expect(retained).not.toContain(secret);
  return summary.importId;
}

it('audits each committed import exactly once and keeps identical submission IDs in different namespaces independent', async () => {
  const submissionId = randomUUID();
  const properties = await verifyBatch('property', submissionId);
  const leads = await verifyBatch('lead', submissionId);
  expect(properties).not.toBe(leads);
}, 30000);
it('rolls back imported records, individual events and the receipt when the summary is rejected', async () => {
  const submit = (route: string, input: object) =>
    request(f.app)
      .post('/api/v1/staff/properties/imports/' + route)
      .set('Cookie', f.cookies.manager!)
      .set('Origin', f.env.APP_ORIGIN)
      .send(input);
  const csv = 'title,purpose\nRollback one,sale\nRollback two,sale';
  const preview = await submit('preview', { csv });
  const input = {
    csv,
    schemaVersion: 1,
    submissionId: randomUUID(),
    digest: preview.body.digest,
  };
  const counts = () =>
    Promise.all([
      f.database.property.count(),
      f.database.propertyImportReceipt.count(),
      f.database.recordAuditEvent.count(),
    ]);
  const before = await counts();
  await f.database.$executeRawUnsafe(
    "CREATE TRIGGER reject_summary BEFORE INSERT ON RecordAuditEvent WHEN NEW.action='import.completed' BEGIN SELECT RAISE(ABORT,'fixture audit failure'); END",
  );
  try {
    expect((await submit('commit', input)).status).toBe(500);
    expect(await counts()).toEqual(before);
  } finally {
    await f.database.$executeRawUnsafe('DROP TRIGGER reject_summary');
  }
  expect((await submit('commit', input)).status).toBe(201);
});
