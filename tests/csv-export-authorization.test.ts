import request from 'supertest';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { authFixture } from './auth-fixture.js';
import { createLeadService } from '../src/modules/leads/leads.service.js';
import type { Actor } from '../src/modules/leads/leads.repository.js';
import { createPropertyService } from '../src/modules/properties/properties.service.js';
import { LocalStorage } from '../src/infrastructure/storage/local-storage.js';
import { createLogger } from '../src/shared/logger.js';

const fixture = await authFixture();
const leads = createLeadService(fixture.database);
const properties = createPropertyService(
  fixture.database,
  new LocalStorage(fixture.env.STORAGE_ROOT, fixture.env.PUBLIC_ORIGIN),
  createLogger('silent'),
);

beforeAll(async () => {
  await fixture.database.property.create({
    data: {
      title: 'Service authorization fixture',
      purpose: 'sale',
      ownerName: 'SERVICE SECRET OWNER',
      ownerPhone: '+971501234567',
    },
  });
});
afterAll(() => fixture.close());

async function captureManager(label: string): Promise<Actor> {
  const user = await fixture.operator.create({
    name: label,
    email: `${label}@csv-service.test`,
    password: 'Test-password-123!',
    role: 'manager',
  });
  const login = await request(fixture.app)
    .post('/api/v1/auth/sign-in/email')
    .set('Origin', fixture.env.APP_ORIGIN)
    .send({
      email: `${label}@csv-service.test`,
      password: 'Test-password-123!',
      rememberMe: true,
    });
  expect(login.status).toBe(200);
  const session = await fixture.database.session.findFirstOrThrow({
    where: { userId: user.id },
    select: { id: true },
  });
  const actor: Actor = {
    id: user.id,
    name: label,
    role: 'manager',
    sessionId: session.id,
  };

  // Establish that the captured identity authorizes both real services before
  // changing database state; later calls intentionally reuse this exact object.
  expect(await properties.exportCsv({ sort: 'updated_desc' }, actor)).toContain(
    'SERVICE SECRET OWNER',
  );
  expect(
    await leads.exportCsv({ sort: 'newest', view: 'all' }, actor),
  ).toContain('lead_id');
  return actor;
}

it('rechecks role inside export transactions with a stale manager identity', async () => {
  const actor = await captureManager('demoted');
  await fixture.database.user.update({
    where: { id: actor.id },
    data: { role: 'agent' },
  });

  expect(actor.role).toBe('manager');
  const csv = await properties.exportCsv({ sort: 'updated_desc' }, actor);
  expect(csv).toContain('Service authorization fixture');
  for (const secret of [
    'owner_name',
    'owner_phone',
    'SERVICE SECRET OWNER',
    '971501234567',
  ])
    expect(csv).not.toContain(secret);
  await expect(
    leads.exportCsv({ sort: 'newest', view: 'all' }, actor),
  ).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
});

it.each([
  'expired',
  'revoked',
  'disabled',
  'banned',
  'credential-invalid',
] as const)(
  'rejects a captured identity after its live session becomes %s',
  async (state) => {
    const actor = await captureManager(state);
    if (state === 'expired')
      await fixture.database.session.update({
        where: { id: actor.sessionId },
        data: { expiresAt: new Date(0) },
      });
    else if (state === 'revoked')
      await fixture.database.session.delete({ where: { id: actor.sessionId } });
    else
      await fixture.database.user.update({
        where: { id: actor.id },
        data:
          state === 'credential-invalid'
            ? { credentialVersion: { increment: 1 } }
            : state === 'disabled'
              ? { disabled: true }
              : { banned: true },
      });

    // No middleware is involved here: both real services must reject the stale
    // identity through requireCurrentStaff in their own read transaction.
    await expect(
      properties.exportCsv({ sort: 'updated_desc' }, actor),
    ).rejects.toMatchObject({ status: 401, code: 'UNAUTHENTICATED' });
    await expect(
      leads.exportCsv({ sort: 'newest', view: 'all' }, actor),
    ).rejects.toMatchObject({ status: 401, code: 'UNAUTHENTICATED' });
  },
);
