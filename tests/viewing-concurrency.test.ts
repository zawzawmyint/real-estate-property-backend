import { afterAll, beforeAll, expect, it } from 'vitest';
import request from 'supertest';
import { createDatabase } from '../src/infrastructure/database/client.js';
import { createApp } from '../src/app.js';
import { createStaffAuth } from '../src/modules/auth/auth.js';
import { viewingFixture } from './viewing-fixture.js';
let f: Awaited<ReturnType<typeof viewingFixture>>;
beforeAll(async () => {
  f = await viewingFixture();
});
afterAll(async () => {
  await f?.close();
});
it('deduplicates independent-client HTTP submissions and rejects concurrent stale updates', async () => {
  const second = await createDatabase(f.env.DATABASE_URL);
  const app = createApp(f.env, createStaffAuth(f.env, second), second);
  const client = request(app);
  const write = (method: 'post' | 'patch', suffix = '') =>
    client[method](`/api/v1/staff/viewings${suffix}`)
      .set('Cookie', f.cookies.agent!)
      .set('Origin', f.env.APP_ORIGIN);
  try {
    const created = await Promise.all([
      f.viewingWrite('post').send(f.body),
      write('post').send(f.body),
    ]);
    expect(created.map((row) => row.status).sort()).toEqual([200, 201]);
    expect(created[0]!.body.id).toBe(created[1]!.body.id);
    const results = await Promise.all([
      f
        .viewingWrite('patch', `/${created[0]!.body.id}/status`)
        .send({ expectedVersion: 1, status: 'cancelled' }),
      write('patch', `/${created[0]!.body.id}/status`).send({
        expectedVersion: 1,
        status: 'cancelled',
      }),
    ]);
    expect(results.map((row) => row.status).sort()).toEqual([200, 409]);
  } finally {
    await second.$disconnect();
  }
});
it('orders independent-client assignment and denies subsequent former-owner mutations', async () => {
  const second = await createDatabase(f.env.DATABASE_URL),
    app = createApp(f.env, createStaffAuth(f.env, second), second);
  try {
    const row = await f.createViewing();
    const results = await Promise.all([
      request(app)
        .patch(`/api/v1/staff/leads/${f.lead.id}/assignment`)
        .set('Cookie', f.cookies.manager!)
        .set('Origin', f.env.APP_ORIGIN)
        .send({ expectedVersion: 1, assignedAgentId: f.ids.other }),
      f.viewingWrite('patch', `/${row.id}`).send({
        expectedVersion: 1,
        expectedLeadVersion: 1,
        startsAt: f.body.startsAt,
        endsAt: f.body.endsAt,
      }),
    ]);
    expect(results[0]!.status).toBe(200);
    expect([200, 404]).toContain(results[1]!.status);
    expect((await f.viewingRead(`/${row.id}`)).status).toBe(404);
    expect(
      (
        await f
          .viewingWrite('patch', `/${row.id}/status`)
          .send({ expectedVersion: 2, status: 'cancelled' })
      ).status,
    ).toBe(404);
  } finally {
    await second.$disconnect();
  }
});
