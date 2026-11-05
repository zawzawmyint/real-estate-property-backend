import request from 'supertest';
import { createHmac, randomUUID } from 'node:crypto';
import { afterAll, expect, it } from 'vitest';
import { leadFixture } from './lead-fixture.js';
import { createApp } from '../src/app.js';
import { createDatabase } from '../src/infrastructure/database/client.js';
import { createStaffAuth } from '../src/modules/auth/auth.js';
import { parseEnv } from '../src/config/env.js';

const fixture = await leadFixture();
afterAll(() => fixture.close());
const secret = 'agency-inquiry-test-secret-at-least-32-characters';
const app = createApp(
  { ...fixture.env, INQUIRY_RELAY_SECRET: secret },
  fixture.auth,
  fixture.database,
);
function relay() {
  const key = createHmac('sha256', secret).update(randomUUID()).digest('hex');
  return {
    'x-inquiry-client-key': key,
    'x-inquiry-relay-signature': createHmac('sha256', secret)
      .update(key)
      .digest('hex'),
  };
}
function body(extra: object = {}) {
  return {
    submissionId: randomUUID(),
    name: ' Visitor ',
    purpose: 'sale',
    email: ' VISITOR@EXAMPLE.TEST ',
    message: ' Find a home ',
    ...extra,
  };
}
function submit(
  payload: object,
  headers = relay(),
  path = '/api/v1/public/inquiries',
) {
  return request(app)
    .post(path)
    .set('Origin', fixture.env.APP_ORIGIN)
    .set(headers)
    .send(payload);
}

it('rejects unsigned and untrusted production agency inquiries without consuming signed budget', async () => {
  const env = parseEnv({
    ...Object.fromEntries(
      Object.entries(fixture.env).map(([key, value]) => [key, String(value)]),
    ),
    NODE_ENV: 'production',
    APP_ORIGIN: 'https://agency.example',
    BETTER_AUTH_URL: 'https://agency.example/api/v1/auth',
    INQUIRY_RELAY_SECRET: secret,
  });
  const production = createApp(env, fixture.auth, fixture.database);
  const home = await fixture.database.property.create({
    data: {
      title: 'Production home',
      purpose: 'sale',
      publishingState: 'published',
    },
  });
  const before = await fixture.database.lead.count();
  const valid = relay();
  for (const headers of [
    {},
    { 'x-inquiry-client-key': valid['x-inquiry-client-key'] },
    { 'x-inquiry-relay-signature': valid['x-inquiry-relay-signature'] },
    { ...valid, 'x-inquiry-relay-signature': 'BAD' },
    { ...valid, 'x-inquiry-relay-signature': '0'.repeat(64) },
  ]) {
    const response = await request(production)
      .post('/api/v1/public/inquiries')
      .set('Origin', env.APP_ORIGIN)
      .set(headers)
      .send(body());
    expect(response.status).toBe(403);
    expect(response.body.error).toMatchObject({
      code: 'FORBIDDEN',
      message: 'Untrusted inquiry relay',
    });
  }
  expect(await fixture.database.lead.count()).toBe(before);
  const payload = body();
  for (let attempt = 0; attempt < 6; attempt++) {
    const path =
      attempt % 2
        ? `/api/v1/public/properties/${home.id}/inquiries`
        : '/api/v1/public/inquiries';
    const response = await request(production)
      .post(path)
      .set('Origin', env.APP_ORIGIN)
      .set(valid)
      .send(
        attempt % 2
          ? {
              submissionId: randomUUID(),
              name: 'Visitor',
              email: 'visitor@example.test',
            }
          : payload,
      );
    expect(response.status).toBe(
      attempt === 5 ? 429 : attempt === 0 || attempt % 2 ? 201 : 200,
    );
    if (attempt === 5)
      expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
    else expect(response.body).toEqual({ received: true });
  }
  expect(
    (
      await request(createApp(fixture.env, fixture.auth, fixture.database))
        .post('/api/v1/public/inquiries')
        .set('Origin', fixture.env.APP_ORIGIN)
        .send(body())
    ).status,
  ).toBe(201);
});

it('atomically creates a normalized private agency lead and supports staff assignment', async () => {
  const payload = body();
  const responses = await Promise.all([submit(payload), submit(payload)]);
  expect(responses.map((response) => response.status).sort()).toEqual([
    200, 201,
  ]);
  for (const response of responses) {
    expect(response.body).toEqual({ received: true });
    expect(response.headers['cache-control']).toBe('no-store');
  }
  const receipt =
    await fixture.database.leadSubmissionReceipt.findUniqueOrThrow({
      where: { id: payload.submissionId },
    });
  expect(receipt).toMatchObject({
    operation: 'agency_inquiry',
    actorScope: 'public',
  });
  const lead = await fixture.database.lead.findUniqueOrThrow({
    where: { id: receipt.leadId },
  });
  expect(lead).toMatchObject({
    name: 'Visitor',
    phone: null,
    email: 'visitor@example.test',
    purpose: 'sale',
    originalMessage: 'Find a home',
    source: 'website',
    stage: 'new',
    propertyId: null,
    propertyTitleSnapshot: null,
    propertyLocationSnapshot: null,
    budgetFils: null,
    assignedAgentId: null,
    assignedAgentNameSnapshot: null,
    createdById: null,
    searchName: 'visitor',
    searchEmail: 'visitor@example.test',
    searchPropertyTitle: '',
  });
  expect(
    await fixture.database.leadActivity.count({ where: { leadId: lead.id } }),
  ).toBe(1);
  expect((await fixture.read(`/${lead.id}`, 'agent')).status).toBe(404);
  expect((await fixture.read(`/${lead.id}`)).body.originalMessage).toBe(
    'Find a home',
  );
  const assigned = await fixture
    .write('patch', `/${lead.id}/assignment`)
    .send({ expectedVersion: 1, assignedAgentId: fixture.ids.agent });
  expect(assigned.status).toBe(200);
  expect((await fixture.read(`/${lead.id}`, 'agent')).status).toBe(200);
  expect((await fixture.read(`/${lead.id}`, 'other')).status).toBe(404);
  expect((await submit({ ...payload, phone: null })).status).toBe(200);
  expect((await submit({ ...payload, purpose: 'rent' })).status).toBe(409);
});

it('accepts a phone-only rental enquiry and rejects reuse across operations', async () => {
  const payload = body({
    purpose: 'rent',
    email: null,
    phone: '+971 (50) 123-4567',
  });
  expect((await submit(payload)).status).toBe(201);
  const home = await fixture.database.property.create({
    data: {
      title: 'Home',
      city: 'Dubai',
      purpose: 'rent',
      publishingState: 'published',
    },
  });
  const propertyPayload = {
    submissionId: payload.submissionId,
    name: payload.name,
    email: payload.email,
    phone: '+971 (50) 123-4567',
    message: payload.message,
  };
  expect(
    (
      await submit(
        propertyPayload,
        relay(),
        `/api/v1/public/properties/${home.id}/inquiries`,
      )
    ).status,
  ).toBe(409);
  const propertyFirst = { ...propertyPayload, submissionId: randomUUID() };
  expect(
    (
      await submit(
        propertyFirst,
        relay(),
        `/api/v1/public/properties/${home.id}/inquiries`,
      )
    ).status,
  ).toBe(201);
  expect((await submit({ ...propertyFirst, purpose: 'rent' })).status).toBe(
    409,
  );
});

it('rejects invalid and forged input without persisting any receipt', async () => {
  for (const extra of [
    { purpose: undefined },
    { purpose: 'other' },
    { email: null },
    { phone: '' },
    { phone: '---' },
    { email: '' },
    { message: undefined },
    { message: null },
    { message: ' ' },
    { message: 'a'.repeat(2001) },
    { source: 'website' },
    { stage: 'won' },
    { budgetFils: 100 },
    { propertyId: randomUUID() },
    { assignedAgentId: fixture.ids.agent },
    { preferredAgent: 'amira-hassan' },
    { staffId: fixture.ids.agent },
  ]) {
    const payload = body(extra);
    const response = await submit(payload);
    expect(response.status, JSON.stringify(extra)).toBe(400);
    expect(response.body.error.requestId).toBe(
      response.headers['x-request-id'],
    );
    expect(
      await fixture.database.leadSubmissionReceipt.count({
        where: { id: payload.submissionId },
      }),
    ).toBe(0);
  }
});

it('enforces origin, relay, JSON and body size boundaries', async () => {
  expect(
    (await request(app).post('/api/v1/public/inquiries').send(body())).status,
  ).toBe(403);
  expect(
    (
      await submit(body(), {
        'x-inquiry-client-key': 'a'.repeat(64),
        'x-inquiry-relay-signature': '0'.repeat(64),
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await request(app)
        .post('/api/v1/public/inquiries')
        .set('Origin', fixture.env.APP_ORIGIN)
        .set(relay())
        .type('text')
        .send('x')
    ).status,
  ).toBe(415);
  expect(
    (
      await request(app)
        .post('/api/v1/public/inquiries')
        .set('Origin', fixture.env.APP_ORIGIN)
        .set(relay())
        .type('json')
        .send('{')
    ).status,
  ).toBe(400);
  expect((await submit(body({ message: 'a'.repeat(17000) }))).status).toBe(413);
});

it('shares five attempts across property/general routes including invalid input and replay', async () => {
  const headers = relay(),
    payload = body();
  const home = await fixture.database.property.create({
    data: {
      title: 'Home',
      city: 'Dubai',
      purpose: 'sale',
      publishingState: 'published',
    },
  });
  const path = `/api/v1/public/properties/${home.id}/inquiries`;
  expect((await submit(payload, headers)).status).toBe(201);
  expect((await submit(payload, headers)).status).toBe(200);
  expect((await submit(body({ source: 'call' }), headers, path)).status).toBe(
    400,
  );
  expect((await submit(body({ message: null }), headers)).status).toBe(400);
  expect(
    (
      await submit(
        {
          submissionId: randomUUID(),
          name: 'Home visitor',
          email: 'visitor@example.test',
        },
        headers,
        path,
      )
    ).status,
  ).toBe(201);
  const denied = await submit(body(), headers);
  expect(denied.status).toBe(429);
  expect(Number(denied.headers['retry-after'])).toBeGreaterThan(0);
  expect((await submit(body(), headers, path)).status).toBe(429);
  expect((await submit(body())).status).toBe(201);
});

it('deduplicates an agency submission across independent SQLite clients', async () => {
  const second = await createDatabase(fixture.env.DATABASE_URL);
  const secondApp = createApp(
    fixture.env,
    createStaffAuth(fixture.env, second),
    second,
  );
  const payload = body({ name: 'Cross-client visitor' });

  try {
    const results = await Promise.all([
      submit(payload),
      request(secondApp)
        .post('/api/v1/public/inquiries')
        .set('Origin', fixture.env.APP_ORIGIN)
        .send(payload),
    ]);
    expect(results.map((response) => response.status).sort()).toEqual([
      200, 201,
    ]);
    expect(
      await fixture.database.lead.count({ where: { name: payload.name } }),
    ).toBe(1);
    const receipt =
      await fixture.database.leadSubmissionReceipt.findUniqueOrThrow({
        where: { id: payload.submissionId },
      });
    expect(
      await fixture.database.leadActivity.count({
        where: { leadId: receipt.leadId },
      }),
    ).toBe(1);
  } finally {
    await second.$disconnect();
  }
});

it('rolls back the lead and activity when the receipt write fails and never acknowledges commit', async () => {
  const payload = body({
    name: 'Rollback visitor',
    message: 'PRIVATE MESSAGE',
  });
  await fixture.database.$executeRawUnsafe(
    "CREATE TRIGGER reject_agency_receipt BEFORE INSERT ON LeadSubmissionReceipt WHEN NEW.operation = 'agency_inquiry' BEGIN SELECT RAISE(ABORT, 'PRIVATE DATABASE ERROR'); END",
  );
  const before = await fixture.database.leadActivity.count();

  try {
    const response = await submit(payload);
    expect(response.status).toBe(500);
    expect(JSON.stringify(response.body)).not.toContain('PRIVATE');
    expect(response.body).not.toHaveProperty('received');
    expect(
      await fixture.database.lead.count({ where: { name: payload.name } }),
    ).toBe(0);
    expect(await fixture.database.leadActivity.count()).toBe(before);
    expect(
      await fixture.database.leadSubmissionReceipt.count({
        where: { id: payload.submissionId },
      }),
    ).toBe(0);
  } finally {
    await fixture.database.$executeRawUnsafe(
      'DROP TRIGGER reject_agency_receipt',
    );
  }
  expect((await submit(payload)).status).toBe(201);
});

it('replays agency enquiries across equivalent whitespace and stores the canonical phone once', async () => {
  const payload = body({ email: null, phone: '\t+971\u00a0\u202f50-123\n' });
  expect((await submit(payload)).status).toBe(201);
  expect((await submit({ ...payload, phone: '+971  50-123' })).status).toBe(
    200,
  );
  const receipt =
    await fixture.database.leadSubmissionReceipt.findUniqueOrThrow({
      where: { id: payload.submissionId },
    });
  const lead = await fixture.database.lead.findUniqueOrThrow({
    where: { id: receipt.leadId },
  });
  expect(lead.phone).toBe('+971  50-123');
  expect(lead.searchPhone).toBe('97150123');
  expect(
    await fixture.database.lead.count({ where: { phone: '+971  50-123' } }),
  ).toBe(1);
  expect(
    await fixture.database.leadActivity.count({ where: { leadId: lead.id } }),
  ).toBe(1);
});
