import { afterAll, beforeAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { leadFixture } from './lead-fixture.js';
import { normalizeSearchText } from '../src/shared/search/normalize-search-text.js';
let f: Awaited<ReturnType<typeof leadFixture>>;
beforeAll(async () => {
  f = await leadFixture();
});
afterAll(() => f.close());
it('paginates/counts literal normalized searches in SQLite with realistic owned fixtures', async () => {
  const rows = Array.from({ length: 2400 }, (_, index) => {
    const name = index % 2 ? 'Étage %_ Contact' : 'Contact';
    return {
      id: randomUUID(),
      name,
      email: `contact${index}@example.test`,
      phone: '+971 (50) 123-4567',
      searchName: normalizeSearchText(name),
      searchEmail: `contact${index}@example.test`,
      searchPhone: '971501234567',
      searchPropertyTitle: '',
      purpose: 'sale',
      source: 'call',
      assignedAgentId: index < 1200 ? f.ids.agent! : f.ids.other!,
    };
  });
  await f.database.lead.createMany({ data: rows });
  const page = await f.read('?q=ÉTAGE%20%25_&page=2', 'agent');
  expect(page.status).toBe(200);
  expect(page.body.total).toBe(600);
  expect(page.body.items).toHaveLength(20);
  expect(page.body.page).toBe(2);
  expect(
    new Set(page.body.items.map((item: { id: string }) => item.id)).size,
  ).toBe(20);
  expect((await f.read('?q=971%2050%20123', 'agent')).body.total).toBe(1200);
  const plan = await f.database.$queryRaw<
    Array<{ detail: string }>
  >`EXPLAIN QUERY PLAN SELECT id FROM Lead WHERE assignedAgentId=${f.ids.agent!} AND instr(searchName,${'étage'})>0 ORDER BY createdAt DESC,id DESC LIMIT 20`;
  expect(plan.map((row) => row.detail).join(' ')).toContain(
    'Lead_assignedAgentId_createdAt_id_idx',
  );
});
