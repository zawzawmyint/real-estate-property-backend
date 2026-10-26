import request from 'supertest';
import { createHmac, randomUUID } from 'node:crypto';
import { afterAll, expect, it } from 'vitest';
import { authFixture } from './auth-fixture.js';
import { createApp } from '../src/app.js';
import { InquiryLimiter } from '../src/modules/leads/inquiry-limiter.js';
import { parseEnv } from '../src/config/env.js';
const fixture = await authFixture();
afterAll(() => fixture.close());
const secret = 'inquiry-test-server-only-secret-at-least-32';
const app = createApp(
  { ...fixture.env, INQUIRY_RELAY_SECRET: secret },
  fixture.auth,
  fixture.database,
);
function relay(identity = randomUUID()) {
  const key = createHmac('sha256', secret).update(identity).digest('hex');
  return {
    'x-inquiry-client-key': key,
    'x-inquiry-relay-signature': createHmac('sha256', secret)
      .update(key)
      .digest('hex'),
  };
}
async function property() {
  return fixture.database.property.create({
    data: {
      title: 'Public home',
      purpose: 'rent',
      publishingState: 'published',
      city: 'Dubai',
      ownerName: 'SECRET OWNER',
    },
  });
}
function body(extra: object = {}) {
  return {
    submissionId: randomUUID(),
    name: 'Visitor',
    phone: '+971 (50) 123-4567',
    message: 'Interested',
    ...extra,
  };
}
function submit(id: string, payload: object, headers = relay()) {
  return request(app)
    .post(`/api/v1/public/properties/${id}/inquiries`)
    .set('Origin', fixture.env.APP_ORIGIN)
    .set(headers)
    .send(payload);
}
it('creates one private inquiry with snapshots and safe replay after property becomes unavailable', async () => {
  const home = await property(),
    payload = body(),
    headers = relay();
  const responses = await Promise.all([
    submit(home.id, payload, headers),
    submit(home.id, payload, headers),
  ]);
  expect(responses.map((r) => r.status).sort()).toEqual([200, 201]);
  for (const response of responses) {
    expect(response.body).toEqual({ received: true });
    expect(response.headers['cache-control']).toBe('no-store');
  }
  const receipt =
    await fixture.database.leadSubmissionReceipt.findUniqueOrThrow({
      where: { id: payload.submissionId },
    });
  const lead = await fixture.database.lead.findUniqueOrThrow({
    where: { id: receipt.leadId },
  });
  expect(lead).toMatchObject({
    purpose: 'rent',
    source: 'website',
    stage: 'new',
    budgetFils: null,
    assignedAgentId: null,
    originalMessage: 'Interested',
  });
  expect(
    await fixture.database.leadActivity.count({ where: { leadId: lead.id } }),
  ).toBe(1);
  await fixture.database.property.update({
    where: { id: home.id },
    data: { availability: 'rented' },
  });
  expect((await submit(home.id, payload, headers)).status).toBe(200);
  expect(
    (await submit(home.id, { ...payload, name: 'Other' }, headers)).status,
  ).toBe(409);
  expect((await submit(home.id, body())).status).toBe(404);
});
it('rejects forged fields, bad media/origins/IDs and invalid contact without leaking values', async () => {
  const home = await property();
  for (const fields of [
    { phone: null },
    { email: '' },
    { source: 'call' },
    { assignedAgentId: 'forged' },
    { budgetFils: 1 },
    { message: '' },
  ]) {
    const response = await submit(home.id, body(fields));
    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).not.toContain('SECRET OWNER');
  }
  expect(
    (
      await request(app)
        .post(`/api/v1/public/properties/${home.id}/inquiries`)
        .send(body())
    ).status,
  ).toBe(403);
  expect(
    (
      await request(app)
        .post(`/api/v1/public/properties/${home.id}/inquiries`)
        .set('Origin', fixture.env.APP_ORIGIN)
        .set(relay())
        .type('text')
        .send('x')
    ).status,
  ).toBe(415);
  expect((await submit('invalid', body())).status).toBe(400);
  expect(
    (await submit(home.id, body({ message: 'a'.repeat(17000) }))).status,
  ).toBe(413);
});
it('limits real signed identities independently, includes invalid attempts and ignores forged forwarded IPs', async () => {
  const home = await property(),
    headers = relay();
  for (let i = 0; i < 5; i++)
    expect((await submit(home.id, body({ phone: null }), headers)).status).toBe(
      400,
    );
  const denied = await submit(home.id, body(), headers);
  expect(denied.status).toBe(429);
  expect(Number(denied.headers['retry-after'])).toBeGreaterThan(0);
  expect((await submit(home.id, body())).status).toBe(201);
  for (let i = 0; i < 5; i++)
    expect(
      (
        await request(app)
          .post(`/api/v1/public/properties/${home.id}/inquiries`)
          .set('Origin', fixture.env.APP_ORIGIN)
          .set('X-Forwarded-For', `198.51.100.${i}`)
          .send(body({ phone: null }))
      ).status,
    ).toBe(400);
  expect(
    (
      await request(app)
        .post(`/api/v1/public/properties/${home.id}/inquiries`)
        .set('Origin', fixture.env.APP_ORIGIN)
        .set('X-Forwarded-For', '198.51.100.200')
        .send(body())
    ).status,
  ).toBe(429);
  expect(
    (
      await submit(home.id, body(), {
        'x-inquiry-client-key': 'a'.repeat(64),
        'x-inquiry-relay-signature': '0'.repeat(64),
      })
    ).status,
  ).toBe(403);
});
it('bounds limiter identities, expires the window and requires production relay configuration', () => {
  let now = 0;
  const limiter = new InquiryLimiter(() => now, 1);
  expect(limiter.consume('one')).toBe(0);
  expect(() => limiter.consume('two')).toThrow();
  for (let i = 0; i < 4; i++) limiter.consume('one');
  expect(limiter.consume('one')).toBe(900);
  now = 900000;
  expect(limiter.consume('two')).toBe(0);
  expect(() =>
    parseEnv({
      NODE_ENV: 'production',
      APP_ORIGIN: 'https://agency.test',
      BETTER_AUTH_URL: 'https://agency.test/api/v1/auth',
      BETTER_AUTH_SECRET: secret,
    }),
  ).toThrow(/INQUIRY_RELAY_SECRET/);
});
