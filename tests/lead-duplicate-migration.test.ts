import { afterAll, expect, it } from 'vitest';
import { authFixture } from './auth-fixture.js';
import {
  backfillLeadPhoneCanonical,
  verifyLeadPhoneCanonical,
} from '../src/modules/leads/lead-phone-backfill.js';
const f = await authFixture();
afterAll(() => f.close());
it('backfills recognizable historical phones idempotently without touching display, version or timestamps', async () => {
  const values = ['0501234567', '+971 (50) 123-4567', '0012345', null];
  const rows = await Promise.all(
    values.map((phone) =>
      f.database.lead.create({
        data: {
          searchName: '',
          searchPhone: '',
          searchEmail: '',
          searchPropertyTitle: '',
          name: 'Historical',
          phone,
          purpose: 'sale',
          source: 'call',
          email: 'a@example.test',
        },
      }),
    ),
  );
  await expect(verifyLeadPhoneCanonical(f.database)).rejects.toThrow(
    'inconsistent',
  );
  await backfillLeadPhoneCanonical(f.database);
  await backfillLeadPhoneCanonical(f.database);
  await verifyLeadPhoneCanonical(f.database);
  for (let i = 0; i < rows.length; i++) {
    const row = await f.database.lead.findUniqueOrThrow({
      where: { id: rows[i]!.id },
    });
    expect(row).toEqual({
      ...rows[i],
      phoneCanonical: i < 2 ? '+971501234567' : null,
    });
  }
  const plan = await f.database.$queryRaw<
    Array<{ detail: string }>
  >`EXPLAIN QUERY PLAN SELECT id FROM Lead WHERE phoneCanonical=${'+971501234567'}`;
  expect(plan.map((row) => row.detail).join(' ')).toContain(
    'Lead_phoneCanonical_idx',
  );
});
