import { Queue, Worker } from 'bullmq';
import { setTimeout as delay } from 'node:timers/promises';
import { createEmailOutbox } from '../src/modules/email/email.outbox.js';
import {
  createEmailQueue,
  emailConnection,
} from '../src/modules/email/email.queue.js';
import { randomUUID } from 'node:crypto';
import { afterAll, expect, it } from 'vitest';
import { authFixture } from './auth-fixture.js';
import { readWorkerConfig } from '../src/modules/email/email.config.js';
import { createEmailCrypto } from '../src/modules/email/email.crypto.js';
import { createEnquiryEmailProducer } from '../src/modules/leads/leads.emails.js';
import { createEmailRepository } from '../src/modules/email/email.repository.js';
import {
  startEmailRuntime,
  openWorkerDatabase,
} from '../src/modules/email/email.worker.js';
import { serializedTransaction } from '../src/infrastructure/database/transaction.js';
import { createEmailSender } from '../src/modules/email/email.sender.js';
import { smtpFixture } from './email-smtp-fixture.js';
import { createEmailDispatcher } from '../src/modules/email/email.dispatcher.js';

// A local Redis is the integration service; credentials never reach captured SMTP.
const redisUrl = process.env.EMAIL_TEST_REDIS_URL ?? 'redis://127.0.0.1:6379';
const fixture = await authFixture();
afterAll(() => fixture.close());
function config(prefix: string) {
  return readWorkerConfig({
    DATABASE_URL: fixture.env.DATABASE_URL,
    APP_ORIGIN: fixture.env.APP_ORIGIN,
    EMAIL_ENQUIRY_NOTIFICATIONS_ENABLED: true,
    EMAIL_STAFF_NOTIFICATIONS_ENABLED: true,
    EMAIL_CUSTOMER_VIEWING_NOTIFICATIONS_ENABLED: true,
    EMAIL_CUSTOMER_VIEWING_ACTIVATED_AT: '2025-01-01T00:00:00Z',
    EMAIL_PAYLOAD_KEYS: JSON.stringify({
      test: Buffer.alloc(32, 1).toString('base64'),
    }),
    EMAIL_PAYLOAD_ACTIVE_KEY_ID: 'test',
    SMTP_REPLY_TO: 'help@example.test',
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: '587',
    SMTP_SECURE: 'false',
    SMTP_FROM: 'sender@example.test',
    EMAIL_QUEUE_PREFIX: prefix,
    REDIS_URL: redisUrl,
    EMAIL_RATE_LIMIT_MAX: '1',
    EMAIL_RATE_LIMIT_DURATION_MS: '500',
  });
}
it('cuts over a retained legacy queue to two workers sharing one rate budget across kinds, recovers a lost job and fences duplicates', async () => {
  const settings = config(`email-test-${randomUUID()}`);
  const crypto = createEmailCrypto(settings),
    repository = createEmailRepository(fixture.database, crypto, settings);
  const smtp = await smtpFixture();
  const captured = createEmailSender({
    host: '127.0.0.1',
    port: smtp.port,
    secure: false,
    requireTLS: false,
    from: 'agency@example.test',
    replyTo: 'help@example.test',
  });
  const sentAt: number[] = [];
  const sender = {
    ...captured,
    async send(message: Parameters<typeof captured.send>[0]) {
      sentAt.push(Date.now());
      return captured.send(message);
    },
  };
  const formerConnection = emailConnection(settings, true);
  const formerQueue = new Queue('enquiry-emails', {
    connection: formerConnection,
    prefix: settings.prefix,
  });
  // The stopped predecessor leaves one completed job, one waiting job and its own limiter history.
  const legacy = await fixture.database.lead.create({
    data: {
      name: 'Visitor',
      searchName: 'visitor',
      searchEmail: '',
      searchPhone: '',
      searchPropertyTitle: '',
      source: 'website',
      purpose: 'sale',
    },
  });
  const recordAck = createEnquiryEmailProducer(settings);
  const legacyId = await serializedTransaction(fixture.database, (tx) =>
    recordAck(tx, {
      leadId: legacy.id,
      to: 'visitor@example.test',
      name: 'Visitor',
      property: null,
    }),
  );
  const formerWorker = new Worker(
    'enquiry-emails',
    async (job) => {
      const row = await repository.claimSend(
        job.data.notificationId,
        Date.now,
        'former',
        ['test'],
      );
      if (!row) throw new Error('Expected a live legacy intent');
      const { renderEmail } =
        await import('../src/modules/email/email.templates.js');
      const result = await sender.send(
        renderEmail(row.kind, row.templateVersion, row.payload),
      );
      await repository.finish(
        job.data.notificationId,
        'former',
        'SUBMITTED',
        Date.now(),
        undefined,
        result.messageId,
      );
    },
    {
      connection: formerConnection,
      prefix: settings.prefix,
      limiter: { max: settings.rateMax, duration: settings.rateDuration },
    },
  );
  try {
    await formerQueue.add(
      'send-email',
      { notificationId: legacyId },
      { jobId: legacyId },
    );
    await expect
      .poll(() => formerQueue.getJobState(legacyId))
      .toBe('completed');
  } finally {
    await formerWorker.close();
  }
  const migratedLead = await fixture.database.lead.create({
    data: {
      name: 'Customer',
      email: 'customer@example.test',
      searchName: 'customer',
      searchEmail: '',
      searchPhone: '',
      searchPropertyTitle: '',
      source: 'website',
      purpose: 'sale',
    },
  });
  const migratedId = await serializedTransaction(fixture.database, (tx) =>
    recordAck(tx, {
      leadId: migratedLead.id,
      to: migratedLead.email!,
      name: migratedLead.name,
      property: null,
    }),
  );
  await formerQueue.add(
    'send-email',
    { notificationId: migratedId },
    { jobId: migratedId },
  );
  await fixture.database.emailNotification.update({
    where: { id: migratedId },
    data: { status: 'ENQUEUED', enqueuedAt: new Date() },
  });
  const staged = createEmailQueue(settings);
  await staged.queue.pause();
  await staged.queue.close();
  staged.connection.disconnect();
  await delay(settings.rateDuration);

  const runtime = await startEmailRuntime({
    config: settings,
    repository,
    sender,
    healthPort: 0,
  });
  const other = await startEmailRuntime({
    config: settings,
    repository,
    sender,
    healthPort: 0,
  });
  try {
    await runtime.worker.pause();
    await other.worker.pause();
    const lead = migratedLead;
    const user = await fixture.database.user.create({
      data: {
        id: randomUUID(),
        name: 'Manager',
        email: 'manager@example.test',
        role: 'manager',
      },
    });
    const property = await fixture.database.property.create({
      data: { title: 'Palm Home', purpose: 'sale' },
    });
    const startsAt = new Date(Date.now() + 86_400_000),
      endsAt = new Date(startsAt.getTime() + 3_600_000);
    const viewing = await fixture.database.viewing.create({
      data: {
        submissionId: randomUUID(),
        actorScope: 'fixture',
        payloadHash: 'fixture',
        leadId: lead.id,
        propertyId: property.id,
        propertyTitleSnapshot: property.title,
        startsAt,
        endsAt,
      },
    });
    const write = createEmailOutbox(settings);
    const createdAt = new Date();
    const common = {
      publicOrigin: settings.origin,
      brand: settings.brand,
      replyTo: settings.replyTo,
    };
    const intent = {
      templateVersion: 1 as const,
      leadId: lead.id,
      createdAt,
      nextAttemptAt: createdAt,
      expiresAt: startsAt,
    };
    const ids = await serializedTransaction(fixture.database, async (tx) => [
      migratedId,
      await write(tx, {
        ...intent,
        kind: 'STAFF_WEBSITE_ENQUIRY_RECEIVED',
        dedupeKey: 'staff:' + lead.id,
        recipientUserId: user.id,
        payload: {
          ...common,
          to: user.email,
          name: user.name,
          crmUrl: settings.origin + '/crm/leads/' + lead.id,
        },
      }),
      await write(tx, {
        ...intent,
        kind: 'CUSTOMER_VIEWING_CONFIRMED',
        dedupeKey: 'customer:' + viewing.id,
        viewingId: viewing.id,
        sourceVersion: viewing.version,
        scheduledStartsAt: startsAt,
        scheduledEndsAt: endsAt,
        payload: {
          ...common,
          name: lead.name,
          to: lead.email!,
          propertyTitle: property.title,
          location: null,
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
        },
      }),
    ]);
    await runtime.dispatch(true);
    const lost = await runtime.queue.getJob(ids[0]!);
    await lost?.remove();
    await fixture.database.emailNotification.update({
      where: { id: ids[0]! },
      data: { enqueuedAt: new Date(0) },
    });
    await runtime.dispatch(true);
    expect(await runtime.queue.getJob(ids[0]!)).toBeTruthy();
    await runtime.queue.resume();
    await runtime.worker.resume();
    await other.worker.resume();
    await expect
      .poll(
        () =>
          fixture.database.emailNotification.count({
            where: { id: { in: ids }, status: 'SUBMITTED' },
          }),
        { timeout: 12_000 },
      )
      .toBe(3);
    expect(sentAt).toHaveLength(4);
    expect(
      Math.max(...sentAt.slice(1)) - Math.min(...sentAt.slice(1)),
    ).toBeGreaterThanOrEqual(850);
    expect(smtp.messages).toHaveLength(4);
    expect(smtp.messages.join('\n')).toContain('Subject: New website enquiry');
    expect(smtp.messages.join('\n')).toContain(
      'Subject: Your viewing is confirmed',
    );
    expect(await formerQueue.getJobState(legacyId)).toBe('completed');
    expect(await formerQueue.getJobState(ids[0]!)).toBe('waiting');
    for (const id of ids)
      expect((await runtime.queue.getJob(id))?.data).toEqual({
        notificationId: id,
      });
    await runtime.queue.add(
      'send-email',
      { notificationId: ids[0]! },
      { jobId: randomUUID() },
    );
    await expect
      .poll(
        async () =>
          (await runtime.queue.getJobCounts('waiting', 'active')).active ?? 0,
      )
      .toBe(0);
    expect(sentAt).toHaveLength(4);
    expect(await runtime.readiness()).toBe(true);
    await runtime.worker.pause();
    expect(await runtime.readiness()).toBe(false);
  } finally {
    await runtime.close();
    await other.close();
    await formerQueue.close();
    formerConnection.disconnect();
    // Delete only this disposable queue prefix, never FLUSHDB/shared reference data.
    const { Redis } = await import('ioredis');
    const redis = new Redis(redisUrl);
    try {
      let cursor = '0';
      do {
        const result = await redis.scan(
          cursor,
          'MATCH',
          `${settings.prefix}:*`,
          'COUNT',
          100,
        );
        cursor = result[0];
        if (result[1].length) await redis.del(...result[1]);
      } while (cursor !== '0');
    } finally {
      redis.disconnect();
    }
    await smtp.close();
  }
}, 25_000);
it('worker refuses missing databases without creating files', async () => {
  await expect(
    openWorkerDatabase(`file:${fixture.directory}/missing/development.db`),
  ).rejects.toThrow();
});

it('survives Redis publish success with failed ledger acknowledgement and completes missing-key jobs without a retry loop', async () => {
  const settings = {
    ...config(`email-window-${randomUUID()}`),
    rateMax: 1,
    rateDuration: 100,
  };
  const crypto = createEmailCrypto(settings),
    repository = createEmailRepository(fixture.database, crypto, settings);
  let sent = 0;
  const runtime = await startEmailRuntime({
    config: settings,
    repository,
    healthPort: 0,
    sender: {
      async send() {
        sent++;
        return { messageId: 'captured' };
      },
      close() {},
      activeCount: () => 0,
    },
  });
  const makeIntent = async () => {
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
    return serializedTransaction(fixture.database, (tx) =>
      createEnquiryEmailProducer(settings)(tx, {
        leadId: lead.id,
        name: 'Visitor',
        to: 'visitor@example.test',
        property: null,
      }),
    );
  };
  try {
    await runtime.worker.pause();
    const id = await makeIntent();
    const dispatch = createEmailDispatcher(
      {
        ...repository,
        async markEnqueued() {
          throw new Error('ACK_LOST');
        },
      },
      runtime.queue,
      ['test'],
      () => undefined,
    );
    await dispatch(true);
    expect(await runtime.queue.getJob(id)).toBeTruthy();
    expect((await repository.get(id))?.status).toBe('PENDING');
    await fixture.database.emailNotification.update({
      where: { id },
      data: { nextAttemptAt: new Date(0) },
    });
    await runtime.worker.resume();
    await expect
      .poll(async () => (await repository.get(id))?.status)
      .toBe('SUBMITTED');
    expect(sent).toBe(1);
    await runtime.worker.pause();
    const blocked: string[] = [];
    for (let index = 0; index < 3; index++) {
      const blockedId = await makeIntent();
      blocked.push(blockedId);
      await fixture.database.emailNotification.update({
        where: { id: blockedId },
        data: {
          status: 'ENQUEUED',
          payloadKeyId: 'removed-key',
          enqueuedAt: new Date(),
        },
      });
      await runtime.queue.add(
        'send-email',
        { notificationId: blockedId },
        { jobId: blockedId },
      );
    }
    const healthy = await makeIntent();
    await runtime.dispatch(true);
    await runtime.worker.resume();
    await expect
      .poll(async () => (await runtime.queue.getJob(blocked[0]!))?.getState(), {
        timeout: 3000,
      })
      .toBe('completed');
    await expect
      .poll(async () => (await repository.get(healthy))?.status)
      .toBe('SUBMITTED');
    expect(sent).toBe(2);
    for (const blockedId of blocked)
      expect((await repository.get(blockedId))?.sendAttempts).toBe(0);
    // Restore the original key and reconcile the completed Redis job from the ledger.
    await fixture.database.emailNotification.updateMany({
      where: { id: { in: blocked } },
      data: { payloadKeyId: 'test', enqueuedAt: new Date(0) },
    });
    await runtime.dispatch(true);
    await expect
      .poll(() =>
        fixture.database.emailNotification.count({
          where: { id: { in: blocked }, status: 'SUBMITTED' },
        }),
      )
      .toBe(3);
    expect(sent).toBe(5);
  } finally {
    await runtime.close();
    const { Redis } = await import('ioredis');
    const redis = new Redis(redisUrl);
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
}, 20_000);
