import request from 'supertest';
import { expect, it } from 'vitest';
import { authFixture } from './auth-fixture.js';

it('native SQLite credentials login, database session and revocation round trip', async () => {
  const fixture = await authFixture();

  try {
    expect(
      (await request(fixture.app).get('/api/v1/auth/get-session')).body,
    ).toBeNull();
    await fixture.operator.create(
      {
        name: 'Test Admin',
        email: 'ADMIN@example.test',
        password: 'Test-password-123!',
        role: 'admin',
      },
      true,
    );

    const login = await request(fixture.app)
      .post('/api/v1/auth/sign-in/email')
      .set('Origin', fixture.env.APP_ORIGIN)
      .send({
        email: 'admin@example.test',
        password: 'Test-password-123!',
        rememberMe: true,
      });

    expect(login.status, JSON.stringify(login.body)).toBe(200);

    const cookie = (
      login.headers['set-cookie'] as unknown as string[]
    )[0]!.split(';')[0]!;

    expect(cookie).toMatch(/^agency.session=/);

    const session = await request(fixture.app)
      .get('/api/v1/auth/get-session')
      .set('Cookie', cookie);

    expect(session.status).toBe(200);
    expect(session.body.user.role).toBe('admin');
    expect(await fixture.database.session.count()).toBe(1);

    const logout = await request(fixture.app)
      .post('/api/v1/auth/sign-out')
      .set('Origin', fixture.env.APP_ORIGIN)
      .set('Cookie', cookie)
      .send({});

    expect(logout.body).toEqual({ success: true });
    expect(
      (
        await request(fixture.app)
          .get('/api/v1/auth/get-session')
          .set('Cookie', cookie)
      ).body,
    ).toBeNull();
  } finally {
    await fixture.close();
  }
});
