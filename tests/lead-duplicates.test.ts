import { afterAll, expect, it } from 'vitest';
import { leadFixture } from './lead-fixture.js';
const f = await leadFixture();
afterAll(() => f.close());
it('guards visible duplicate writes, scope and receipt-first retry', async () => {
  const first = await f.create({ phone: '0501234567' });
  const review = await f
    .write('post', '/duplicate-check')
    .send({ phone: '00971501234567' });
  expect(review.status).toBe(200);
  expect(review.body.totalMatches).toBe(1);
  const body = {
    submissionId: crypto.randomUUID(),
    name: 'Repeat',
    phone: '+971501234567',
    purpose: 'sale',
    source: 'call',
  };
  const denied = await f.write('post').send(body);
  expect(denied.status).toBe(409);
  expect(denied.body.error.code).toBe('LEAD_DUPLICATE_REVIEW_REQUIRED');
  const saved = await f.write('post').send({
    ...body,
    duplicateAcknowledgement: { reviewToken: review.body.reviewToken },
  });
  expect(saved.status).toBe(201);
  expect((await f.write('post').send(body)).status).toBe(200);
  const hidden = await f
    .write('post', '/duplicate-check', 'agent')
    .send({ phone: '0501234567' });
  expect(hidden.body.totalMatches).toBe(0);
  expect(
    (
      await f
        .write('post', '/duplicate-check', 'agent')
        .send({ phone: '0501234567', excludeLeadId: first.id })
    ).status,
  ).toBe(404);
  expect((await f.read('?view=all&duplicates=only')).body.total).toBe(2);
  expect((await f.read(`/${first.id}`)).body.duplicateCount).toBe(1);
});
it('reports all same-file rows and atomically requires batch acknowledgement', async () => {
  const csv =
    'name,phone,purpose,source\nFirst,0509998877,sale,call\nSecond,+971509998877,sale,call';
  const preview = await f.write('post', '/imports/preview').send({ csv });
  expect(preview.body.schemaVersion).toBe(2);
  expect(preview.body.duplicateReview.affectedRows).toBe(2);
  const body = {
    csv,
    submissionId: crypto.randomUUID(),
    schemaVersion: 2,
    digest: preview.body.digest,
  };
  expect(
    (await f.write('post', '/imports/commit').send(body)).body.error.code,
  ).toBe('IMPORT_DUPLICATE_REVIEW_REQUIRED');
  expect(
    (
      await f.write('post', '/imports/commit').send({
        ...body,
        duplicateAcknowledgement: {
          reviewToken: preview.body.duplicateReview.reviewToken,
        },
      })
    ).status,
  ).toBe(201);
  expect((await f.write('post', '/imports/commit').send(body)).status).toBe(
    200,
  );
});
