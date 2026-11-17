import { afterAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { leadFixture } from './lead-fixture.js';
const f = await leadFixture();
afterAll(() => f.close());
it('counts other accessible leads across filters before pagination and keeps export parity', async () => {
  const rows = Array.from({ length: 45 }, (_, i) => ({
    id: randomUUID(),
    name: `Duplicate ${i}`,
    phone: '0505556677',
    phoneCanonical: '+971505556677',
    searchName: `duplicate ${i}`,
    searchEmail: '',
    searchPhone: '0505556677',
    searchPropertyTitle: '',
    purpose: 'sale',
    source: 'call',
    stage: i < 22 ? 'won' : 'lost',
    assignedAgentId: i < 30 ? f.ids.agent! : f.ids.other!,
  }));
  await f.database.lead.createMany({ data: rows });
  await f.create({ name: 'Non duplicate' }, 'agent');
  const list = await f.read('?duplicates=only&stage=won&page=2', 'agent');
  expect(list.body.total).toBe(22);
  expect(list.body.items).toHaveLength(2);
  expect(list.body.items[0].duplicateCount).toBe(29);
  const csv = await f.read('/export?duplicates=only&stage=won', 'agent');
  expect(csv.status).toBe(200);
  expect(csv.text.split('\r\n').filter(Boolean)).toHaveLength(23);
  expect((await f.read('?view=all&duplicates=only')).body.total).toBe(45);
  const review = await f
    .write('post', '/duplicate-check', 'agent')
    .send({ phone: '0505556677' });
  expect(review.body.totalMatches).toBe(30);
  expect(review.body.matches).toHaveLength(20);
  expect(review.body.truncated).toBe(true);
});
it('handles maximum warning batch against 10000 indexed disposable leads within local targets', async () => {
  const rows = Array.from({ length: 10000 }, (_, i) => ({
    id: randomUUID(),
    name: `Seed ${i}`,
    phone: '0506667788',
    phoneCanonical: '+971506667788',
    searchName: `seed ${i}`,
    searchEmail: '',
    searchPhone: '0506667788',
    searchPropertyTitle: '',
    purpose: 'sale',
    source: 'call',
  }));
  await f.database.lead.createMany({ data: rows });
  const csv =
    'name,phone,purpose,source\n' +
    Array.from(
      { length: 500 },
      (_, i) => `Import ${i},0506667788,sale,call`,
    ).join('\n');
  let started = performance.now();
  const preview = await f.write('post', '/imports/preview').send({ csv });
  const previewMs = performance.now() - started;
  expect(preview.status).toBe(200);
  expect(preview.body.duplicateReview.existingMatchRows).toBe(500);
  expect(preview.body.duplicateReview.warnings[0].existingMatchCount).toBe(
    10000,
  );
  expect(previewMs).toBeLessThan(5000);
  started = performance.now();
  const commit = await f.write('post', '/imports/commit').send({
    csv,
    submissionId: randomUUID(),
    schemaVersion: 2,
    digest: preview.body.digest,
    duplicateAcknowledgement: {
      reviewToken: preview.body.duplicateReview.reviewToken,
    },
  });
  const commitMs = performance.now() - started;
  console.info(
    `P2-05 max warning batch / 10000 leads: preview ${previewMs.toFixed(0)}ms, commit ${commitMs.toFixed(0)}ms; Node ${process.version}, ${process.platform}/${process.arch}`,
  );
  expect(commit.status, JSON.stringify(commit.body)).toBe(201);
  expect(commit.body.createdCount).toBe(500);
  expect(commitMs).toBeLessThan(15000);
}, 30000);
