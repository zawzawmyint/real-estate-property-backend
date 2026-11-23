import type { Transaction } from '../../infrastructure/database/transaction.js';
import type { ProducerConfig } from '../email/email.config.js';
import { createEmailOutbox } from '../email/email.outbox.js';
import { day } from '../email/email.types.js';

export type EnquiryEmailInput = {
  leadId: string;
  to: string;
  name: string;
  property: { id: string; title: string } | null;
};

export function createEnquiryEmailProducer(
  config: ProducerConfig,
  clock = Date.now,
) {
  const record = createEmailOutbox(config);

  return async (tx: Transaction, input: EnquiryEmailInput): Promise<string> => {
    if (!input.leadId) throw new Error('EMAIL_LEAD_REQUIRED');
    const now = clock();
    return record(tx, {
      kind: 'WEBSITE_ENQUIRY_RECEIVED',
      templateVersion: 1,
      dedupeKey: `WEBSITE_ENQUIRY_RECEIVED:${input.leadId}`,
      leadId: input.leadId,
      createdAt: new Date(now),
      nextAttemptAt: new Date(now),
      expiresAt: new Date(now + day),
      payload: {
        to: input.to,
        name: input.name,
        publicOrigin: config.origin,
        brand: config.brand,
        replyTo: config.replyTo,
        property: input.property
          ? {
              title: input.property.title,
              url: `${config.origin}/properties/${encodeURIComponent(input.property.id)}`,
            }
          : null,
      },
    });
  };
}

export type EnquiryEmailProducer = ReturnType<
  typeof createEnquiryEmailProducer
>;

export function createLeadStaffEmailProducer(
  config: ProducerConfig,
  clock = Date.now,
) {
  const record = createEmailOutbox(config);

  return async (
    tx: Transaction,
    kind: 'LEAD_ASSIGNED' | 'STAFF_WEBSITE_ENQUIRY_RECEIVED',
    lead: { id: string; version: number },
    recipientId: string,
  ) => {
    if (!config.staffEnabled) return;
    const user = await tx.user.findUnique({
      where: { id: recipientId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        disabled: true,
        banned: true,
      },
    });
    if (
      !user ||
      user.disabled ||
      user.banned ||
      !(kind === 'LEAD_ASSIGNED'
        ? user.role === 'agent'
        : ['admin', 'manager'].includes(user.role))
    )
      return;
    const now = clock();
    await record(tx, {
      kind,
      templateVersion: 1,
      dedupeKey: `${kind}:${lead.id}:${kind === 'LEAD_ASSIGNED' ? lead.version : 'created'}:${user.id}`,
      leadId: lead.id,
      recipientUserId: user.id,
      sourceVersion: lead.version,
      createdAt: new Date(now),
      nextAttemptAt: new Date(now),
      expiresAt: new Date(now + day),
      payload: {
        to: user.email,
        name: user.name,
        publicOrigin: config.origin,
        brand: config.brand,
        replyTo: config.replyTo,
        crmUrl: `${config.origin}/crm/leads/${encodeURIComponent(lead.id)}`,
      },
    });
  };
}

export type LeadStaffEmailProducer = ReturnType<
  typeof createLeadStaffEmailProducer
>;

export async function suppressCustomerContactEmails(
  tx: Transaction,
  leadId: string,
  now: Date,
) {
  await tx.emailNotification.updateMany({
    where: {
      leadId,
      kind: { startsWith: 'CUSTOMER_VIEWING_' },
      status: { in: ['PENDING', 'ENQUEUED'] },
    },
    data: {
      status: 'SUPPRESSED',
      lastErrorCode: 'EMAIL_RECIPIENT_CHANGED',
      terminalAt: now,
      leaseUntil: null,
      leaseToken: null,
    },
  });
}

export async function suppressReassignedEmails(
  tx: Transaction,
  leadId: string,
  previousRecipientUserId: string | null,
  now: Date,
) {
  await tx.emailNotification.updateMany({
    where: {
      leadId,
      status: { in: ['PENDING', 'ENQUEUED'] },
      OR: [
        { kind: 'STAFF_WEBSITE_ENQUIRY_RECEIVED' },
        ...(previousRecipientUserId
          ? [
              {
                recipientUserId: previousRecipientUserId,
                kind: {
                  in: [
                    'LEAD_ASSIGNED',
                    'TASK_DUE_SOON',
                    'STAFF_VIEWING_RESCHEDULED',
                    'STAFF_VIEWING_CANCELLED',
                  ],
                },
              },
            ]
          : []),
      ],
    },
    data: {
      status: 'SUPPRESSED',
      lastErrorCode: 'EMAIL_ASSIGNMENT_CHANGED',
      terminalAt: now,
      leaseUntil: null,
      leaseToken: null,
    },
  });
}
