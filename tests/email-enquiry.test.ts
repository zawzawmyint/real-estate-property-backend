import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { afterAll, expect, it } from 'vitest';
import { authFixture } from './auth-fixture.js';
import { createApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { createLeadService } from '../src/modules/leads/leads.service.js';

const fixture = await authFixture();
afterAll(() => fixture.close());
const input = Object.fromEntries(
  Object.entries(fixture.env)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => [key, String(value)]),
);
const env = parseEnv({
  ...input,
  EMAIL_ENQUIRY_NOTIFICATIONS_ENABLED: 'true',
  EMAIL_PAYLOAD_KEYS: JSON.stringify({
    test: Buffer.alloc(32, 1).toString('base64'),
  }),
  EMAIL_PAYLOAD_ACTIVE_KEY_ID: 'test',
  SMTP_REPLY_TO: 'help@example.test',
});
it('records one acknowledgement for each eligible public route, not replay or phone-only/disabled enquiries', async () => {
  const property = await fixture.database.property.create({
    data: {
      title: 'Public home',
      purpose: 'sale',
      publishingState: 'published',
    },
  });
  for (const route of [
    `/api/v1/public/properties/${property.id}/inquiries`,
    '/api/v1/public/inquiries',
  ]) {
    const app = createApp(env, fixture.auth, fixture.database);
    const payload = {
      submissionId: randomUUID(),
      name: 'Visitor',
      email: 'visitor@example.test',
      message: 'Interested',
      ...(route.endsWith('/public/inquiries') ? { purpose: 'sale' } : {}),
    };
    const before = await fixture.database.emailNotification.count();
    for (const status of [201, 200]) {
      const response = await request(app)
        .post(route)
        .set('Origin', env.APP_ORIGIN)
        .send(payload);
      expect(response.status, JSON.stringify(response.body)).toBe(status);
      expect(response.body).toEqual({ received: true });
    }
    expect(await fixture.database.emailNotification.count()).toBe(before + 1);
    const phoneOnly = {
      ...payload,
      submissionId: randomUUID(),
      email: null,
      phone: '+971501234567',
    };
    expect(
      (
        await request(app)
          .post(route)
          .set('Origin', env.APP_ORIGIN)
          .send(phoneOnly)
      ).status,
    ).toBe(201);
    expect(await fixture.database.emailNotification.count()).toBe(before + 1);
    expect(
      (
        await request(fixture.app)
          .post(route)
          .set('Origin', env.APP_ORIGIN)
          .send({ ...payload, submissionId: randomUUID() })
      ).status,
    ).toBe(201);
    expect(await fixture.database.emailNotification.count()).toBe(before + 1);
  }
});
it('rolls enquiry, receipt and created activity back if email intent cannot be recorded', async () => {
  const before = await fixture.database.lead.count();
  const service = createLeadService(fixture.database, undefined, async () => {
    throw new Error('EMAIL_WRITE_FAILED');
  });
  await expect(
    service.agencyInquiry({
      submissionId: randomUUID(),
      name: 'Visitor',
      email: 'visitor@example.test',
      purpose: 'sale',
      message: 'Hello',
    }),
  ).rejects.toThrow('EMAIL_WRITE_FAILED');
  expect(await fixture.database.lead.count()).toBe(before);
});
