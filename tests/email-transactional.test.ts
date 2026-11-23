import { afterAll, expect, it } from 'vitest';
import { createEmailCrypto } from '../src/modules/email/email.crypto.js';
import { readProducerConfig } from '../src/modules/email/email.config.js';
import { renderEmail } from '../src/modules/email/email.templates.js';
import { emailQueueName } from '../src/modules/email/email.queue.js';

import { authFixture } from './auth-fixture.js';
import { createEmailOutbox } from '../src/modules/email/email.outbox.js';
import { createEmailRepository } from '../src/modules/email/email.repository.js';
import { serializedTransaction } from '../src/infrastructure/database/transaction.js';
const fixture = await authFixture();
afterAll(() => fixture.close());

const env = {
  EMAIL_PAYLOAD_KEYS: JSON.stringify({
    fixture: Buffer.alloc(32, 1).toString('base64'),
  }),
  EMAIL_PAYLOAD_ACTIVE_KEY_ID: 'fixture',
  APP_ORIGIN: 'http://localhost:3100',
  SMTP_REPLY_TO: 'help@example.test',
};
const common = {
  to: 'visitor@example.test',
  name: '<Visitor>',
  publicOrigin: env.APP_ORIGIN,
  brand: 'Avenor',
  replyTo: env.SMTP_REPLY_TO,
};
const appointment = {
  ...common,
  propertyTitle: 'Palm & Garden',
  location: 'Dubai',
  startsAt: '2026-11-29T06:00:00.000Z',
  endsAt: '2026-11-29T07:00:00.000Z',
};

it('requires an explicit UTC activation cutoff only for customer viewing production', () => {
  expect(readProducerConfig(env)).toBeNull();
  expect(
    readProducerConfig({ ...env, EMAIL_STAFF_NOTIFICATIONS_ENABLED: true }),
  ).toMatchObject({
    staffEnabled: true,
    customerViewingEnabled: false,
    enquiryEnabled: false,
  });
  for (const cutoff of [
    undefined,
    '',
    '2026-02-31T00:00:00Z',
    '2026-10-01',
    '2026-10-01T03:00:00+03:00',
  ]) {
    expect(() =>
      readProducerConfig({
        ...env,
        EMAIL_CUSTOMER_VIEWING_NOTIFICATIONS_ENABLED: true,
        EMAIL_CUSTOMER_VIEWING_ACTIVATED_AT: cutoff,
      }),
    ).toThrow('EMAIL_CONFIG_INVALID');
  }
  expect(
    readProducerConfig({
      ...env,
      EMAIL_CUSTOMER_VIEWING_NOTIFICATIONS_ENABLED: true,
      EMAIL_CUSTOMER_VIEWING_ACTIVATED_AT: appointment.startsAt,
    })?.customerViewingActivatedAt,
  ).toEqual(new Date(appointment.startsAt));
  expect(emailQueueName).toBe('transactional-emails');
});

it('opens a fixed original acknowledgement v1 ciphertext with its original AAD', () => {
  const crypto = createEmailCrypto({
    keys: { fixture: Buffer.alloc(32, 1).toString('base64') },
    activeKeyId: 'fixture',
  });
  const message = crypto.open({
    id: 'c449b5ba-8e18-4862-840d-073b2c8bf17c',
    kind: 'WEBSITE_ENQUIRY_RECEIVED',
    templateVersion: 1,
    payloadKeyId: 'fixture',
    payloadIv: 'BwcHBwcHBwcHBwcH',
    payloadTag: '+FBgzEZRMMftu9lDlOARSQ==',
    payloadCiphertext:
      '9tGeyy2Uk9dw6W1EybInr9/I7KkIDiEtblFHn8o2PMwhTOC445HcisU+R/zBWAvQ7CTqBLJbFe4ZrXtPNaJJmNE7xtiKqXLwVAOxkt0kXJbFC4oCZfFJG/i3znDhRmAn4bEfLpznYuYGpeneDVUSzcVtMWy92tc4tQmTQAOloipjnqWj5GxJV6Z/f8JplneM1rG8oy2PDsur+cI=',
  });
  expect(message).toEqual({
    ...common,
    name: 'Legacy visitor',
    property: null,
  });
  expect(renderEmail('WEBSITE_ENQUIRY_RECEIVED', 1, message).subject).toBe(
    'We received your enquiry',
  );
});

it('uses distinct fixed subjects, escaped text, authenticated staff links and explicit Dubai appointment times', () => {
  const subjects = new Set<string>();
  for (const kind of [
    'CUSTOMER_VIEWING_CONFIRMED',
    'CUSTOMER_VIEWING_RESCHEDULED',
    'CUSTOMER_VIEWING_CANCELLED',
    'CUSTOMER_VIEWING_REMINDER',
  ]) {
    const message = renderEmail(kind, 1, appointment);
    subjects.add(message.subject);
    expect(message.html).toContain('Palm &amp; Garden');
    expect(message.html).toContain('&lt;Visitor&gt;');
    expect(message.text).toMatch(/10:00/);
    expect(message.text).toContain('Dubai');
    expect(message.text).not.toContain('/crm/');
    expect(() =>
      renderEmail(kind, 1, { ...appointment, feedback: 'private' }),
    ).toThrow();
  }
  const crmUrl = env.APP_ORIGIN + '/crm/leads/sample';
  for (const [kind, payload] of [
    ['STAFF_WEBSITE_ENQUIRY_RECEIVED', { ...common, crmUrl }],
    ['LEAD_ASSIGNED', { ...common, crmUrl }],
    ['TASK_DUE_SOON', { ...common, crmUrl, dueAt: appointment.startsAt }],
    ['STAFF_VIEWING_RESCHEDULED', { ...appointment, crmUrl }],
    ['STAFF_VIEWING_CANCELLED', { ...appointment, crmUrl }],
  ] as const) {
    const message = renderEmail(kind, 1, payload);
    expect(message.text).toContain(crmUrl);
    subjects.add(message.subject);
    for (const url of [
      'https://foreign.example/crm/leads/sample',
      env.APP_ORIGIN + '/crm/settings',
      crmUrl + '?target=external',
      env.APP_ORIGIN + '/crm/leads/%2e%2e%2fsettings',
    ]) {
      expect(() => renderEmail(kind, 1, { ...payload, crmUrl: url })).toThrow();
    }
  }
  expect(subjects.size).toBe(9);
  expect(() =>
    renderEmail('CUSTOMER_VIEWING_CANCELLED', 2, appointment),
  ).toThrow();
  expect(() => renderEmail('UNKNOWN', 1, appointment)).toThrow();
});

it('atomically suppresses changed addresses and disabled groups, revalidates replay and preserves context', async () => {
  const groups = readProducerConfig({
    ...env,
    EMAIL_STAFF_NOTIFICATIONS_ENABLED: true,
  })!;
  const crypto = createEmailCrypto(groups),
    db = fixture.database;
  const repo = createEmailRepository(db, crypto, groups);
  const agent = await db.user.create({
    data: {
      id: 'email-agent',
      name: 'Agent',
      email: 'agent@example.test',
      role: 'agent',
    },
  });
  const lead = await db.lead.create({
    data: {
      name: 'Visitor',
      searchName: 'visitor',
      searchEmail: '',
      searchPhone: '',
      searchPropertyTitle: '',
      source: 'website',
      purpose: 'sale',
      assignedAgentId: agent.id,
    },
  });
  const outbox = createEmailOutbox(groups);
  const now = Date.now();
  const intent = (key: string) =>
    serializedTransaction(db, (tx) =>
      outbox(tx, {
        kind: 'LEAD_ASSIGNED',
        templateVersion: 1,
        dedupeKey: key,
        createdAt: new Date(now),
        nextAttemptAt: new Date(now),
        expiresAt: new Date(now + 86400000),
        leadId: lead.id,
        recipientUserId: agent.id,
        sourceVersion: 7,
        payload: {
          ...common,
          to: agent.email,
          crmUrl: env.APP_ORIGIN + '/crm/leads/' + lead.id,
        },
      }),
    );

  const id = await intent('stale-address');
  await db.user.update({
    where: { id: agent.id },
    data: { email: 'changed@example.test' },
  });
  expect(await repo.claimSend(id, now, 'claim', ['fixture'])).toBeNull();
  expect(await repo.get(id)).toMatchObject({
    status: 'SUPPRESSED',
    sendAttempts: 0,
    lastErrorCode: 'EMAIL_RECIPIENT_CHANGED',
  });
  await expect(repo.replay(id, true, true, now)).rejects.toThrow(
    'EMAIL_REPLAY_UNAVAILABLE',
  );
  const disabled = await intent('disabled');
  expect(
    await createEmailRepository(db, crypto).claimSend(disabled, now, 'claim'),
  ).toBeNull();
  expect(await repo.get(disabled)).toMatchObject({
    status: 'SUPPRESSED',
    lastErrorCode: 'EMAIL_GROUP_DISABLED',
  });

  const failed = await intent('failed');
  await db.emailNotification.update({
    where: { id: failed },
    data: { status: 'FAILED', terminalAt: new Date(now) },
  });
  await expect(repo.replay(failed, true, true, now)).rejects.toThrow(
    'EMAIL_REPLAY_UNAVAILABLE',
  );
  await db.user.update({
    where: { id: agent.id },
    data: { email: agent.email },
  });
  const replay = await repo.replay(failed, true, true, now);
  expect(await repo.get(replay.notificationId!)).toMatchObject({
    status: 'PENDING',
    recipientUserId: agent.id,
    sourceVersion: 7,
    replayOfId: failed,
  });
  await db.user.update({ where: { id: agent.id }, data: { disabled: true } });
  expect(await repo.claimSend(replay.notificationId!, now, 'claim')).toBeNull();
  expect(await repo.get(replay.notificationId!)).toMatchObject({
    status: 'SUPPRESSED',
    sendAttempts: 0,
  });
});

it('guards live customer schedule, address, reminder window and prior uncertain sends under the claim', async () => {
  const startsAt = new Date('2031-01-15T06:00:00.000Z'),
    endsAt = new Date('2031-01-15T07:00:00.000Z');
  const now = startsAt.getTime() - 3600_000;
  const groups = readProducerConfig({
    ...env,
    EMAIL_CUSTOMER_VIEWING_NOTIFICATIONS_ENABLED: true,
    EMAIL_CUSTOMER_VIEWING_ACTIVATED_AT: '2025-01-01T00:00:00Z',
  })!;
  const crypto = createEmailCrypto(groups),
    db = fixture.database,
    repo = createEmailRepository(db, crypto, groups);
  const lead = await db.lead.create({
    data: {
      name: 'Customer',
      email: common.to,
      searchName: 'customer',
      searchEmail: '',
      searchPhone: '',
      searchPropertyTitle: '',
      source: 'website',
      purpose: 'sale',
    },
  });
  const property = await db.property.create({
    data: { title: appointment.propertyTitle, purpose: 'sale' },
  });
  const viewing = await db.viewing.create({
    data: {
      submissionId: 'guarded-viewing',
      actorScope: 'fixture',
      payloadHash: 'fixture',
      leadId: lead.id,
      propertyId: property.id,
      propertyTitleSnapshot: property.title,
      startsAt,
      endsAt,
    },
  });
  const record = createEmailOutbox(groups);
  const intent = (
    key: string,
    kind:
      | 'CUSTOMER_VIEWING_CONFIRMED'
      | 'CUSTOMER_VIEWING_REMINDER'
      | 'CUSTOMER_VIEWING_CANCELLED' = 'CUSTOMER_VIEWING_CONFIRMED',
  ) =>
    serializedTransaction(db, (tx) =>
      record(tx, {
        kind,
        templateVersion: 1,
        leadId: lead.id,
        viewingId: viewing.id,
        sourceVersion: 1,
        scheduledStartsAt: startsAt,
        scheduledEndsAt: endsAt,
        dedupeKey: key,
        createdAt: new Date(now - 2 * 86_400_000),
        nextAttemptAt: new Date(now - 2 * 86_400_000),
        expiresAt: startsAt,
        payload: {
          ...appointment,
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
        },
      }),
    );

  const staleAddress = await intent('customer-stale-address');
  await db.lead.update({
    where: { id: lead.id },
    data: { email: 'new@example.test' },
  });
  expect(await repo.claimSend(staleAddress, now, 'r')).toBeNull();
  expect(await repo.get(staleAddress)).toMatchObject({
    status: 'SUPPRESSED',
    sendAttempts: 0,
    lastErrorCode: 'EMAIL_RECIPIENT_CHANGED',
  });
  await db.lead.update({ where: { id: lead.id }, data: { email: common.to } });
  const staleSchedule = await intent('customer-stale-schedule');
  await db.viewing.update({
    where: { id: viewing.id },
    data: { startsAt: new Date(now) },
  });
  expect(await repo.claimSend(staleSchedule, now, 'r')).toBeNull();
  expect(await repo.get(staleSchedule)).toMatchObject({
    status: 'SUPPRESSED',
    sendAttempts: 0,
    lastErrorCode: 'EMAIL_VIEWING_CHANGED',
  });
  await db.viewing.update({ where: { id: viewing.id }, data: { startsAt } });

  const prior = await intent(
    'customer-uncertain-reminder',
    'CUSTOMER_VIEWING_REMINDER',
  );
  expect(await repo.claimSend(prior, now, 'prior')).toBeTruthy();
  await repo.finish(prior, 'prior', 'UNCERTAIN', now);
  const duplicate = await intent(
    'customer-reminder-duplicate',
    'CUSTOMER_VIEWING_REMINDER',
  );
  expect(await repo.claimSend(duplicate, now, 'r')).toBeNull();
  expect(await repo.get(duplicate)).toMatchObject({
    status: 'SUPPRESSED',
    sendAttempts: 0,
    lastErrorCode: 'EMAIL_REMINDER_ALREADY_SENT',
  });
  const legitimateReplay = await repo.replay(prior, true, true, now);
  expect(
    await repo.claimSend(legitimateReplay.notificationId!, now, 'manual'),
  ).toBeTruthy();

  const staleLifecycle = await intent('customer-stale-lifecycle');
  await db.viewing.update({
    where: { id: viewing.id },
    data: { status: 'completed' },
  });
  expect(await repo.claimSend(staleLifecycle, now, 'r')).toBeNull();
  const cancellation = await intent(
    'customer-cancelled',
    'CUSTOMER_VIEWING_CANCELLED',
  );
  await db.viewing.update({
    where: { id: viewing.id },
    data: { status: 'cancelled' },
  });
  expect(await repo.claimSend(cancellation, now, 'r')).toBeTruthy();
  const rollback = await intent(
    'future-reminder-disabled',
    'CUSTOMER_VIEWING_REMINDER',
  );
  await db.emailNotification.update({
    where: { id: rollback },
    data: { nextAttemptAt: new Date(now + 1800_000) },
  });
  await createEmailRepository(db, crypto).maintain(now);
  expect(await repo.get(rollback)).toMatchObject({
    status: 'SUPPRESSED',
    sendAttempts: 0,
    lastErrorCode: 'EMAIL_GROUP_DISABLED',
  });
});
