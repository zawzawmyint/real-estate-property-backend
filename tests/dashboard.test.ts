import { afterEach, beforeEach, expect, it } from 'vitest';
import request from 'supertest';
import { leadFixture } from './lead-fixture.js';
let f: Awaited<ReturnType<typeof leadFixture>>;
beforeEach(async () => {
  f = await leadFixture();
});
afterEach(async () => {
  await f?.close();
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
