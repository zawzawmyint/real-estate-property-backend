import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import request from 'supertest';
import { leadFixture } from './lead-fixture.js';
import { createAuditLogService } from '../src/modules/audit-log/audit-log.service.js';
import {
  parseListQuery,
  parseActorQuery,
} from '../src/modules/audit-log/audit-log.schema.js';
import type { Actor } from '../src/modules/leads/leads.repository.js';

let f: Awaited<ReturnType<typeof leadFixture>>;
const path = '/api/v1/staff/audit-log',
  dates = '?from=2026-01-01T00:00:00Z&to=2026-01-02T00:00:00Z',
  target = randomUUID(),
  group = randomUUID();
const ids = Array.from({ length: 4 }, () => randomUUID()).sort();
const read = (suffix: string, role = 'manager') =>
  request(f.app)
    .get(path + suffix)
    .set('Cookie', f.cookies[role]!);
beforeAll(async () => {
  f = await leadFixture();
  const base = {
    occurredAt: new Date('2026-01-01T00:00:00Z'),
    actorKind: 'staff',
    actorId: 'historic',
    actorName: 'Former',
    actorRole: 'agent',
    action: 'property.created',
    entityType: 'property',
    entityId: target,
    entityLabel: '<Marina>',
    changesJson: '[]',
    importId: group,
    importKind: 'property',
  };
  await f.database.property.create({
    data: { id: target, title: '<Marina>', purpose: 'sale' },
  });
  await f.database.recordAuditEvent.createMany({
    data: [
      { ...base, id: ids[0]! },
      { ...base, id: ids[1]!, actorName: '%_ Snapshot', actorRole: 'admin' },
      {
        ...base,
        id: ids[2]!,
        actorKind: 'website',
        actorId: null,
        actorName: null,
        actorRole: null,
        action: 'lead.created',
        entityType: 'lead',
        entityId: randomUUID(),
        importId: null,
        importKind: null,
      },
      {
        ...base,
        id: ids[3]!,
        occurredAt: new Date('2026-01-02T00:00:00Z'),
        actorId: 'other-history',
      },
    ],
  });
});
afterAll(async () => {
  await f?.close();
});

it('checks current roles and sessions before malformed queries on both endpoints', async () => {
  for (const suffix of ['?bad=1', '/actors?bad=1']) {
    expect((await request(f.app).get(path + suffix)).status).toBe(401);
    const denied = await read(suffix, 'agent');
    expect(denied.status).toBe(403);
    expect(denied.headers['cache-control']).toContain('no-store');
    const invalid = await read(suffix);
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('INVALID_INPUT');
  }
  const id = f.ids.other!,
    session = await f.database.session.findFirstOrThrow({
      where: { userId: id },
    });
  const stale: Actor = {
    id,
    sessionId: session.id,
    name: 'previous manager',
    role: 'manager',
  };
  const service = createAuditLogService(f.database);
  for (const run of [service.list, service.actors])
    await expect(
      run(() => {
        throw new Error('Must authorize before parsing');
      }, stale),
    ).rejects.toMatchObject({ status: 403 });
  await f.database.session.delete({ where: { id: session.id } });
  for (const run of [service.list, service.actors])
    await expect(
      run(() => {
        throw new Error('Must authorize before parsing');
      }, stale),
    ).rejects.toMatchObject({ status: 401 });
});

it('reads typed deferred filters after current transaction authorization', async () => {
  const session = await f.database.session.findFirstOrThrow({
    where: { userId: f.ids.manager! },
  });
  const identity: Actor = {
    id: f.ids.manager!,
    sessionId: session.id,
    name: 'Manager',
    role: 'manager',
  };
  const service = createAuditLogService(f.database);
  const query = vi.fn(() => parseListQuery(dates));
  expect(await service.list(query, identity)).toMatchObject({ total: 3 });
  expect(query).toHaveBeenCalledOnce();
  const actors = vi.fn(() => parseActorQuery('/actors?q=%25_'));
  expect(await service.actors(actors, identity)).toMatchObject({
    total: 1,
    items: [{ id: 'historic', name: '%_ Snapshot', role: 'admin' }],
  });
  expect(actors).toHaveBeenCalledOnce();
});

it('applies interval boundaries, descending tie-break and consistent pages for both readers', async () => {
  const first = await read(dates + '&pageSize=1');
  expect(first.status).toBe(200);
  expect(first.body).toMatchObject({
    total: 3,
    page: 1,
    pageSize: 1,
    items: [
      {
        id: ids[2],
        actor: { kind: 'website', id: null, name: null, role: null },
      },
    ],
    coverage: { version: 1, historicalBackfill: false },
  });
  expect(Date.parse(first.body.coverage.startedAt)).toBeGreaterThan(0);
  expect((await read(dates + '&pageSize=1', 'admin')).body).toEqual(first.body);
  expect((await read(dates + '&page=2&pageSize=1')).body.items[0].id).toBe(
    ids[1],
  );
  expect((await read(dates + '&page=3000000000')).body).toMatchObject({
    total: 3,
    items: [],
  });
  expect((await read(dates + '&actorKind=website')).body.total).toBe(1);
  expect((await read(dates + '&actorKind=system')).body.total).toBe(0);
});

it('intersects record/actor/action/import filters and retains deleted target availability', async () => {
  const query =
    dates +
    '&entityType=property&entityId=' +
    target +
    '&action=property.created&importId=' +
    group +
    '&actorId=historic';
  expect((await read(query)).body).toMatchObject({
    total: 2,
    items: [{ entity: { available: true } }, { entity: { available: true } }],
  });
  await f.database.property.delete({ where: { id: target } });
  expect((await read(query)).body).toMatchObject({
    total: 2,
    items: [
      { entity: { available: false, label: '<Marina>' } },
      { entity: { available: false } },
    ],
  });
  expect((await read(query.replace(target, randomUUID()))).body).toMatchObject({
    total: 0,
    items: [],
  });
});

it('selects latest tied snapshot before literal actor search and keeps historical identities', async () => {
  expect((await read('/actors?q=%25_')).body).toEqual({
    items: [{ id: 'historic', name: '%_ Snapshot', role: 'admin' }],
    page: 1,
    pageSize: 20,
    total: 1,
  });
  expect((await read('/actors?q=Former')).body.items).toEqual([
    { id: 'other-history', name: 'Former', role: 'agent' },
  ]);
  expect((await read('/actors?page=4&pageSize=1')).body).toMatchObject({
    items: [],
    total: 2,
  });
});

it('rejects duplicate, incompatible and unbounded filters, including unsafe offsets', () => {
  for (const invalid of [
    '&page=0',
    '&page=1.5',
    '&pageSize=101',
    '&page=9007199254740991',
    '&from=x',
    '&actorKind=staff&actorId=abc',
    '&action=lead.updated&entityType=task',
    '&entityId=' + target,
    '&entityType=bogus',
    '&importId=x',
    '&actorId=',
    '&unknown=x',
  ])
    expect(() => parseListQuery(dates + invalid)).toThrow();
  for (const invalid of [
    '?from=2026-01-01&to=2026-01-02',
    '?from=2026-02-30T00:00:00Z&to=2026-03-03T00:00:00Z',
    '?from=2026-01-01T00:00:00Z&to=2026-04-04T00:00:01Z',
  ])
    expect(() => parseListQuery(invalid)).toThrow();
  expect(
    parseListQuery(
      '?from=2026-01-01T04:00:00%2B04:00&to=2026-04-04T00:00:00Z',
    ).from.toISOString(),
  ).toBe('2026-01-01T00:00:00.000Z');
  for (const invalid of ['?q=' + 'x'.repeat(101), '?q=a&q=b', '?actorId=a'])
    expect(() => parseActorQuery(invalid)).toThrow();
});
