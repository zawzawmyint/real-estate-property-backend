import express from 'express';
import request from 'supertest';
import { expect, it, vi } from 'vitest';
import { authFixture } from './auth-fixture.js';
import { createStaffAuth } from '../src/modules/auth/auth.js';
import { mountAuth } from '../src/modules/auth/auth.routes.js';
import { requireStaff } from '../src/modules/auth/auth.middleware.js';
import { requestId } from '../src/middleware/request-id.js';
import { errorHandler } from '../src/middleware/error-handler.js';
import { createLogger } from '../src/shared/logger.js';
import { LoginLimiter } from '../src/modules/auth/login-limiter.js';

const password = 'Test-password-123!';
const data = (email = 'admin@example.test') => ({
  email,
  password,
  rememberMe: true,
});

type Fixture = Awaited<ReturnType<typeof authFixture>>;

async function login(f: Fixture, email = 'admin@example.test', extra = {}) {
  return request(f.app)
    .post('/api/v1/auth/sign-in/email')
    .set('Origin', f.env.APP_ORIGIN)
    .send({ ...data(email), ...extra });
}

const cookieOf = (response: { headers: Record<string, unknown> }) =>
  (response.headers['set-cookie'] as string[])
    .find((cookie) => cookie.startsWith('agency.session='))!
    .split(';')[0]!;

async function withFixture(run: (f: Fixture) => Promise<void>) {
  const f = await authFixture();

  try {
    await run(f);
  } finally {
    await f.close();
  }
}

async function admin(f: Fixture) {
  return f.operator.create(
    { name: 'Admin', email: 'admin@example.test', password, role: 'admin' },
    true,
  );
}

it('blocks every hidden auth operation and exact method/path variations', async () =>
  withFixture(async (f) => {
    for (const path of [
      'sign-up/email',
      'admin/create-user',
      'admin/set-role',
      'admin/impersonate-user',
      'change-password',
      'token',
      'get-session/',
      'GET-SESSION',
    ]) {
      const response = await request(f.app)
        .post(`/api/v1/auth/${path}`)
        .set('Origin', f.env.APP_ORIGIN)
        .send({});

      expect(response.status, path).toBe(404);
      expect(response.headers['cache-control']).toBe('no-store');
    }

    expect(
      (
        await request(f.app)
          .post('/api/v1/auth/get-session')
          .set('Origin', f.env.APP_ORIGIN)
          .send({})
      ).status,
    ).toBe(404);
    expect(
      (await request(f.app).get('/api/v1/auth/sign-in/email')).status,
    ).toBe(404);
  }));
it('requires trusted origins before even anonymous logout and rejects non-JSON sign in', async () =>
  withFixture(async (f) => {
    for (const origin of [
      undefined,
      'null',
      'http://evil.test',
      `${f.env.APP_ORIGIN}/`,
    ]) {
      let req = request(f.app).post('/api/v1/auth/sign-out');

      if (origin) req = req.set('Origin', origin);

      expect((await req).status).toBe(403);
    }

    expect(
      (
        await request(f.app)
          .post('/api/v1/auth/sign-in/email')
          .set('Origin', f.env.APP_ORIGIN)
          .send('email=a')
      ).status,
    ).toBe(415);

    const emptyLogout = await request(f.app)
      .post('/api/v1/auth/sign-out')
      .set('Origin', f.env.APP_ORIGIN);

    expect(emptyLogout.status).toBe(200);
    expect(emptyLogout.body).toEqual({ success: true });

    const malformed = await request(f.app)
      .post('/api/v1/auth/sign-in/email')
      .set('Origin', f.env.APP_ORIGIN)
      .set('Content-Type', 'application/json')
      .send('{');

    expect(malformed.status).toBe(400);
    expect(malformed.body.error).toBeUndefined();
  }));
it('rejects privilege, callback, shorter session and malformed credential input', async () =>
  withFixture(async (f) => {
    await admin(f);

    for (const extra of [
      { role: 'admin' },
      { userId: 'x' },
      { callbackURL: 'http://evil.test' },
      { rememberMe: false },
      { extra: {} },
      { password: '' },
      { password: 'a'.repeat(129) },
      { email: 'bad' },
    ]) {
      const response = await login(f, undefined, extra);

      expect(response.status, JSON.stringify(extra)).toBe(400);
      expect(response.body.code).toBeTruthy();
    }

    expect(await f.database.session.count()).toBe(0);
  }));
it('normalizes emails equally and never transforms passwords or returns hashes', async () =>
  withFixture(async (f) => {
    await f.operator.create({
      name: 'Manager',
      email: '  MANAGER@Example.test ',
      password: ' password-with-spaces ',
      role: 'manager',
    });

    const response = await login(f, ' MANAGER@EXAMPLE.TEST ', {
      password: ' password-with-spaces ',
    });

    expect(response.status).toBe(200);
    expect(response.body.user.email).toBe('manager@example.test');
    expect(response.body.user.role).toBe('manager');

    const account = await f.database.account.findFirstOrThrow();

    expect(account.password).not.toBe(' password-with-spaces ');
    expect(JSON.stringify(response.body)).not.toContain(account.password);
    await expect(
      f.operator.create({
        name: 'Other',
        email: 'manager@example.test',
        password,
        role: 'agent',
      }),
    ).rejects.toThrow();
  }));
it('unknown, wrong password and disabled accounts share generic credential errors', async () =>
  withFixture(async (f) => {
    const user = await admin(f);
    const wrong = await login(f, undefined, { password: 'wrong-password' });
    const unknown = await login(f, 'unknown@example.test');

    await f.database.user.update({
      where: { id: user.id },
      data: { disabled: true },
    });

    const disabled = await login(f);

    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(wrong.status);
    expect(disabled.status).toBe(wrong.status);
    expect(disabled.body).toEqual(wrong.body);
    expect(unknown.body).toEqual(wrong.body);
    expect(await f.database.session.count()).toBe(0);
  }));
it('throttles normalized accounts including successful logins and returns Retry-After', async () =>
  withFixture(async (f) => {
    await admin(f);

    for (let i = 0; i < 5; i++) expect((await login(f)).status).toBe(200);

    const limited = await login(f, '  ADMIN@EXAMPLE.TEST ');

    expect(limited.status).toBe(429);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect(limited.headers['cache-control']).toBe('no-store');
  }));
it('expires bounded limiter keys and enforces service ceiling without evicting live accounts', () => {
  let now = 0;
  const limiter = new LoginLimiter(() => now, 2);

  limiter.consume('one');
  limiter.consume('two');
  expect(() => limiter.consume('three')).toThrow();

  for (let i = 0; i < 4; i++) limiter.consume('one');

  expect(() => limiter.consume('one')).toThrow();
  now += 900_001;
  expect(() => limiter.consume('three')).not.toThrow();

  const service = new LoginLimiter(() => now);

  for (let i = 0; i < 100; i++) service.consume(String(i));

  expect(() => service.consume('excess')).toThrow();
  now += 60_001;
  expect(() => service.consume('excess')).not.toThrow();
});
it('uses live state for session lookup and genuine role guards on test-only routes', async () =>
  withFixture(async (f) => {
    const user = await admin(f);
    const cookie = cookieOf(await login(f));
    const app = express();

    app.use(requestId);
    mountAuth(app, f.auth, f.env);
    app.get('/restricted', requireStaff(f.auth, ['admin']), (_req, res) =>
      res.json({ role: res.locals.staff.role }),
    );
    app.use(errorHandler(createLogger('silent')));
    expect((await request(app).get('/restricted')).status).toBe(401);
    expect(
      (await request(app).get('/restricted').set('Cookie', cookie)).body,
    ).toEqual({ role: 'admin' });
    await f.database.user.update({
      where: { id: user.id },
      data: { role: 'manager' },
    });
    expect(
      (await request(app).get('/restricted').set('Cookie', cookie)).status,
    ).toBe(403);

    const live = await request(f.app)
      .get('/api/v1/auth/get-session')
      .set('Cookie', cookie);

    expect(live.body.user.role).toBe('manager');
    expect(live.headers['set-cookie']).toBeUndefined();
    await f.database.user.update({
      where: { id: user.id },
      data: { disabled: true },
    });
    expect(
      (
        await request(f.app)
          .get('/api/v1/auth/get-session')
          .set('Cookie', cookie)
      ).body,
    ).toBeNull();
    expect(
      (await request(app).get('/restricted').set('Cookie', cookie)).status,
    ).toBe(401);
    await f.database.user.update({
      where: { id: user.id },
      data: { disabled: false, role: 'unknown' },
    });
    expect(
      (await request(app).get('/restricted').set('Cookie', cookie)).status,
    ).toBe(401);
    expect(
      (
        await request(f.app)
          .get('/api/v1/auth/get-session')
          .set('Cookie', `${cookie}tampered`)
      ).body,
    ).toBeNull();
  }));
it('keeps eight-hour absolute database and cookie expiry across reads and restart', async () =>
  withFixture(async (f) => {
    await admin(f);
    vi.useFakeTimers({ toFake: ['Date'] });

    try {
      const started = Date.now();
      const response = await login(f);
      const cookie = cookieOf(response);
      const header = (
        response.headers['set-cookie'] as unknown as string[]
      ).find((value) => value.startsWith('agency.session='))!;

      expect(header).toMatch(/Max-Age=28800/i);
      expect(header).toMatch(/HttpOnly/i);
      expect(header).toMatch(/SameSite=Lax/i);
      expect(header).not.toMatch(/Domain=/i);

      const session = await f.database.session.findFirstOrThrow();

      expect(session.expiresAt.getTime() - started).toBe(28_800_000);
      vi.setSystemTime(started + 4 * 3_600_000);

      const restarted = express();

      mountAuth(restarted, createStaffAuth(f.env, f.database), f.env);

      const lookup = await request(restarted)
        .get('/api/v1/auth/get-session')
        .set('Cookie', cookie);

      expect(lookup.status).toBe(200);
      expect(lookup.body.user.role).toBe('admin');
      expect(lookup.headers['set-cookie']).toBeUndefined();
      expect((await f.database.session.findFirstOrThrow()).expiresAt).toEqual(
        session.expiresAt,
      );
      vi.setSystemTime(started + 28_800_001);
      expect(
        (
          await request(restarted)
            .get('/api/v1/auth/get-session')
            .set('Cookie', cookie)
        ).body,
      ).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  }));
it('logout revokes only current session; reset and deactivation revoke every session', async () =>
  withFixture(async (f) => {
    await admin(f);

    const first = cookieOf(await login(f));
    const second = cookieOf(await login(f));

    await request(f.app)
      .post('/api/v1/auth/sign-out')
      .set('Origin', f.env.APP_ORIGIN)
      .set('Cookie', first);
    expect(
      (
        await request(f.app)
          .get('/api/v1/auth/get-session')
          .set('Cookie', second)
      ).body.user.role,
    ).toBe('admin');
    await f.operator.resetPassword(' ADMIN@example.test ', 'New-password-123!');
    expect(await f.database.session.count()).toBe(0);
    expect((await login(f)).status).toBe(401);
    expect(
      (await login(f, undefined, { password: 'New-password-123!' })).status,
    ).toBe(200);
    await expect(f.operator.deactivate('admin@example.test')).rejects.toThrow(
      /last active Admin/,
    );
    await f.operator.create({
      name: 'Another',
      email: 'another@example.test',
      role: 'admin',
      password,
    });
    await f.operator.deactivate('admin@example.test');
    expect(await f.database.session.count()).toBe(0);
    expect(
      (
        await request(f.app)
          .get('/api/v1/auth/get-session')
          .set('Cookie', second)
      ).body,
    ).toBeNull();
    await expect(f.operator.deactivate('missing@example.test')).rejects.toThrow(
      /not found/,
    );
    await expect(
      f.operator.resetPassword('missing@example.test', password),
    ).rejects.toThrow(/not found/);
    await expect(
      f.operator.create(
        { name: 'Again', email: 'again@example.test', role: 'admin', password },
        true,
      ),
    ).rejects.toThrow(/bootstrap refused/);
  }));
it('produces exact secure host-only production session cookies and clears the same cookie', async () =>
  withFixture(async (f) => {
    await admin(f);

    const env = {
      ...f.env,
      NODE_ENV: 'production' as const,
      APP_ORIGIN: 'https://agency.test',
      BETTER_AUTH_URL: 'https://agency.test/api/v1/auth',
    };
    const app = express();

    mountAuth(app, createStaffAuth(env, f.database), env);

    const response = await request(app)
      .post('/api/v1/auth/sign-in/email')
      .set('Origin', env.APP_ORIGIN)
      .send(data());

    expect(response.status).toBe(200);

    const header = (response.headers['set-cookie'] as unknown as string[]).find(
      (value) => value.startsWith('__Host-agency.session='),
    )!;

    expect(header).toBeTruthy();
    expect(header).toMatch(/; Secure/i);
    expect(header).not.toMatch(/Domain=/i);
    expect(header).toMatch(/Path=\//i);

    const logout = await request(app)
      .post('/api/v1/auth/sign-out')
      .set('Origin', env.APP_ORIGIN)
      .set('Cookie', header.split(';')[0]!);

    expect(
      (logout.headers['set-cookie'] as unknown as string[]).join(';'),
    ).toMatch(/__Host-agency.session=;.*Max-Age=0/i);
  }));
it('database outage is a safe non-2xx auth failure and health stays public', async () =>
  withFixture(async (f) => {
    await admin(f);

    const cookie = cookieOf(await login(f));

    await f.database.$executeRawUnsafe('DROP TABLE Session');

    const response = await request(f.app)
      .get('/api/v1/auth/get-session')
      .set('Cookie', cookie);

    expect(response.status).toBe(500);
    expect(response.body).not.toBeNull();
    expect(JSON.stringify(response.body)).not.toMatch(
      /SELECT|Prisma|sqlite|stack|\.ts:/i,
    );
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-request-id']).toBeTruthy();
    expect((await request(f.app).get('/api/v1/health')).status).toBe(200);
  }));
