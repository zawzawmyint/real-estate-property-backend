import request from 'supertest';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { authFixture } from './auth-fixture.js';
const fixture = await authFixture();
const cookies: Record<string, string> = {};
const ids: Record<string, string> = {};
beforeAll(async () => {
  for (const role of ['admin', 'manager', 'agent'] as const) {
    const user = await fixture.operator.create({
      name: role,
      email: `${role}@csv.test`,
      password: 'Test-password-123!',
      role,
    });
    ids[role] = user.id;
    const login = await request(fixture.app)
      .post('/api/v1/auth/sign-in/email')
      .set('Origin', fixture.env.APP_ORIGIN)
      .send({
        email: `${role}@csv.test`,
        password: 'Test-password-123!',
        rememberMe: true,
      });
    cookies[role] = (
      login.headers['set-cookie'] as unknown as string[]
    )[0]!.split(';')[0]!;
  }
});
afterAll(() => fixture.close());
const read = (kind: string, query = '', role = 'manager') =>
  request(fixture.app)
    .get(`/api/v1/staff/${kind}/export${query}`)
    .set('Cookie', cookies[role]!);
it('rejects anonymous and strict invalid queries without download headers', async () => {
  expect(
    (await request(fixture.app).get('/api/v1/staff/leads/export')).status,
  ).toBe(401);
  for (const kind of ['leads', 'properties'])
    for (const query of ['?page=1', '?pageSize=12', '?q=a&q=b', '?unknown=1']) {
      const result = await read(kind, query);
      expect(result.status).toBe(400);
      expect(result.headers['content-disposition']).toBeUndefined();
    }
});
it('exports empty headers, role privacy and exact download headers', async () => {
  for (const kind of ['leads', 'properties']) {
    const result = await read(kind);
    expect(result.status, result.text).toBe(200);
    expect(result.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(result.headers['cache-control']).toBe('no-store');
    expect(result.headers['x-content-type-options']).toBe('nosniff');
    expect(result.headers['content-disposition']).toMatch(
      new RegExp(`attachment; filename="${kind}-\\d{4}-\\d{2}-\\d{2}.csv"`),
    );
    expect(result.text.charCodeAt(0)).toBe(0xfeff);
    expect(result.text.split('\r\n')).toHaveLength(2);
  }
  expect((await read('properties', '', 'agent')).text).not.toContain('owner_');
  expect((await read('properties', '', 'admin')).text).toContain(
    'owner_name,owner_phone',
  );
  expect((await read('leads', '?view=all', 'agent')).status).toBe(403);
  expect((await read('leads', `?agentId=${ids.agent}`)).status).toBe(400);
});
it('exports all pages, literal normalized search and stable ordering', async () => {
  for (let i = 0; i < 25; i++)
    await fixture.database.lead.create({
      data: {
        name: `José 100%_ ${i}`,
        email: 'csv@example.test',
        purpose: 'sale',
        source: 'call',
        stage: 'new',
        searchPhone: '',
        searchEmail: 'csv@example.test',
        searchPropertyTitle: '',
        searchName: `josé 100%_ ${i}`,
        assignedAgentId: ids.agent!,
        assignedAgentNameSnapshot: 'agent',
      },
    });
  const result = await read(
    'leads',
    '?q=JOS%C3%89%20100%25_&sort=oldest',
    'agent',
  );
  expect(result.status, result.text).toBe(200);
  expect(result.text.split('\r\n')).toHaveLength(27);
  const list = await request(fixture.app)
    .get('/api/v1/staff/leads?q=JOS%C3%89%20100%25_&sort=oldest')
    .set('Cookie', cookies.agent!);
  expect(
    result.text
      .split('\r\n')
      .slice(1, 21)
      .map((row) => row.split(',')[0]),
  ).toEqual(list.body.items.map((row: { id: string }) => row.id));
  expect((await read('leads')).text.split('\r\n')).toHaveLength(2);
});

it('maps property decimal values and private fields while preserving filters', async () => {
  await fixture.database.property.create({
    data: {
      title: 'José 100%_ home',
      searchTitle: 'josé 100%_ home',
      searchCity: 'dubai',
      city: 'Dubai',
      purpose: 'sale',
      priceFils: 123456789n,
      areaHundredths: 10001,
      bedrooms: 0,
      bathrooms: 0,
      ownerName: 'SECRET OWNER',
      ownerPhone: '+971501234567',
      featured: false,
    },
  });
  const manager = await read(
    'properties',
    '?q=JOS%C3%89%20100%25_&minBedrooms=0&minPriceFils=123456789&maxPriceFils=123456789',
  );
  expect(manager.status, manager.text).toBe(200);
  expect(manager.text).toContain('1234567.89');
  expect(manager.text).toContain(',0,0,100.01,');
  expect(manager.text).toContain('SECRET OWNER');
  expect(manager.text).toContain("'+971501234567");
  const agent = await read('properties', '', 'agent');
  expect(agent.text).not.toContain('SECRET OWNER');
  expect(agent.text).not.toContain('971501234567');
  expect(agent.text).toContain(',false,false,');
  expect(
    (await read('properties', '?minPriceFils=2&maxPriceFils=1')).status,
  ).toBe(400);
});
it('uses current role and live session credentials on both exports', async () => {
  await fixture.database.user.update({
    where: { id: ids.manager! },
    data: { role: 'agent' },
  });
  expect((await read('properties')).text).not.toContain('owner_name');
  expect((await read('leads', '?view=all')).status).toBe(403);
  await fixture.database.user.update({
    where: { id: ids.manager! },
    data: { role: 'manager', credentialVersion: { increment: 1 } },
  });
  for (const kind of ['leads', 'properties']) {
    const result = await read(kind);
    expect(result.status).toBe(401);
    expect(result.headers['content-disposition']).toBeUndefined();
  }
});
it('rejects 5001 results without CSV headers and allows exactly 5000', async () => {
  await fixture.database.property.createMany({
    data: Array.from({ length: 5000 }, (_, i) => ({
      title: `Bound ${i}`,
      purpose: 'rent',
    })),
  });
  const limit = await read('properties', '', 'admin');
  expect(limit.status, limit.text).toBe(422);
  expect(limit.body.error.code).toBe('EXPORT_LIMIT_EXCEEDED');
  expect(limit.headers['content-disposition']).toBeUndefined();
  const accepted = await read('properties', '?purpose=rent', 'admin');
  expect(accepted.status, accepted.text).toBe(200);
  expect(accepted.text.split('\r\n')).toHaveLength(5002);
});
it('bounds lead selection across pages at exactly 5000 rows', async () => {
  await fixture.database.lead.createMany({
    data: Array.from({ length: 4975 }, (_, i) => ({
      name: `Bound ${i}`,
      purpose: 'rent',
      source: 'call',
      searchName: `bound ${i}`,
      searchPhone: '',
      searchEmail: '',
      searchPropertyTitle: '',
    })),
  });
  const accepted = await read('leads', '?view=all', 'admin');
  expect(accepted.status, accepted.text).toBe(200);
  expect(accepted.text.split('\r\n')).toHaveLength(5002);
  await fixture.database.lead.create({
    data: {
      name: 'Overflow',
      purpose: 'rent',
      source: 'call',
      searchName: 'overflow',
      searchPhone: '',
      searchEmail: '',
      searchPropertyTitle: '',
    },
  });
  const rejected = await read('leads', '?view=all', 'admin');
  expect(rejected.status, rejected.text).toBe(422);
  expect(rejected.headers['content-disposition']).toBeUndefined();
});
