import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { authFixture } from './auth-fixture.js';
export async function leadFixture() {
  const fixture = await authFixture();
  const cookies: Record<string, string> = {},
    ids: Record<string, string> = {};
  for (const label of ['admin', 'manager', 'agent', 'other'] as const) {
    const user = await fixture.operator.create({
      name: label === 'other' ? 'Ágent %_' : label,
      email: `${label}@lead-fixture.test`,
      role: label === 'other' ? 'agent' : label,
      password: 'Test-password-123!',
    });
    ids[label] = user.id;
    const login = await request(fixture.app)
      .post('/api/v1/auth/sign-in/email')
      .set('Origin', fixture.env.APP_ORIGIN)
      .send({
        email: `${label}@lead-fixture.test`,
        password: 'Test-password-123!',
        rememberMe: true,
      });
    expect(login.status).toBe(200);
    cookies[label] = (
      login.headers['set-cookie'] as unknown as string[]
    )[0]!.split(';')[0]!;
  }
  function write(method: 'post' | 'patch', suffix = '', role = 'manager') {
    const client = request(fixture.app);
    return client[method](`/api/v1/staff/leads${suffix}`)
      .set('Cookie', cookies[role]!)
      .set('Origin', fixture.env.APP_ORIGIN);
  }
  function read(suffix = '', role = 'manager') {
    const client = request(fixture.app);
    return client
      .get(`/api/v1/staff/leads${suffix}`)
      .set('Cookie', cookies[role]!);
  }
  async function create(extra: object = {}, role = 'manager') {
    const response = await write('post', '', role).send({
      submissionId: randomUUID(),
      name: 'Contact',
      email: 'contact@example.test',
      purpose: 'sale',
      source: 'walk_in',
      ...extra,
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return response.body;
  }
  return { ...fixture, cookies, ids, write, read, create };
}
