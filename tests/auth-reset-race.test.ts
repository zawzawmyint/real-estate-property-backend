import { expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { requireStaff } from '../src/modules/auth/auth.middleware.js';
import { requestId } from '../src/middleware/request-id.js';
import { errorHandler } from '../src/middleware/error-handler.js';
import { createLogger } from '../src/shared/logger.js';
import { authFixture } from './auth-fixture.js';

it('reset is a barrier against in-flight logins that already verified the old password', async () => {
  const f = await authFixture();

  try {
    await f.operator.create({
      name: 'Race',
      email: 'race@example.test',
      role: 'admin',
      password: 'Old-password-123!',
    });

    const context = await f.auth.$context;
    const originalVerify = context.password.verify;
    let observed!: () => void;
    let release!: () => void;
    const verified = new Promise<void>((resolve) => {
      observed = resolve;
    });
    const resume = new Promise<void>((resolve) => {
      release = resolve;
    });

    context.password.verify = async (input) => {
      const valid = await originalVerify(input);

      observed();
      await resume;

      return valid;
    };

    const login = f.auth.api.signInEmail({
      body: {
        email: 'race@example.test',
        password: 'Old-password-123!',
        rememberMe: true,
      },
      asResponse: true,
    });

    await verified;
    await f.operator.resetPassword('race@example.test', 'New-password-123!');
    expect(await f.database.session.count()).toBe(0);
    release();

    const response = await login;

    expect(response.status).toBe(401);
    expect(
      response.headers
        .getSetCookie()
        .some(
          (value) =>
            value.startsWith('agency.session=') &&
            !value.startsWith('agency.session=;'),
        ),
    ).toBe(false);
    expect(await f.database.session.count()).toBe(0);
  } finally {
    await f.close();
  }
});

it('rejects a stale generation inserted after reset on native lookup and the real guard', async () => {
  const f = await authFixture();

  try {
    await f.operator.create({
      name: 'Race',
      email: 'race@example.test',
      role: 'admin',
      password: 'Old-password-123!',
    });

    const signedIn = await f.auth.api.signInEmail({
      body: {
        email: 'race@example.test',
        password: 'Old-password-123!',
        rememberMe: true,
      },
      asResponse: true,
    });
    const cookie = signedIn.headers
      .getSetCookie()
      .find((value) => value.startsWith('agency.session='))!
      .split(';')[0]!;
    const original = await f.database.session.findFirstOrThrow();

    await f.operator.resetPassword('race@example.test', 'New-password-123!');
    await f.database.session.create({ data: original });
    expect(
      await f.auth.api.getSession({ headers: new Headers({ cookie }) }),
    ).toBeNull();

    const app = express();

    app.use(requestId);
    app.get('/restricted', requireStaff(f.auth, ['admin']), (_req, res) =>
      res.json({ staff: res.locals.staff }),
    );
    app.use(errorHandler(createLogger('silent')));
    expect(
      (await request(app).get('/restricted').set('Cookie', cookie)).status,
    ).toBe(401);

    const fresh = await f.auth.api.signInEmail({
      body: {
        email: 'race@example.test',
        password: 'New-password-123!',
        rememberMe: true,
      },
      asResponse: true,
    });

    expect(fresh.status).toBe(200);

    const responseText = await fresh.text();

    expect(responseText).not.toMatch(/credentialVersion/);
  } finally {
    await f.close();
  }
});
