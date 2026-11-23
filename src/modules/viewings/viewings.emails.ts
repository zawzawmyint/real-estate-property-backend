import type { Transaction } from '../../infrastructure/database/transaction.js';
import { createHash } from 'node:crypto';
import type { ProducerConfig } from '../email/email.config.js';
import { createEmailOutbox } from '../email/email.outbox.js';
import { day, emailViewingChanged } from '../email/email.types.js';

type ViewingEvent = 'confirmed' | 'rescheduled' | 'cancelled';

export async function suppressViewingEmails(
  tx: Transaction,
  viewingId: string,
  now: Date,
) {
  await tx.emailNotification.updateMany({
    where: { viewingId, status: { in: ['PENDING', 'ENQUEUED'] } },
    data: {
      status: 'SUPPRESSED',
      terminalAt: now,
      lastErrorCode: emailViewingChanged,
      leaseToken: null,
      leaseUntil: null,
    },
  });
}

export function createViewingEmailProducer(
  config: ProducerConfig,
  clock = Date.now,
) {
  const record = createEmailOutbox(config);

  return async (
    tx: Transaction,
    viewingId: string,
    event: ViewingEvent,
    actorId: string,
  ) => {
    const viewing = await tx.viewing.findUniqueOrThrow({
      where: { id: viewingId },
      include: { lead: { include: { assignedAgent: true } } },
    });
    const now = new Date(clock());
    const expiresAt =
      event === 'cancelled'
        ? new Date(now.getTime() + day)
        : new Date(Math.min(now.getTime() + day, viewing.startsAt.getTime()));
    const details = {
      publicOrigin: config.origin,
      brand: config.brand,
      replyTo: config.replyTo,
      propertyTitle: viewing.propertyTitleSnapshot,
      location: viewing.propertyLocationSnapshot,
      startsAt: viewing.startsAt.toISOString(),
      endsAt: viewing.endsAt.toISOString(),
    };
    const context = {
      templateVersion: 1 as const,
      leadId: viewing.leadId,
      viewingId,
      sourceVersion: viewing.version,
      scheduledStartsAt: viewing.startsAt,
      scheduledEndsAt: viewing.endsAt,
      createdAt: now,
      nextAttemptAt: now,
      expiresAt,
    };
    const user = viewing.lead.assignedAgent;
    if (
      config.staffEnabled &&
      event !== 'confirmed' &&
      user &&
      user.id !== actorId &&
      user.role === 'agent' &&
      !user.disabled &&
      !user.banned
    ) {
      const kind =
        event === 'cancelled'
          ? 'STAFF_VIEWING_CANCELLED'
          : 'STAFF_VIEWING_RESCHEDULED';
      await record(tx, {
        ...context,
        kind,
        dedupeKey: `${kind}:${viewingId}:${viewing.version}:${user.id}`,
        recipientUserId: user.id,
        payload: {
          ...details,
          to: user.email,
          name: user.name,
          crmUrl: `${config.origin}/crm/leads/${encodeURIComponent(viewing.leadId)}`,
        },
      });
    }
    if (!config.customerViewingEnabled || !viewing.lead.email) return;
    const kind =
      event === 'confirmed'
        ? 'CUSTOMER_VIEWING_CONFIRMED'
        : event === 'cancelled'
          ? 'CUSTOMER_VIEWING_CANCELLED'
          : 'CUSTOMER_VIEWING_RESCHEDULED';
    const payload = {
      ...details,
      to: viewing.lead.email,
      name: viewing.lead.name,
    };
    const recipientKey = createHash('sha256')
      .update(viewing.lead.email.trim().toLowerCase())
      .digest('hex');
    await record(tx, {
      ...context,
      kind,
      dedupeKey: `${kind}:${viewingId}:${viewing.version}:${recipientKey}`,
      payload,
    });

    if (
      event === 'cancelled' ||
      !config.customerViewingActivatedAt ||
      viewing.createdAt < config.customerViewingActivatedAt ||
      viewing.startsAt.getTime() - now.getTime() <= day
    )
      return;
    await record(tx, {
      ...context,
      kind: 'CUSTOMER_VIEWING_REMINDER',
      dedupeKey: `CUSTOMER_VIEWING_REMINDER:${viewingId}:${viewing.version}:${viewing.startsAt.toISOString()}:${viewing.endsAt.toISOString()}:${recipientKey}`,
      nextAttemptAt: new Date(viewing.startsAt.getTime() - day),
      expiresAt: viewing.startsAt,
      payload,
    });
  };
}

export type ViewingEmailProducer = ReturnType<
  typeof createViewingEmailProducer
>;
