import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Redis } from 'ioredis';
import { afterAll, expect, it, vi } from 'vitest';
import { authFixture } from './auth-fixture.js';
import {
  readWorkerConfig,
  type WorkerConfig,
} from '../src/modules/email/email.config.js';
import { createEmailCrypto } from '../src/modules/email/email.crypto.js';
import { createEmailRepository } from '../src/modules/email/email.repository.js';
import { startEmailRuntime } from '../src/modules/email/email.worker.js';
import { createEnquiryEmailProducer } from '../src/modules/leads/leads.emails.js';
import { serializedTransaction } from '../src/infrastructure/database/transaction.js';

const fixture = await authFixture();
afterAll(() => fixture.close());

function signal() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function config() {
  return readWorkerConfig({
    DATABASE_URL: fixture.env.DATABASE_URL,
    APP_ORIGIN: fixture.env.APP_ORIGIN,
    EMAIL_ENQUIRY_NOTIFICATIONS_ENABLED: true,
    EMAIL_PAYLOAD_KEYS: JSON.stringify({
      test: Buffer.alloc(32, 1).toString('base64'),
    }),
    EMAIL_PAYLOAD_ACTIVE_KEY_ID: 'test',
    SMTP_REPLY_TO: 'help@example.test',
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: '587',
    SMTP_SECURE: 'false',
    SMTP_FROM: 'sender@example.test',
    EMAIL_QUEUE_PREFIX: `email-runtime-${randomUUID()}`,
    REDIS_URL: process.env.EMAIL_TEST_REDIS_URL ?? 'redis://127.0.0.1:6379',
    EMAIL_RATE_LIMIT_MAX: '20',
    EMAIL_RATE_LIMIT_DURATION_MS: '100',
  });
}

async function cleanQueue(settings: WorkerConfig) {
  const redis = new Redis(settings.redisUrl, {
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  });
  redis.on('error', () => undefined);
  try {
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(
        cursor,
        'MATCH',
        `${settings.prefix}:*`,
        'COUNT',
        100,
      );
      cursor = next;
      if (keys.length) await redis.del(...keys);
    } while (cursor !== '0');
  } finally {
    redis.disconnect();
  }
}

it('waits for the active maintenance tick when later intervals are skipped during shutdown', async () => {
  const settings = config();
  const gate = signal(),
    started = signal(),
    finished = signal();
  let block = false;
  const senderClose = vi.fn();
  const repo = createEmailRepository(
    fixture.database,
    createEmailCrypto(settings),
    settings,
  );
  const due = vi.fn((now: number, keyIds: string[]) => repo.due(now, keyIds));
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  const runtime = await startEmailRuntime({
    config: settings,
    repository: {
      ...repo,
      async maintain() {
        if (!block) return;
        started.resolve();
        await gate.promise;
        finished.resolve();
      },
      async hasMissingKeys() {
        return false;
      },
      due,
    },
    healthPort: 0,
    sender: {
      async send() {
        return { messageId: 'unused' };
      },
      close: senderClose,
      activeCount: () => 0,
    },
  });
  let closing: Promise<void> | undefined;
  try {
    block = true;
    await vi.advanceTimersByTimeAsync(1000);
    await started.promise;
    await vi.advanceTimersByTimeAsync(2000);
    const dispatchPassesBeforeStop = due.mock.calls.length;
    closing = runtime.close();
    const state = await Promise.race([
      closing.then(() => 'closed'),
      delay(100).then(() => 'waiting'),
    ]);
    expect(state).toBe('waiting');
    expect(senderClose).not.toHaveBeenCalled();
    expect(await runtime.readiness()).toBe(false);
    gate.resolve();
    await closing;
    expect(senderClose).toHaveBeenCalledOnce();
    expect(due).toHaveBeenCalledTimes(dispatchPassesBeforeStop);
  } finally {
    gate.resolve();
    await finished.promise;
    await (closing ?? runtime.close());
    vi.useRealTimers();
    await cleanQueue(settings);
  }
}, 15000);

it('keeps readiness unavailable after publication fails, including idle ticks, and recovers on publication', async () => {
  const settings = config();
  const repo = createEmailRepository(
    fixture.database,
    createEmailCrypto(settings),
    settings,
  );
  const failed = signal(),
    idle = signal();
  let failureSeen = false;
  let loseAcknowledgement = false;
  let recovering = false;
  const observed: string[] = [];
  const acknowledgementFailed = signal();
  let sends = 0;
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  const runtime = await startEmailRuntime({
    config: settings,
    repository: {
      ...repo,
      async markEnqueued(id, token, now) {
        if (loseAcknowledgement) {
          loseAcknowledgement = false;
          throw new Error('TEST_LEDGER_ACKNOWLEDGEMENT_LOST');
        }
        return repo.markEnqueued(id, token, now);
      },
      due(now, keyIds) {
        const work = repo.due(now, keyIds);
        void work
          .then((rows) => {
            if (failureSeen && rows.length === 0) idle.resolve();
          })
          .catch(() => undefined);
        return work;
      },
    },
    healthPort: 0,
    observe(code) {
      observed.push(code);
      if (
        recovering &&
        ['EMAIL_ENQUEUE_ACK_FAILED', 'REDIS_PUBLISH_FAILED'].includes(code)
      )
        acknowledgementFailed.resolve();
      if (code === 'REDIS_PUBLISH_FAILED') {
        failureSeen = true;
        failed.resolve();
      }
    },
    sender: {
      async send() {
        sends++;
        return { messageId: 'captured' };
      },
      close() {},
      activeCount: () => 0,
    },
  });
  const address = runtime.address;
  if (!address || typeof address === 'string')
    throw new Error('TEST_HEALTH_ADDRESS_REQUIRED');
  const health = `http://127.0.0.1:${address.port}/ready`;
  const add = vi
    .spyOn(runtime.queue, 'add')
    .mockRejectedValue(new Error('TEST_QUEUE_COMMAND_REJECTED'));
  try {
    expect((await fetch(health)).status).toBe(200);
    // Hold queued jobs so reconciliation is tested before SMTP consumption.
    await runtime.queue.pause();
    const lead = await fixture.database.lead.create({
      data: {
        name: 'Visitor',
        searchName: 'visitor',
        searchPhone: '',
        searchEmail: '',
        searchPropertyTitle: '',
        source: 'website',
        purpose: 'sale',
      },
    });
    const id = await serializedTransaction(fixture.database, (tx) =>
      createEnquiryEmailProducer(settings)(tx, {
        leadId: lead.id,
        name: lead.name,
        to: 'visitor@example.test',
        property: null,
      }),
    );
    await vi.advanceTimersByTimeAsync(1000);
    await failed.promise;
    expect((await fetch(health)).status).toBe(503);
    expect(await repo.get(id)).toMatchObject({
      status: 'PENDING',
      lastErrorCode: 'REDIS_PUBLISH_FAILED',
      leaseToken: null,
    });
    expect(sends).toBe(0);
    await vi.advanceTimersByTimeAsync(1000);
    await idle.promise;
    expect((await fetch(health)).status).toBe(503);

    add.mockRestore();
    recovering = true;
    loseAcknowledgement = true;
    await fixture.database.emailNotification.update({
      where: { id },
      data: { nextAttemptAt: new Date(0) },
    });
    await vi.advanceTimersByTimeAsync(1000);
    await acknowledgementFailed.promise;
    await fixture.database.emailNotification.updateMany({
      where: { id, status: { in: ['PENDING', 'ENQUEUED'] } },
      data: { nextAttemptAt: new Date(0) },
    });
    await vi.advanceTimersByTimeAsync(1000);
    await expect.poll(async () => (await fetch(health)).status).toBe(200);
    await runtime.queue.resume();
    await expect
      .poll(async () => (await repo.get(id))?.status, { timeout: 10000 })
      .toBe('SUBMITTED');
    expect(observed).toContain('EMAIL_ENQUEUE_ACK_FAILED');
    expect(sends).toBe(1);
  } finally {
    add.mockRestore();
    await runtime.close();
    vi.useRealTimers();
    await cleanQueue(settings);
  }
}, 15000);
