import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { leadFixture } from './lead-fixture.js';

const endpoint = '/api/v1/staff/notifications';
let f: Awaited<ReturnType<typeof leadFixture>>;

beforeEach(async () => {
  f = await leadFixture();
});

afterEach(async () => {
  await f?.close();
});

function inbox(role: string, query = '') {
  return request(f.app)
    .get(endpoint + query)
    .set('Cookie', f.cookies[role]!);
}

function markRead(role: string, id: string) {
  return request(f.app)
    .patch(`${endpoint}/${id}/read`)
    .set('Cookie', f.cookies[role]!)
    .set('Origin', f.env.APP_ORIGIN);
}

async function seedAlert(leadId: string, role: string, sequence: number) {
  const id = randomUUID();
  const createdAt = '2026-11-10T08:00:00.000Z';
  await f.database
    .$executeRaw`INSERT INTO "Notification" ("id", "recipientId", "type", "leadId", "occurrenceKey", "createdAt") VALUES (${id}, ${f.ids[role]!}, ${'lead_assigned'}, ${leadId}, ${`test:${leadId}:${sequence}`}, ${new Date(createdAt)})`;
  return { id, createdAt };
}

it('requires staff authentication for the no-store inbox', async () => {
  const anonymous = await request(f.app).get(endpoint);
  expect(anonymous.status).toBe(401);
  expect(anonymous.headers['cache-control']).toBe('no-store');
  const authenticated = await inbox('admin');
  expect(authenticated.status).toBe(200);
  expect(authenticated.body).toEqual({
    items: [],
    unreadCount: 0,
    nextCursor: null,
  });
  expect(authenticated.headers['cache-control']).toBe('no-store');
});

it('pages visible notifications by creation time and ID without changing the total unread count', async () => {
  const lead = await f.create({}, 'agent');
  const seeded = [];
  for (let index = 0; index < 21; index++) {
    seeded.push(await seedAlert(lead.id, 'agent', index));
  }
  await seedAlert(lead.id, 'other', 99);
  const ids = seeded
    .map(({ id }) => id)
    .sort()
    .reverse();

  const first = await inbox('agent');
  expect(first.status).toBe(200);
  expect(first.body.unreadCount).toBe(21);
  expect(first.body.items.map(({ id }: { id: string }) => id)).toEqual(
    ids.slice(0, 20),
  );
  expect(first.body.items[0]).toEqual({
    id: ids[0],
    type: 'lead_assigned',
    leadId: lead.id,
    viewingId: null,
    taskId: null,
    createdAt: seeded[0]!.createdAt,
    readAt: null,
  });

  const second = await inbox(
    'agent',
    `?cursor=${encodeURIComponent(first.body.nextCursor)}`,
  );
  expect(second.status).toBe(200);
  expect(second.body.unreadCount).toBe(21);
  expect(second.body.nextCursor).toBeNull();
  expect(second.body.items.map(({ id }: { id: string }) => id)).toEqual(
    ids.slice(20),
  );
  expect((await inbox('admin')).body).toEqual({
    items: [],
    unreadCount: 0,
    nextCursor: null,
  });
});

it('keeps the first read timestamp and denies other recipients or revoked lead access', async () => {
  const lead = await f.create({}, 'agent');
  const { id } = await seedAlert(lead.id, 'agent', 0);

  expect((await markRead('other', id)).status).toBe(404);
  expect((await markRead('admin', id)).status).toBe(404);
  expect((await markRead('agent', id)).status).toBe(204);
  const first = (await inbox('agent')).body;
  expect(first.unreadCount).toBe(0);
  expect(first.items[0].readAt).toEqual(expect.any(String));

  await new Promise((resolve) => setTimeout(resolve, 10));
  expect((await markRead('agent', id)).status).toBe(204);
  expect((await inbox('agent')).body).toEqual(first);

  await f.database.lead.update({
    where: { id: lead.id },
    data: { assignedAgentId: f.ids.other! },
  });
  expect((await inbox('agent')).body).toEqual({
    items: [],
    unreadCount: 0,
    nextCursor: null,
  });
  expect((await markRead('agent', id)).status).toBe(404);
});

it('rejects invalid cursor, query, path and read request bodies', async () => {
  expect((await inbox('agent', '?cursor=invalid')).status).toBe(400);
  expect((await inbox('agent', '?cursor=1&cursor=2')).status).toBe(400);
  expect((await inbox('agent', '?recipientId=other')).status).toBe(400);
  expect((await markRead('agent', 'invalid')).status).toBe(400);
  expect(
    (await markRead('agent', randomUUID()).send({ read: true })).status,
  ).toBe(400);
});

it('rejects a mismatched expected account without exposing the current inbox', async () => {
  const lead = await f.create({}, 'agent');
  await seedAlert(lead.id, 'agent', 0);

  const mismatch = await inbox('agent').set('X-Staff-Account', f.ids.other!);
  expect(mismatch.status).toBe(403);
  expect(mismatch.body).not.toHaveProperty('items');
  const match = await inbox('agent').set('X-Staff-Account', f.ids.agent!);
  expect(match.status).toBe(200);
  expect(match.body.unreadCount).toBe(1);
});
