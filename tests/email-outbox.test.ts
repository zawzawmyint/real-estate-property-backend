import { afterAll, expect, it } from 'vitest';
import { authFixture } from './auth-fixture.js';
import { createEnquiryEmailProducer } from '../src/modules/leads/leads.emails.js';
import { readProducerConfig } from '../src/modules/email/email.config.js';
import { createEmailCrypto } from '../src/modules/email/email.crypto.js';
import { serializedTransaction } from '../src/infrastructure/database/transaction.js';

const fixture = await authFixture();
afterAll(() => fixture.close());
const config = readProducerConfig({
  EMAIL_ENQUIRY_NOTIFICATIONS_ENABLED: true,
  EMAIL_PAYLOAD_KEYS: JSON.stringify({
    test: Buffer.alloc(32, 1).toString('base64'),
  }),
  EMAIL_PAYLOAD_ACTIVE_KEY_ID: 'test',
  APP_ORIGIN: 'http://localhost:3100',
  SMTP_REPLY_TO: 'help@example.test',
})!;
const outbox = createEnquiryEmailProducer(config);
async function lead() {
  return fixture.database.lead.create({
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
}
it('records encrypted immutable intent once per lead and rolls back with its transaction', async () => {
  const row = await lead();
  const input = {
    leadId: row.id,
    name: 'Private visitor',
    to: 'visitor@example.test',
    property: null,
  };
  const first = await serializedTransaction(fixture.database, (tx) =>
    outbox(tx, input),
  );
  expect(
    await serializedTransaction(fixture.database, (tx) => outbox(tx, input)),
  ).toBe(first);
  const saved = await fixture.database.emailNotification.findUniqueOrThrow({
    where: { id: first },
  });
  expect(JSON.stringify(saved)).not.toContain(input.to);
  const crypto = createEmailCrypto(config);
  expect(crypto.open(saved)).toMatchObject({ name: input.name, to: input.to });
  expect(() => crypto.open({ ...saved, id: 'tampered' })).toThrow(
    'EMAIL_PAYLOAD_INVALID',
  );
  expect(() =>
    createEmailCrypto({
      keys: { other: Buffer.alloc(32, 2).toString('base64') },
      activeKeyId: 'other',
    }).open(saved),
  ).toThrow('EMAIL_PAYLOAD_KEY_UNAVAILABLE');
  expect(
    createEmailCrypto({
      ...config,
      keys: { ...config.keys, other: Buffer.alloc(32, 2).toString('base64') },
      activeKeyId: 'other',
    }).open(saved),
  ).toMatchObject({ to: input.to });
  const second = await lead();
  await expect(
    serializedTransaction(fixture.database, async (tx) => {
      await outbox(tx, { ...input, leadId: second.id });
      throw new Error('rollback');
    }),
  ).rejects.toThrow('rollback');
  expect(
    await fixture.database.emailNotification.count({
      where: { leadId: second.id },
    }),
  ).toBe(0);
});
it('enquiry producer requires a lead but delivery persistence permits null lead linkage', async () => {
  await expect(
    serializedTransaction(fixture.database, (tx) =>
      outbox(tx, {
        leadId: '',
        name: 'Visitor',
        to: 'visitor@example.test',
        property: null,
      }),
    ),
  ).rejects.toThrow();
  const row = await lead();
  const id = await serializedTransaction(fixture.database, (tx) =>
    outbox(tx, {
      leadId: row.id,
      name: 'Visitor',
      to: 'visitor@example.test',
      property: null,
    }),
  );
  await fixture.database.emailNotification.update({
    where: { id },
    data: { leadId: null },
  });
  expect(
    (
      await fixture.database.emailNotification.findUniqueOrThrow({
        where: { id },
      })
    ).leadId,
  ).toBeNull();
});
