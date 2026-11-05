import { afterEach, beforeEach, expect, it } from 'vitest';
import request from 'supertest';
import { leadFixture } from './lead-fixture.js';
import { createDashboardService } from '../src/modules/dashboard/dashboard.service.js';
import { createLeadService } from '../src/modules/leads/leads.service.js';
import { createTaskService } from '../src/modules/tasks/tasks.service.js';
import { createViewingService } from '../src/modules/viewings/viewings.service.js';
import {
  listSchema,
  parseQuery as leadQuery,
} from '../src/modules/leads/leads.schema.js';
import { parseQuery as taskQuery } from '../src/modules/tasks/tasks.schema.js';
import { parseQuery as viewingQuery } from '../src/modules/viewings/viewings.schema.js';
import type { Actor } from '../src/modules/leads/leads.repository.js';
let f: Awaited<ReturnType<typeof leadFixture>>;
beforeEach(async () => {
  f = await leadFixture();
});
afterEach(async () => {
  await f?.close();
});
async function capturedActor(): Promise<Actor> {
  const session = await f.database.session.findFirstOrThrow({
    where: { userId: f.ids.manager! },
  });
  return {
    id: f.ids.manager!,
    name: 'manager',
    role: 'manager',
    sessionId: session.id,
  };
}
it('revalidates captured staff identities in every service after session or user state changes', async () => {
  const identity = await capturedActor();
  const original = await f.database.session.findUniqueOrThrow({
    where: { id: identity.sessionId },
  });
  const services = [
    () =>
      createLeadService(f.database).list(leadQuery(listSchema, '/'), identity),
    () => createTaskService(f.database).list(taskQuery('/'), identity),
    () =>
      createViewingService(f.database).list(
        viewingQuery('/?from=2026-11-01T00:00:00Z&to=2026-11-08T00:00:00Z'),
        identity,
      ),
    () => createDashboardService(f.database).summary(identity),
  ];
  const changes = [
    () =>
      f.database.session.update({
        where: { id: identity.sessionId },
        data: { expiresAt: new Date(0) },
      }),
    () =>
      f.database.session.update({
        where: { id: identity.sessionId },
        data: { userId: f.ids.agent! },
      }),
    () =>
      f.database.user.update({
        where: { id: identity.id },
        data: { disabled: true },
      }),
    () =>
      f.database.user.update({
        where: { id: identity.id },
        data: { banned: true },
      }),
    () =>
      f.database.user.update({
        where: { id: identity.id },
        data: { role: 'visitor' },
      }),
    () =>
      f.database.user.update({
        where: { id: identity.id },
        data: { credentialVersion: original.credentialVersion + 1 },
      }),
    () => f.database.session.delete({ where: { id: identity.sessionId } }),
  ];
  for (const change of changes) {
    await change();
    for (const invoke of services)
      await expect(invoke()).rejects.toMatchObject({
        status: 401,
        code: 'UNAUTHENTICATED',
      });
    await f.database.user.update({
      where: { id: identity.id },
      data: {
        disabled: false,
        banned: false,
        role: 'manager',
        credentialVersion: original.credentialVersion,
      },
    });
    await f.database.session.upsert({
      where: { id: original.id },
      create: original,
      update: original,
    });
  }
});
it('scopes dashboard counts using the current role after actor capture', async () => {
  const identity = await capturedActor();
  await f.create({ assignedAgentId: f.ids.agent });
  await f.create();
  await f.database.user.update({
    where: { id: identity.id },
    data: { role: 'agent' },
  });
  expect(
    await createDashboardService(f.database).summary(identity),
  ).toMatchObject({ scope: 'mine', totalLeads: 0 });
  await f.database.user.update({
    where: { id: identity.id },
    data: { role: 'manager' },
  });
  expect(
    await createDashboardService(f.database).summary({
      ...identity,
      role: 'agent',
    }),
  ).toMatchObject({ scope: 'agency', totalLeads: 2 });
});
it('requires live staff authentication before rejecting scope injection and never caches', async () => {
  const anonymous = await request(f.app).get(
    '/api/v1/staff/dashboard?scope=agency',
  );
  expect(anonymous.status).toBe(401);
  expect(anonymous.headers['cache-control']).toBe('no-store');
  for (const query of ['?scope=agency', '?agentId=other', '?x=1&x=2']) {
    const response = await request(f.app)
      .get('/api/v1/staff/dashboard' + query)
      .set('Cookie', f.cookies.agent!);
    expect(response.status).toBe(400);
    expect(response.headers['cache-control']).toBe('no-store');
  }
});
it('returns an exact private aggregate DTO with zero-filled canonical categories', async () => {
  const response = await request(f.app)
    .get('/api/v1/staff/dashboard')
    .set('Cookie', f.cookies.manager!);
  expect(response.status).toBe(200);
  expect(response.headers['cache-control']).toBe('no-store');
  expect(Object.keys(response.body).sort()).toEqual(
    [
      'generatedAt',
      'scope',
      'timezone',
      'weekStart',
      'weekEndExclusive',
      'totalLeads',
      'newLeadsThisWeek',
      'wonLeads',
      'conversionRatePercent',
      'leadsBySource',
      'pipelineByStage',
    ].sort(),
  );
  expect(response.body).toMatchObject({
    scope: 'agency',
    totalLeads: 0,
    wonLeads: 0,
    newLeadsThisWeek: 0,
    conversionRatePercent: null,
  });
  expect(response.body.leadsBySource).toEqual(
    ['website', 'call', 'walk_in'].map((source) => ({ source, count: 0 })),
  );
  expect(response.body.pipelineByStage).toEqual(
    ['new', 'contacted', 'viewing_scheduled', 'offer', 'won', 'lost'].map(
      (stage) => ({ stage, count: 0 }),
    ),
  );
});

it('revokes sessions and rejects unsupported roles, with safe database failures', async () => {
  await f.database.session.deleteMany({ where: { userId: f.ids.agent! } });
  const revoked = await request(f.app)
    .get('/api/v1/staff/dashboard')
    .set('Cookie', f.cookies.agent!);
  expect(revoked.status).toBe(401);
  expect(revoked.headers['cache-control']).toBe('no-store');
  await f.database.user.update({
    where: { id: f.ids.other! },
    data: { role: 'visitor' },
  });
  expect(
    (
      await request(f.app)
        .get('/api/v1/staff/dashboard')
        .set('Cookie', f.cookies.other!)
    ).status,
  ).toBe(401);
  const { vi } = await import('vitest');
  const failure = vi
    .spyOn(f.database, '$transaction')
    .mockRejectedValueOnce(new Error('secret internals'));
  try {
    const response = await request(f.app)
      .get('/api/v1/staff/dashboard')
      .set('Cookie', f.cookies.manager!);
    expect(response.status).toBe(500);
    expect(response.body.error).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    });
    expect(JSON.stringify(response.body)).not.toContain('secret');
    expect(response.headers['cache-control']).toBe('no-store');
  } finally {
    failure.mockRestore();
  }
});
