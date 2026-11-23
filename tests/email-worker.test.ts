import { afterAll, expect, it } from 'vitest';
import { authFixture } from './auth-fixture.js';
import { createDatabase } from '../src/infrastructure/database/client.js';
import { serializedTransaction } from '../src/infrastructure/database/transaction.js';
import { createEnquiryEmailProducer } from '../src/modules/leads/leads.emails.js';
import { createEmailCrypto } from '../src/modules/email/email.crypto.js';
import { readProducerConfig } from '../src/modules/email/email.config.js';
import { createEmailRepository } from '../src/modules/email/email.repository.js';
import {
  createEmailConsumer,
  classifySmtpFailure,
} from '../src/modules/email/email.consumer.js';
import { renderEmail } from '../src/modules/email/email.templates.js';
import { day } from '../src/modules/email/email.types.js';

const fixture = await authFixture();
const second = await createDatabase(fixture.env.DATABASE_URL);
afterAll(async () => {
  await second.$disconnect();
  await fixture.close();
});
const config = readProducerConfig({
  EMAIL_ENQUIRY_NOTIFICATIONS_ENABLED: true,
  EMAIL_PAYLOAD_KEYS: JSON.stringify({
    test: Buffer.alloc(32, 1).toString('base64'),
  }),
  EMAIL_PAYLOAD_ACTIVE_KEY_ID: 'test',
  APP_ORIGIN: 'http://localhost:3100',
  SMTP_REPLY_TO: 'help@example.test',
})!;
const crypto = createEmailCrypto(config);
const repo = createEmailRepository(fixture.database, crypto);
const repo2 = createEmailRepository(second, crypto);
async function intent(now = Date.now()) {
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
    createEnquiryEmailProducer(config, () => now)(tx, {
      leadId: lead.id,
      to: 'visitor@example.test',
      name: '<script>Visitor</script>',
      property: { id: 'safe-id', title: 'Home & garden' },
    }),
  );
}
it('fences two clients, stale dispatch acknowledgements and terminal replay jobs', async () => {
  const now = Date.now(),
    id = await intent(now);
  expect(await repo.claimDispatch(id, now, 'dispatch')).toBeTruthy();
  const claims = await Promise.all([
    repo.claimSend(id, now, 'a', ['test']),
    repo2.claimSend(id, now, 'b', ['test']),
  ]);
  expect(claims.filter(Boolean)).toHaveLength(1);
  const winner = claims[0] ? 'a' : 'b';
  expect(await repo.markEnqueued(id, 'dispatch', now)).toBe(false);
  expect(await repo.finish(id, 'wrong', 'SUBMITTED', now)).toBe(false);
  expect(await repo.finish(id, winner, 'SUBMITTED', now)).toBe(true);
  expect(await repo.claimSend(id, now, 'again', ['test'])).toBeNull();
});
it('retries only provably rejected sends and never automatically retries uncertainty', async () => {
  let now = Date.now();
  const id = await intent(now);
  let sends = 0;
  const consume = createEmailConsumer({
    repository: repo,
    clock: () => now,
    sender: {
      async send() {
        sends++;
        throw { responseCode: 451 };
      },
      close() {},
      activeCount: () => 0,
    },
  });
  for (const delay of [60_000, 300_000, 1_800_000, 0]) {
    await consume(id);
    const row = await repo.get(id);
    expect(row?.status).toBe(delay ? 'PENDING' : 'FAILED');
    if (delay) {
      expect(row?.nextAttemptAt.getTime()).toBe(now + delay);
      await consume(id);
      now += delay;
    }
  }
  expect(sends).toBe(4);
  const uncertain = await intent(now);
  const ambiguous = createEmailConsumer({
    repository: repo,
    clock: () => now,
    sender: {
      async send() {
        throw { code: 'EABORT' };
      },
      close() {},
      activeCount: () => 0,
    },
  });
  await ambiguous(uncertain);
  await ambiguous(uncertain);
  expect((await repo.get(uncertain))?.status).toBe('UNCERTAIN');
  expect(classifySmtpFailure({ responseCode: 550 })).toBe('FAILED');
  expect(classifySmtpFailure({ code: 'EAUTH', responseCode: 454 })).toBe(
    'FAILED',
  );
  expect(classifySmtpFailure({ code: 'EENVELOPE', responseCode: 450 })).toBe(
    'FAILED',
  );
  expect(classifySmtpFailure({ code: 'ETIMEDOUT', command: 'CONN' })).toBe(
    'RETRY',
  );
  expect(classifySmtpFailure({ code: 'ETIMEDOUT', command: 'DATA' })).toBe(
    'UNCERTAIN',
  );
});

it('never repeats an SMTP-accepted send after the success write and recovery both fail', async () => {
  let now = Date.now();
  const id = await intent(now);
  let sends = 0;
  const unavailable = {
    ...repo,
    async finish() {
      throw new Error('DATABASE_UNAVAILABLE');
    },
  };
  const sender = {
    async send() {
      sends++;
      return { messageId: 'accepted' };
    },
    close() {},
    activeCount: () => 0,
  };
  const consume = createEmailConsumer({
    repository: unavailable,
    sender,
    clock: () => now,
  });
  await expect(consume(id)).rejects.toThrow('DATABASE_UNAVAILABLE');
  expect((await repo.get(id))?.status).toBe('SENDING');
  now += 61_000;
  await repo.maintain(now);
  await createEmailConsumer({
    repository: repo2,
    sender,
    clock: () => now,
  })(id);
  expect((await repo.get(id))?.status).toBe('UNCERTAIN');
  expect(sends).toBe(1);
});

it('renders an authenticated capture-time origin, brand and reply-to after worker configuration changes', async () => {
  const id = await intent();
  const consume = createEmailConsumer({
    repository: repo,
    sender: {
      async send(message) {
        expect(message.senderName).toBe('Avenor');
        expect(message.replyTo).toBe('help@example.test');
        expect(message.html).toContain(
          'http://localhost:3100/properties/safe-id',
        );
        return { messageId: 'snapshot' };
      },
      close() {},
      activeCount: () => 0,
    },
  });
  await consume(id);
  expect((await repo.get(id))?.status).toBe('SUBMITTED');
});
it('maintains bounded expired/retention backlogs without starving eligible work', async () => {
  const now = Date.now(),
    old = await intent(now - 2 * day);
  const sample = await repo.get(old);
  if (!sample) throw new Error('fixture');
  await fixture.database.emailNotification.createMany({
    data: Array.from({ length: 110 }, (_, i) => ({
      ...sample,
      id: `expired-${i}`,
      dedupeKey: `expired-${i}`,
      leadId: null,
    })),
  });
  const live = await intent(now);
  const missingKey = await intent(now);
  await fixture.database.emailNotification.update({
    where: { id: missingKey },
    data: { payloadKeyId: 'missing' },
  });
  const sending = await intent(now);
  await repo.claimSend(sending, now, 'expired-lease', ['test']);
  await repo.maintain(now + 61_000);
  expect((await repo.get(sending))?.status).toBe('UNCERTAIN');
  expect(
    (await repo.due(now + 61_000, ['test'])).map((row) => row.id),
  ).toContain(live);
  expect(
    (await repo.due(now + 61_000, ['test'])).map((row) => row.id),
  ).not.toContain(missingKey);
  await repo.maintain(now + 61_000);
  expect(
    await fixture.database.emailNotification.count({
      where: { status: 'PENDING', expiresAt: { lte: new Date(now) } },
    }),
  ).toBe(0);
  const retained = () =>
    fixture.database.emailNotification.count({
      where: {
        payloadCiphertext: { not: null },
        terminalAt: { lte: new Date(now + day) },
      },
    });
  const beforePurge = await retained();
  await repo.maintain(now + 8 * day);
  expect(beforePurge - (await retained())).toBeLessThanOrEqual(100);
  // The subject UUID may sort behind the first 100 expired fixtures.
  await repo.maintain(now + 8 * day);
  expect((await repo.get(sending))?.payloadCiphertext).toBeNull();
});
it('operator replay is idempotent, redacted and preserves original expiry', async () => {
  const now = Date.now(),
    id = await intent(now);
  await fixture.database.emailNotification.update({
    where: { id },
    data: { status: 'UNCERTAIN', terminalAt: new Date(now) },
  });
  expect(await repo.replay(id, false, false, now)).toMatchObject({
    applied: false,
  });
  await expect(repo.replay(id, true, false, now)).rejects.toThrow(
    'EMAIL_REPLAY_ACK_REQUIRED',
  );
  const [a, b] = await Promise.all([
    repo.replay(id, true, true, now),
    repo2.replay(id, true, true, now),
  ]);
  expect(a.notificationId).toBe(b.notificationId);
  expect(
    await fixture.database.emailNotification.count({
      where: { replayOfId: id },
    }),
  ).toBe(1);
  expect((await repo.get(a.notificationId!))?.expiresAt).toEqual(
    (await repo.get(id))?.expiresAt,
  );
  expect(JSON.stringify(await repo.inspect(id))).not.toContain(
    'visitor@example.test',
  );
});
it('escapes email text, rejects foreign public URLs and never echoes private enquiry content', async () => {
  const row = await repo.get(await intent());
  if (!row) throw new Error('fixture');
  const payload = crypto.open(row);
  const message = renderEmail(row.kind, row.templateVersion, payload);
  expect(message.html).toContain('&lt;script&gt;');
  expect(message.html).not.toContain('<script>');
  expect(message.text).toContain('Home & garden');
  expect(() => renderEmail(row.kind, 99, payload)).toThrow();
  expect(() =>
    renderEmail(row.kind, 1, {
      ...payload,
      property: { title: 'Home', url: 'https://evil.example' },
    }),
  ).toThrow();
});
