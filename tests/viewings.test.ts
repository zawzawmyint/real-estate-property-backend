import { afterAll, beforeAll, expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { leadFixture } from './lead-fixture.js';
let f: Awaited<ReturnType<typeof leadFixture>>;
beforeAll(async () => {
  f = await leadFixture();
});
afterAll(async () => {
  await f?.close();
});
it('creates once, rejects changed replay, validates time and safely scopes viewings', async () => {
  const lead = await f.create({}, 'agent');
  const property = await f.database.property.create({
    data: {
      title: 'Visit',
      purpose: 'sale',
      publishingState: 'published',
      availability: 'available',
    },
  });
  const startsAt = new Date(Date.now() + 86400000).toISOString();
  const body = {
    submissionId: randomUUID(),
    leadId: lead.id,
    propertyId: property.id,
    expectedLeadVersion: 1,
    startsAt,
    endsAt: new Date(Date.parse(startsAt) + 3600000).toISOString(),
  };
  const write = (role = 'agent') =>
    request(f.app)
      .post('/api/v1/staff/viewings')
      .set('Cookie', f.cookies[role]!)
      .set('Origin', f.env.APP_ORIGIN);
  const created = await write().send(body);
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  expect(created.body).not.toHaveProperty('payloadHash');
  expect((await write().send(body)).status).toBe(200);
  expect(
    (
      await write().send({
        ...body,
        endsAt: new Date(Date.parse(startsAt) + 7200000).toISOString(),
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await write().send({
        ...body,
        submissionId: randomUUID(),
        startsAt: '2027-01-01T12:00:00',
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await request(f.app)
        .get(`/api/v1/staff/viewings/${created.body.id}`)
        .set('Cookie', f.cookies.other!)
    ).status,
  ).toBe(404);
  expect(await f.database.viewing.count()).toBe(1);
});
