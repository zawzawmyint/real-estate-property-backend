import { appendFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { authFixture } from './auth-fixture.js';
import { readWorkerConfig } from '../src/modules/email/email.config.js';
import { createEmailCrypto } from '../src/modules/email/email.crypto.js';
import { createEmailRepository } from '../src/modules/email/email.repository.js';
import { createEmailSender } from '../src/modules/email/email.sender.js';
import { startEmailRuntime } from '../src/modules/email/email.worker.js';
import { smtpFixture } from './email-smtp-fixture.js';

/** Explicit opt-in disposable browser environment. This never uses live SMTP. */
export async function startEmailBrowserFixture(
  fixture: Awaited<ReturnType<typeof authFixture>>,
) {
  const file = process.env.STAFF_E2E_EMAIL_CAPTURE_FILE;
  if (!file) throw new Error('EMAIL_CAPTURE_FILE_REQUIRED');
  await writeFile(file, '', { mode: 0o600 });
  const smtp = await smtpFixture();
  const config = readWorkerConfig({
    ...fixture.env,
    DATABASE_URL: fixture.env.DATABASE_URL,
    REDIS_URL:
      process.env.EMAIL_TEST_REDIS_URL ??
      process.env.REDIS_URL ??
      'redis://127.0.0.1:6379',
    EMAIL_QUEUE_PREFIX: `email-browser-${randomUUID()}`,
    EMAIL_RATE_LIMIT_MAX: '20',
    EMAIL_RATE_LIMIT_DURATION_MS: '1000',
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: '587',
    SMTP_SECURE: 'false',
    SMTP_FROM: 'sender@example.test',
  });
  const crypto = createEmailCrypto(config);
  const repository = createEmailRepository(fixture.database, crypto, config);
  const sender = createEmailSender({
    host: '127.0.0.1',
    port: smtp.port,
    secure: false,
    requireTLS: false,
    from: 'agency@example.test',
    replyTo: 'help@example.test',
  });
  const runtime = await startEmailRuntime({
    config,
    repository,
    healthPort: 0,
    sender: {
      ...sender,
      async send(message) {
        const result = await sender.send(message);
        await appendFile(file, JSON.stringify(message) + '\n');
        return result;
      },
    },
  });
  return async () => {
    await runtime.close();
    await smtp.close();
    const { Redis } = await import('ioredis');
    const redis = new Redis(config.redisUrl);
    redis.on('error', () => undefined);
    try {
      let cursor = '0';
      do {
        const [next, keys] = await redis.scan(
          cursor,
          'MATCH',
          `${config.prefix}:*`,
          'COUNT',
          100,
        );
        cursor = next;
        if (keys.length) await redis.del(...keys);
      } while (cursor !== '0');
    } finally {
      redis.disconnect();
    }
  };
}
