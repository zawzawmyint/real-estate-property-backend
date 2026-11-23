import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import request from 'supertest';
import { expect, it } from 'vitest';
import { leadFixture } from './lead-fixture.js';
import { smtpFixture } from './email-smtp-fixture.js';
import { readWorkerConfig } from '../src/modules/email/email.config.js';
import { createEmailCrypto } from '../src/modules/email/email.crypto.js';
import { createEmailRepository } from '../src/modules/email/email.repository.js';
import {
  createEmailSender,
  type EmailMessage,
} from '../src/modules/email/email.sender.js';
import { startEmailRuntime } from '../src/modules/email/email.worker.js';
import { createViewingEmailProducer } from '../src/modules/viewings/viewings.emails.js';
import { createTaskEmailReminderScanner } from '../src/modules/tasks/tasks.emails.js';
import { serializedTransaction } from '../src/infrastructure/database/transaction.js';
import { day } from '../src/modules/email/email.types.js';

it('delivers customer viewing kinds and a task reminder through the shared queue and captured SMTP', async () => {
  const f = await leadFixture({ transactionalEmails: true });
  const smtp = await smtpFixture();
  const config = readWorkerConfig({
    ...f.env,
    REDIS_URL: process.env.EMAIL_TEST_REDIS_URL ?? 'redis://127.0.0.1:6379',
    EMAIL_QUEUE_PREFIX: `email-feature-${randomUUID()}`,
    EMAIL_RATE_LIMIT_MAX: '20',
    EMAIL_RATE_LIMIT_DURATION_MS: '1000',
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: '587',
    SMTP_SECURE: 'false',
    SMTP_FROM: 'sender@example.test',
  });
  const sender = createEmailSender({
    host: '127.0.0.1',
    port: smtp.port,
    secure: false,
    requireTLS: false,
    from: 'sender@example.test',
    replyTo: config.replyTo,
  });
  const captured: EmailMessage[] = [];
  const runtime = await startEmailRuntime({
    config,
    repository: createEmailRepository(
      f.database,
      createEmailCrypto(config),
      config,
    ),
    healthPort: 0,
    sender: {
      ...sender,
      async send(message) {
        const result = await sender.send(message);
        captured.push(message);
        return result;
      },
    },
  });
  const viewingWrite = (method: 'post' | 'patch', path = '') => {
    const client = request(f.app);
    return client[method](`/api/v1/staff/viewings${path}`)
      .set('Cookie', f.cookies.manager!)
      .set('Origin', f.env.APP_ORIGIN);
  };
  const waitFor = async (to: string, subject: string) => {
    await expect
      .poll(
        () =>
          captured.filter(
            (message) => message.to === to && message.subject === subject,
          ).length,
        { timeout: 10000 },
      )
      .toBe(1);
  };
  try {
    const lead = await f.create(
      { email: 'viewing-recipient@example.test' },
      'agent',
    );
    const property = await f.database.property.create({
      data: {
        title: 'Captured visit',
        purpose: 'sale',
        publishingState: 'published',
        availability: 'available',
      },
    });
    const times = (days: number) => {
      const startsAt = new Date(Date.now() + days * day);
      return {
        startsAt: startsAt.toISOString(),
        endsAt: new Date(startsAt.getTime() + 3600000).toISOString(),
      };
    };
    const created = await viewingWrite('post').send({
      submissionId: randomUUID(),
      leadId: lead.id,
      propertyId: property.id,
      expectedLeadVersion: 1,
      ...times(3),
    });
    expect(created.status).toBe(201);
    await waitFor(lead.email, 'Your viewing is confirmed');
    const changed = await viewingWrite('patch', `/${created.body.id}`).send({
      expectedVersion: 1,
      expectedLeadVersion: 1,
      ...times(4),
    });
    expect(changed.status).toBe(200);
    await waitFor(lead.email, 'Your viewing has been rescheduled');
    expect(
      (
        await viewingWrite('patch', `/${created.body.id}/status`).send({
          expectedVersion: 2,
          status: 'cancelled',
        })
      ).status,
    ).toBe(200);
    await waitFor(lead.email, 'Your viewing has been cancelled');

    const reminderLead = await f.create(
      { email: 'reminder-recipient@example.test' },
      'agent',
    );
    const reminderViewing = await viewingWrite('post').send({
      submissionId: randomUUID(),
      leadId: reminderLead.id,
      propertyId: property.id,
      expectedLeadVersion: 1,
      ...times(0.5),
    });
    expect(reminderViewing.status).toBe(201);
    await waitFor(reminderLead.email, 'Your viewing is confirmed');
    // Model a previously captured schedule event whose durable reminder is now due.
    await serializedTransaction(f.database, (tx) =>
      createViewingEmailProducer(config, () => Date.now() - 2 * day)(
        tx,
        reminderViewing.body.id,
        'confirmed',
        f.ids.agent!,
      ),
    );
    await waitFor(reminderLead.email, 'Reminder for your upcoming viewing');
    const reminder = captured.find(
      (message) =>
        message.to === reminderLead.email &&
        message.subject === 'Reminder for your upcoming viewing',
    )!;
    expect(reminder.text).toContain('Dubai time, UTC+4');
    expect(reminder.text).not.toContain('/crm');

    await f.database.task.create({
      data: {
        submissionId: randomUUID(),
        actorScope: f.ids.agent!,
        payloadHash: 'fixture',
        leadId: reminderLead.id,
        title: 'Private task title',
        notes: 'Private task notes',
        dueAt: new Date(Date.now() + 10 * 60000),
      },
    });
    await createTaskEmailReminderScanner(f.database, config)();
    await waitFor('agent@lead-fixture.test', 'A follow-up task is due soon');
    expect(
      captured.every((message) => !message.text.includes('Private task notes')),
    ).toBe(true);
  } finally {
    await runtime.close();
    await smtp.close();
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
      await f.close();
    }
  }
}, 30000);
