import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { leadFixture } from './lead-fixture.js';
import { createDashboardService } from '../src/modules/dashboard/dashboard.service.js';
import type { Actor } from '../src/modules/leads/leads.repository.js';
let f: Awaited<ReturnType<typeof leadFixture>>;
const at = '2026-10-29T08:00:00.000Z';
beforeEach(async () => {
  f = await leadFixture();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await f?.close();
});
function actor(
  role: 'admin' | 'manager' | 'agent' = 'manager',
  id = f.ids[role]!,
): Actor {
  return { id, name: role, role, sessionId: 'test' };
}
async function lead(
  createdAt: string,
  stage = 'new',
  assignedAgentId: string | null = null,
  source = 'website',
) {
  const row = await f.create();
  return f.database.lead.update({
    where: { id: row.id },
    data: { createdAt: new Date(createdAt), stage, assignedAgentId, source },
  });
}
it('counts 10/2/3, excludes future records and uses current assignment and stage', async () => {
  for (let i = 0; i < 10; i++)
    await lead(
      i < 3 ? at : '2026-10-01T00:00:00Z',
      i < 2 ? 'won' : 'new',
      i < 3 ? f.ids.agent! : i < 6 ? f.ids.other! : null,
      ['website', 'call', 'walk_in'][i % 3],
    );
  await lead('2026-10-29T08:00:00.001Z', 'won', f.ids.agent!);
  const service = createDashboardService(f.database, () => new Date(at));
  for (const role of ['admin', 'manager'] as const) {
    const dto = await service.summary(actor(role));
    expect(dto).toMatchObject({
      totalLeads: 10,
      wonLeads: 2,
      newLeadsThisWeek: 3,
      conversionRatePercent: 20,
      weekStart: '2026-10-25T20:00:00.000Z',
      weekEndExclusive: '2026-11-01T20:00:00.000Z',
    });
    expect(dto.leadsBySource.reduce((s, r) => s + r.count, 0)).toBe(10);
    expect(dto.pipelineByStage.reduce((s, r) => s + r.count, 0)).toBe(10);
  }
  expect(await service.summary(actor('agent'))).toMatchObject({
    scope: 'mine',
    totalLeads: 3,
    wonLeads: 2,
    conversionRatePercent: 66.7,
  });
  expect(await service.summary(actor('agent', f.ids.other!))).toMatchObject({
    totalLeads: 3,
    wonLeads: 0,
  });
  const won = await f.database.lead.findFirstOrThrow({
    where: { stage: 'won' },
  });
  await f.database.lead.update({
    where: { id: won.id },
    data: { stage: 'contacted', assignedAgentId: f.ids.other! },
  });
  expect(await service.summary(actor('agent'))).toMatchObject({
    totalLeads: 2,
    wonLeads: 1,
    conversionRatePercent: 50,
  });
});
it('includes exact Dubai Monday and generatedAt, excludes following Monday and rolls Sunday correctly', async () => {
  await lead('2026-10-25T19:59:59.999Z');
  await lead('2026-10-25T20:00:00.000Z');
  await lead('2026-11-01T19:59:59.999Z');
  await lead('2026-11-01T20:00:00.000Z');
  expect(
    await createDashboardService(
      f.database,
      () => new Date('2026-11-01T19:59:59.999Z'),
    ).summary(actor()),
  ).toMatchObject({
    totalLeads: 3,
    newLeadsThisWeek: 2,
    weekStart: '2026-10-25T20:00:00.000Z',
  });
  expect(
    await createDashboardService(
      f.database,
      () => new Date('2026-11-01T20:00:00.000Z'),
    ).summary(actor()),
  ).toMatchObject({
    totalLeads: 4,
    newLeadsThisWeek: 1,
    weekStart: '2026-11-01T20:00:00.000Z',
  });
});
it('propagates database failures rather than reporting empty success', async () => {
  vi.spyOn(f.database, '$transaction').mockRejectedValueOnce(
    new Error('private database failure'),
  );
  await expect(
    createDashboardService(f.database).summary(actor()),
  ).rejects.toThrow('private database failure');
});

it('keeps all aggregate reads on one SQLite snapshot during an interleaved committed write', async () => {
  const row = await lead(at, 'new');
  await f.database.$queryRawUnsafe('PRAGMA journal_mode = WAL');
  const { createDatabase } =
    await import('../src/infrastructure/database/client.js');
  const { createDashboardRepository } =
    await import('../src/modules/dashboard/dashboard.repository.js');
  const other = await createDatabase(f.env.DATABASE_URL);
  try {
    const result = await f.database.$transaction(async (tx) => {
      let first = true;
      const scoped = new Proxy(tx, {
        get(target, key) {
          if (key !== 'lead') return Reflect.get(target, key);
          return new Proxy(target.lead, {
            get(model, method) {
              if (method !== 'count') return Reflect.get(model, method);
              return async (args: Parameters<typeof model.count>[0]) => {
                const count = await model.count(args);
                if (first) {
                  first = false;
                  await other.lead.update({
                    where: { id: row.id },
                    data: { stage: 'won', source: 'call' },
                  });
                }
                return count;
              };
            },
          });
        },
      });
      return createDashboardRepository().aggregate(
        scoped,
        { createdAt: { lte: new Date(at) } },
        new Date('2026-10-25T20:00:00Z'),
        new Date('2026-11-01T20:00:00Z'),
      );
    });
    expect(result.totalLeads).toBe(1);
    expect(result.byStage).toEqual([{ stage: 'new', _count: { _all: 1 } }]);
    expect(result.bySource).toEqual([
      { source: 'website', _count: { _all: 1 } },
    ]);
    expect(
      (await f.database.lead.findUniqueOrThrow({ where: { id: row.id } }))
        .stage,
    ).toBe('won');
  } finally {
    await other.$disconnect();
  }
});
