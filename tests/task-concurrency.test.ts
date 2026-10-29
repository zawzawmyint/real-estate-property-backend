import { afterEach, beforeEach, expect, it } from 'vitest';
import request from 'supertest';
import { createDatabase } from '../src/infrastructure/database/client.js';
import { createApp } from '../src/app.js';
import { createStaffAuth } from '../src/modules/auth/auth.js';
import { taskFixture } from './task-fixture.js';
let f: Awaited<ReturnType<typeof taskFixture>>;
beforeEach(async () => {
  f = await taskFixture();
});
afterEach(async () => {
  await f?.close();
});
it('serializes independent-client receipts, competing edits and reassignment', async () => {
  const db = await createDatabase(f.env.DATABASE_URL),
    app = createApp(f.env, createStaffAuth(f.env, db), db);
  const client = request(app);
  const write = (method: 'post' | 'patch', suffix = '') =>
    client[method](`/api/v1/staff/tasks${suffix}`)
      .set('Cookie', f.cookies.agent!)
      .set('Origin', f.env.APP_ORIGIN);
  try {
    const created = await Promise.all([
      f.taskWrite('post').send(f.body),
      write('post').send(f.body),
    ]);
    expect(created.map((r) => r.status).sort()).toEqual([200, 201]);
    const task = created[0]!.body.task;
    const update = {
      expectedVersion: 1,
      expectedLeadVersion: 1,
      title: 'Changed',
      notes: null,
      dueAt: f.body.dueAt,
    };
    const edits = await Promise.all([
      f.taskWrite('patch', `/${task.id}`).send(update),
      write('patch', `/${task.id}`).send(update),
    ]);
    expect(edits.map((r) => r.status).sort()).toEqual([200, 409]);
    const races = await Promise.all([
      request(app)
        .patch(`/api/v1/staff/leads/${f.lead.id}/assignment`)
        .set('Cookie', f.cookies.manager!)
        .set('Origin', f.env.APP_ORIGIN)
        .send({ expectedVersion: 1, assignedAgentId: f.ids.other }),
      f
        .taskWrite('patch', `/${task.id}/status`)
        .send({ expectedVersion: 2, status: 'completed' }),
    ]);
    expect(races[0]!.status).toBe(200);
    expect([200, 404]).toContain(races[1]!.status);
    expect((await f.taskWrite('post').send(f.body)).status).toBe(404);
    expect(await db.task.count()).toBe(1);
  } finally {
    await db.$disconnect();
  }
});
