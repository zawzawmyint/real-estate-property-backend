import { expect, it } from 'vitest';
import { parseEnv } from '../src/config/env.js';

it('requires a server auth secret and consistent browser origin', () => {
  expect(() => parseEnv({})).toThrow(/BETTER_AUTH_SECRET/);
  expect(() =>
    parseEnv({
      BETTER_AUTH_SECRET: 'x'.repeat(32),
      APP_ORIGIN: 'http://localhost:3100',
      BETTER_AUTH_URL: 'http://elsewhere/api/v1/auth',
    }),
  ).toThrow(/BETTER_AUTH_URL/);
});

it('preserves existing public-media origin configuration while auth origins stay exact', () => {
  expect(
    parseEnv({
      BETTER_AUTH_SECRET: 'test-only-secret-for-authentication-integration',
      PUBLIC_ORIGIN: 'http://localhost:4311/',
    }).PUBLIC_ORIGIN,
  ).toBe('http://localhost:4311/');
  expect(() =>
    parseEnv({
      BETTER_AUTH_SECRET: 'test-only-secret-for-authentication-integration',
      APP_ORIGIN: 'http://localhost:3100/',
    }),
  ).toThrow(/APP_ORIGIN/);
});
