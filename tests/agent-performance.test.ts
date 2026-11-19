import { beforeAll, afterAll, expect, it } from 'vitest';
import request from 'supertest';
import { leadFixture } from './lead-fixture.js';
import { createAgentPerformanceService } from '../src/modules/reports/agent-performance/agent-performance.service.js';
import { parsePerformanceQuery } from '../src/modules/reports/agent-performance/agent-performance.schema.js';
import type { Actor } from '../src/modules/leads/leads.repository.js';
import type { Prisma } from '../src/generated/prisma/client.js';

const path = '/api/v1/staff/reports/agent-performance';
const fixed = new Date('2026-11-18T20:05:00Z');
let f: Awaited<ReturnType<typeof leadFixture>>;
beforeAll(async () => {
  f = await leadFixture();
});
afterAll(async () => {
  await f?.close();
});

function read(query = '', role = 'manager') {
  return request(f.app)
    .get(path + query)
    .set('Cookie', f.cookies[role]!);
}

it('rejects year zero and supports the earliest Dubai calendar day', async () => {
  const rejected = await read('?from=0000-01-01&to=0000-01-01');
  expect(rejected.status).toBe(400);
  expect(rejected.body.error.code).toBe('VALIDATION_ERROR');

  const earliest = await read('?from=0001-01-01&to=0001-01-01');
  expect(earliest.status).toBe(200);
  expect(earliest.body).toMatchObject({
    from: '0001-01-01',
    to: '0001-01-01',
    rangeStart: '0000-12-31T20:00:00.000Z',
    rangeEndExclusive: '0001-01-01T20:00:00.000Z',
    asOf: '0001-01-01T20:00:00.000Z',
  });
});

it('preserves the incoming owner across consecutive tied cycles in selected and self reports', async () => {
  const a = f.ids.agent!,
    b = f.ids.other!;
  const lead = await f.create({ assignedAgentId: a });
  await f.database.leadActivity.deleteMany({ where: { leadId: lead.id } });
  const epoch = Date.parse('2021-05-01T00:00:00Z');
  const history: Prisma.LeadActivityCreateManyInput[] = [
    {
      leadId: lead.id,
      type: 'created',
      nextAgentId: b,
      createdAt: new Date(epoch),
    },
    {
      leadId: lead.id,
      type: 'assigned',
      previousAgentId: b,
      nextAgentId: a,
      createdAt: new Date(epoch + 1000),
    },
  ];
  for (let i = 2; i <= 8; i++) {
    const group = {
      leadId: lead.id,
      type: 'assigned',
      createdAt: new Date(epoch + 1000 * i),
    };
    history.push(
      { ...group, previousAgentId: a, nextAgentId: b },
      { ...group, previousAgentId: b, nextAgentId: a },
    );
  }
  history.push({
    leadId: lead.id,
    type: 'call_logged',
    actorId: a,
    createdAt: new Date('2021-05-02T00:00:00Z'),
  });
  await f.database.leadActivity.createMany({ data: history });
  const dates = '?from=2021-05-02&to=2021-05-02';
  const agency = await read(dates);
  const row = agency.body.items.find(
    (item: { agent: { id: string } }) => item.agent.id === a,
  );
  expect(row).toMatchObject({ leadsHandled: 1, assignmentEpisodes: 0 });
  expect(agency.body.coverage.hasLimitations).toBe(false);
  for (const report of [
    await read(dates + '&agentId=' + a),
    await read(dates, 'agent'),
  ]) {
    expect(report.body.items).toEqual([row]);
    expect(report.body.coverage).toEqual(agency.body.coverage);
    expect(report.body.agentOptions).toEqual([row.agent]);
  }
});

it('uses the latest unanimous former-agent name before a conflicting group', async () => {
  const lead = await f.create();
  const id = 'former-name-conflict';
  const createdAt = new Date('2021-04-01T00:00:00Z');
  const base = { leadId: lead.id, type: 'assigned', nextAgentId: id };
  await f.database.leadActivity.createMany({
    data: [
      {
        ...base,
        nextAgentName: 'Earlier',
        createdAt: new Date('2021-03-31T00:00:00Z'),
      },
      { ...base, nextAgentName: 'Alice', createdAt },
      {
        ...base,
        nextAgentName: 'Alice',
        createdAt: new Date('2021-04-02T00:00:00Z'),
      },
      {
        ...base,
        nextAgentName: 'Alicia',
        createdAt: new Date('2021-04-02T00:00:00Z'),
      },
      {
        ...base,
        nextAgentName: 'Future',
        createdAt: new Date('2021-04-05T00:00:00Z'),
      },
    ],
  });
  const q = '?from=2021-04-03&to=2021-04-03&agentId=' + id;
  expect((await read(q)).body.agentOptions).toEqual([
    { id, name: 'Alice', availability: 'former' },
  ]);
  await f.database.leadActivity.deleteMany({
    where: { nextAgentId: id, createdAt: { lte: createdAt } },
  });
  expect((await read(q)).body.agentOptions).toEqual([
    { id, name: 'Former agent', availability: 'former' },
  ]);
});

it('authenticates before parsing, rejects scope changes and returns only the exact private aggregate shape', async () => {
  const anonymous = await request(f.app).get(path + '?unexpected=1');
  expect(anonymous.status).toBe(401);
  expect(anonymous.headers['cache-control']).toBe('no-store');
  for (const id of [f.ids.other!, 'unknown']) {
    expect((await read('?agentId=' + id, 'agent')).status).toBe(403);
  }
  expect((await read('?agentId=unknown')).status).toBe(404);
  const result = await read('', 'agent');
  expect(result.status).toBe(200);
  expect(result.headers['cache-control']).toBe('no-store');
  expect(Object.keys(result.body).sort()).toEqual(
    [
      'generatedAt',
      'timezone',
      'from',
      'to',
      'rangeStart',
      'rangeEndExclusive',
      'asOf',
      'scope',
      'page',
      'pageSize',
      'total',
      'items',
      'agentOptions',
      'coverage',
    ].sort(),
  );
  const agent = { id: f.ids.agent, name: 'agent', availability: 'active' };
  expect(result.body).toMatchObject({
    scope: 'mine',
    page: 1,
    pageSize: 25,
    total: 1,
    agentOptions: [agent],
  });
  expect(result.body.items).toEqual([
    {
      agent,
      leadsHandled: 0,
      dealsClosed: 0,
      assignmentEpisodes: 0,
      completedFollowUps: 0,
      averageFirstFollowUpSeconds: null,
      awaitingFollowUp: 0,
      endedWithoutFollowUp: 0,
    },
  ]);
  expect(result.body.coverage).toEqual({
    excludedActionCount: 0,
    excludedAssignmentEpisodeCount: 0,
    unattributedFirstWinCount: 0,
    hasLimitations: false,
  });
});

it('rejects unknown, repeated, malformed, future, overlong and unpaired filters', async () => {
  for (const query of [
    '?from=2024-01-01',
    '?to=2024-01-01',
    '?from=2025-02-29&to=2025-03-01',
    '?from=2024-01-01&to=2025-01-01',
    '?from=2025-02-01&to=2025-01-01',
    '?from=9999-01-01&to=9999-01-01',
    '?from=2024-2-29&to=2024-03-01',
    '?scope=agency',
    '?page=1&page=1',
    '?agentId[]=a',
    '?agentId=',
    '?page=0',
    '?page=1e2',
    '?pageSize=26',
    '?agentId=' + 'x'.repeat(129),
  ]) {
    const r = await read(query);
    expect([query, r.status, r.body.error?.code]).toEqual([
      query,
      400,
      'VALIDATION_ERROR',
    ]);
  }
  const r = await read('?from=2024-01-01&to=2024-12-31&page=100&pageSize=50');
  expect(r.body).toMatchObject({
    items: [],
    total: 2,
    page: 100,
    pageSize: 50,
  });
});

it('captures Dubai today once, checks the current role and rejects invalidated sessions', async () => {
  let calls = 0;
  const service = createAgentPerformanceService(f.database, () => {
    calls++;
    return fixed;
  });
  const session = await f.database.session.findFirstOrThrow({
    where: { userId: f.ids.manager! },
  });
  const identity: Actor = {
    id: f.ids.manager!,
    sessionId: session.id,
    role: 'manager',
    name: 'manager',
  };
  await f.database.user.update({
    where: { id: identity.id },
    data: { role: 'agent' },
  });
  try {
    expect(
      await service.report(identity, parsePerformanceQuery('/')),
    ).toMatchObject({
      scope: 'mine',
      from: '2026-11-01',
      to: '2026-11-19',
      rangeStart: '2026-10-31T20:00:00.000Z',
      asOf: fixed.toISOString(),
      total: 1,
    });
    expect(calls).toBe(1);
    await f.database.session.update({
      where: { id: session.id },
      data: { expiresAt: new Date(0) },
    });
    await expect(
      service.report(identity, parsePerformanceQuery('/')),
    ).rejects.toMatchObject({ status: 401 });
  } finally {
    await f.database.user.update({
      where: { id: identity.id },
      data: { role: 'manager' },
    });
    await f.database.session.update({
      where: { id: session.id },
      data: { expiresAt: session.expiresAt },
    });
  }
});

it('uses pre-range ownership and first Won context, historical boundary witnesses, and former snapshots', async () => {
  const lead = await f.create({ assignedAgentId: f.ids.other });
  await f.database.leadActivity.deleteMany({ where: { leadId: lead.id } });
  const times = [
    '2024-01-31T20:00:00Z',
    '2024-02-01T20:00:00Z',
    '2024-02-01T21:00:00Z',
    '2024-02-02T20:00:00Z',
    '2024-02-03T20:00:00Z',
  ];
  const base = { leadId: lead.id };
  const former = 'former/non-uuid';
  await f.database.leadActivity.createMany({
    data: [
      {
        ...base,
        type: 'created',
        nextAgentId: former,
        nextAgentName: 'Historical',
        createdAt: new Date(times[0]!),
      },
      {
        ...base,
        type: 'stage_changed',
        nextStage: 'won',
        previousStage: 'new',
        createdAt: new Date(times[1]!),
      },
      {
        ...base,
        type: 'stage_changed',
        nextStage: 'new',
        previousStage: 'won',
        createdAt: new Date(times[2]!),
      },
      {
        ...base,
        type: 'assigned',
        previousAgentId: former,
        previousAgentName: 'Later name',
        nextAgentId: f.ids.other!,
        createdAt: new Date(times[3]!),
      },
      {
        ...base,
        type: 'stage_changed',
        previousStage: 'new',
        nextStage: 'won',
        createdAt: new Date(times[4]!),
      },
    ],
  });
  const q =
    '?from=2024-02-02&to=2024-02-02&agentId=' + encodeURIComponent(former);
  const r = await read(q);
  expect(r.status).toBe(200);
  expect(r.body).toMatchObject({
    items: [
      {
        agent: { id: former, name: 'Historical', availability: 'former' },
        dealsClosed: 1,
        assignmentEpisodes: 0,
      },
    ],
    total: 1,
    rangeEndExclusive: '2024-02-02T20:00:00.000Z',
  });
  expect((await read('?from=2024-02-04&to=2024-02-04')).body.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        agent: expect.objectContaining({ id: f.ids.other }),
        dealsClosed: 0,
      }),
    ]),
  );
  const empty = await read(
    '?from=2024-02-09&to=2024-02-10&agentId=' + encodeURIComponent(former),
  );
  expect(empty.body).toMatchObject({
    total: 1,
    items: [
      { agent: { name: 'Later name' }, assignmentEpisodes: 0, dealsClosed: 0 },
    ],
  });
});

it('credits work before balanced future handovers only with a connected independent witness', async () => {
  const a = f.ids.agent!;
  const b = f.ids.other!;
  const lead = await f.create({ assignedAgentId: a });
  const leadId = lead.id;
  await f.database.leadActivity.deleteMany({ where: { leadId } });
  const time = Date.parse('2022-09-01T19:59:56Z');
  const at = (seconds: number) => new Date(time + seconds * 1000);
  const edge = (
    seconds: number,
    previousAgentId: string,
    nextAgentId: string,
  ) => ({
    leadId,
    type: 'assigned',
    previousAgentId,
    nextAgentId,
    createdAt: at(seconds),
  });
  await f.database.leadActivity.createMany({
    data: [
      { leadId, type: 'created', nextAgentId: a, createdAt: at(1) },
      { leadId, type: 'call_logged', actorId: a, createdAt: at(2) },
      edge(5, a, b),
      edge(5, b, a),
    ],
  });
  const query = '?from=2022-09-01&to=2022-09-01';
  async function check(credited: boolean) {
    const response = await read(query, 'agent');
    expect(response.status).toBe(200);
    expect(response.body.items[0]).toMatchObject({
      leadsHandled: credited ? 1 : 0,
      completedFollowUps: credited ? 1 : 0,
      averageFirstFollowUpSeconds: credited ? 1 : null,
    });
    expect(response.body.coverage).toEqual({
      excludedActionCount: credited ? 0 : 1,
      excludedAssignmentEpisodeCount: credited ? 0 : 1,
      unattributedFirstWinCount: 0,
      hasLimitations: !credited,
    });
  }
  await check(true);
  await f.database.leadActivity.createMany({
    data: [edge(6, a, 'third'), edge(6, 'third', a), edge(7, a, b)],
  });
  await f.database.lead.update({
    where: { id: leadId },
    data: { assignedAgentId: b },
  });
  await check(true);
  await f.database.leadActivity.updateMany({
    where: { leadId, createdAt: at(7) },
    data: { previousAgentId: b, nextAgentId: 'third' },
  });
  await check(false);
  await f.database.leadActivity.updateMany({
    where: { leadId, createdAt: at(7) },
    data: { previousAgentId: null, previousAgentName: 'Former A' },
  });
  await check(false);
  await f.database.leadActivity.updateMany({
    where: { leadId, createdAt: at(7) },
    data: { previousAgentId: a, previousAgentName: null },
  });
  await f.database.leadActivity.createMany({
    data: [edge(6, 'x', 'y'), edge(6, 'y', 'x')],
  });
  await check(false);
});

it('uses the unique predecessor of a connected post-cutoff handover chain', async () => {
  const lead = await f.create({ assignedAgentId: f.ids.other });
  await f.database.leadActivity.deleteMany({ where: { leadId: lead.id } });
  const start = new Date('2023-06-01T00:00:00Z');
  const later = new Date('2023-06-02T00:00:00Z');
  const base = { leadId: lead.id };
  const id = f.ids.agent!;
  await f.database.leadActivity.createMany({
    data: [
      { ...base, type: 'created', nextAgentId: id, createdAt: start },
      {
        ...base,
        type: 'assigned',
        previousAgentId: 'intermediate',
        nextAgentId: f.ids.other!,
        createdAt: later,
      },
      {
        ...base,
        type: 'assigned',
        previousAgentId: id,
        nextAgentId: 'intermediate',
        createdAt: later,
      },
    ],
  });
  const q = '?from=2023-06-01&to=2023-06-01&agentId=' + id;
  expect((await read(q)).body.items[0]).toMatchObject({
    assignmentEpisodes: 1,
    awaitingFollowUp: 1,
  });
  await f.database.leadActivity.createMany({
    data: [
      {
        ...base,
        type: 'assigned',
        previousAgentId: 'isolated1',
        nextAgentId: 'isolated2',
        createdAt: later,
      },
      {
        ...base,
        type: 'assigned',
        previousAgentId: 'isolated2',
        nextAgentId: 'isolated1',
        createdAt: later,
      },
    ],
  });
  const broken = await read(q);
  expect(broken.body.coverage.excludedAssignmentEpisodeCount).toBe(1);
  expect(broken.body.items[0].awaitingFollowUp).toBe(0);
});
