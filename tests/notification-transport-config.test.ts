import { expect, it } from 'vitest';
import { readNotificationTransportConfig } from '../src/modules/notifications/notifications.config.js';
import { parseEnv } from '../src/config/env.js';

const enabled = {
  NOTIFICATION_SIGNAL_TRANSPORT: 'redis',
  REDIS_URL: 'redis://127.0.0.1:16386',
  NOTIFICATION_REDIS_CHANNEL: 'agency:test:notifications',
};

it('defaults to memory without Redis or SMTP and ignores unrelated Redis settings', () => {
  expect(readNotificationTransportConfig({})).toEqual({ mode: 'memory' });
  expect(readNotificationTransportConfig({ REDIS_URL: 'bad-secret' })).toEqual({
    mode: 'memory',
  });
});

it('requires channel and Redis URL only in Redis mode', () => {
  expect(readNotificationTransportConfig(enabled)).toEqual({
    mode: 'redis',
    redisUrl: enabled.REDIS_URL,
    channel: enabled.NOTIFICATION_REDIS_CHANNEL,
  });
  for (const key of ['REDIS_URL', 'NOTIFICATION_REDIS_CHANNEL']) {
    expect(() =>
      readNotificationTransportConfig({ ...enabled, [key]: undefined }),
    ).toThrow(key);
  }
});

it('rejects malformed mode, channel and URL without including supplied secrets', () => {
  for (const input of [
    { NOTIFICATION_SIGNAL_TRANSPORT: 'unknown' },
    { ...enabled, NOTIFICATION_REDIS_CHANNEL: 'bad channel' },
    { ...enabled, NOTIFICATION_REDIS_CHANNEL: 'x'.repeat(129) },
    { ...enabled, REDIS_URL: 'https://user:secret@example.test' },
    { ...enabled, REDIS_URL: 'rediss://' },
    { ...enabled, REDIS_URL: 'redis://user:secret@host/?tls=false' },
  ]) {
    expect(() => readNotificationTransportConfig(input)).toThrow(
      /NOTIFICATION_CONFIG_INVALID/,
    );
    try {
      readNotificationTransportConfig(input);
    } catch (error) {
      expect(String(error)).not.toContain('secret');
    }
  }
  expect(
    readNotificationTransportConfig({
      ...enabled,
      NOTIFICATION_REDIS_CHANNEL: 'a'.repeat(128),
    }).mode,
  ).toBe('redis');
});

it('requires authenticated verified TLS in production', () => {
  expect(() =>
    readNotificationTransportConfig({ ...enabled, NODE_ENV: 'production' }),
  ).toThrow('REDIS_URL');
  expect(() =>
    readNotificationTransportConfig({
      ...enabled,
      NODE_ENV: 'production',
      REDIS_URL: 'rediss://host',
    }),
  ).toThrow('REDIS_URL');
  expect(
    readNotificationTransportConfig({
      ...enabled,
      NODE_ENV: 'production',
      REDIS_URL: 'rediss://user:password@host:6380/0',
    }).mode,
  ).toBe('redis');
});

it('validates notification configuration through API environment parsing', () => {
  const base = {
    BETTER_AUTH_SECRET: 'test-only-secret-for-authentication-integration',
  };
  expect(() =>
    parseEnv({ ...base, ...enabled, NOTIFICATION_REDIS_CHANNEL: '' }),
  ).toThrow('NOTIFICATION_REDIS_CHANNEL');
  const env = parseEnv({ ...base, ...enabled });
  expect(env.NOTIFICATION_SIGNAL_TRANSPORT).toBe('redis');
  expect(env.REDIS_URL).toBe(enabled.REDIS_URL);
});
