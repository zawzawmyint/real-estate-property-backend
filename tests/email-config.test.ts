import { expect, it } from 'vitest';
import {
  readProducerConfig,
  readWorkerConfig,
} from '../src/modules/email/email.config.js';
export const emailTestConfig = {
  EMAIL_ENQUIRY_NOTIFICATIONS_ENABLED: 'true',
  EMAIL_PAYLOAD_KEYS: JSON.stringify({
    test: Buffer.alloc(32, 1).toString('base64'),
  }),
  EMAIL_PAYLOAD_ACTIVE_KEY_ID: 'test',
  EMAIL_BRAND_NAME: 'Avenor',
  APP_ORIGIN: 'http://localhost:3100',
  SMTP_REPLY_TO: 'help@example.test',
};
it('disabled producer needs no delivery configuration; enabled producer needs no Redis/SMTP connection', () => {
  expect(readProducerConfig({})).toBeNull();
  expect(readProducerConfig(emailTestConfig)?.activeKeyId).toBe('test');
  expect(() =>
    readProducerConfig({ EMAIL_ENQUIRY_NOTIFICATIONS_ENABLED: true }),
  ).toThrow('EMAIL_CONFIG');
  expect(() =>
    readProducerConfig({
      ...emailTestConfig,
      EMAIL_PAYLOAD_KEYS: 'SECRET malformed',
    }),
  ).toThrow(/^EMAIL_CONFIG/);
});
it('worker requires its own database, keys, Redis and rate budget but no auth/chat secrets', () => {
  const input = {
    ...emailTestConfig,
    EMAIL_ENQUIRY_NOTIFICATIONS_ENABLED: 'false',
    DATABASE_URL: 'file:./var/test.db',
    REDIS_URL: 'redis://localhost:6379',
    EMAIL_QUEUE_PREFIX: 'agency-test',
    EMAIL_RATE_LIMIT_MAX: '2',
    SMTP_HOST: 'smtp.example.test',
    SMTP_PORT: '587',
    SMTP_SECURE: 'false',
    SMTP_FROM: 'sender@example.test',
  };
  expect(readWorkerConfig(input).rateMax).toBe(2);
  expect(() =>
    readWorkerConfig({ ...input, EMAIL_RATE_LIMIT_MAX: '0' }),
  ).toThrow('EMAIL_CONFIG');
  expect(() => readWorkerConfig({ ...input, NODE_ENV: 'production' })).toThrow(
    'EMAIL_CONFIG',
  );
});
