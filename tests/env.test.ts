import { expect, it } from 'vitest';
import { parseEnv } from '../src/config/env.js';

it('rejects invalid configuration with actionable field names', () => {
  expect(() => parseEnv({ PORT: 'banana' })).toThrow(/PORT/);
  expect(() => parseEnv({ DATABASE_URL: 'postgres://remote' })).toThrow(
    /DATABASE_URL/,
  );
  expect(() => parseEnv({ PUBLIC_ORIGIN: 'not a URL' })).toThrow(
    /PUBLIC_ORIGIN/,
  );
});
it('uses local defaults and parses the port as a number', () => {
  const env = parseEnv({
    PORT: '4100',
    BETTER_AUTH_SECRET: 'test-only-secret-for-authentication-integration',
  });

  expect(env.PORT).toBe(4100);
  expect(env.HOST).toBe('127.0.0.1');
  expect(env.DATABASE_URL).toBe('file:./var/data/development.db');
});
