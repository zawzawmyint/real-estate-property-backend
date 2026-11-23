import { randomUUID } from 'node:crypto';
import type { Transaction } from '../../infrastructure/database/transaction.js';
import type { ProducerConfig } from './email.config.js';
import { createEmailCrypto } from './email.crypto.js';
import type { EmailKind, PayloadFor } from './email.types.js';

type EmailIntent = {
  [K in EmailKind]: { kind: K; payload: PayloadFor<K> };
}[EmailKind] & {
  templateVersion: 1;
  dedupeKey: string;
  leadId: string | null;
  createdAt: Date;
  nextAttemptAt: Date;
  expiresAt: Date;
  recipientUserId?: string;
  viewingId?: string;
  taskId?: string;
  sourceVersion?: number;
  scheduledStartsAt?: Date;
  scheduledEndsAt?: Date;
};

export function createEmailOutbox(config: ProducerConfig) {
  const crypto = createEmailCrypto(config);
  return async (tx: Transaction, input: EmailIntent): Promise<string> => {
    const existing = await tx.emailNotification.findUnique({
      where: { dedupeKey: input.dedupeKey },
      select: { id: true },
    });
    if (existing) return existing.id;

    const id = randomUUID();
    await tx.emailNotification.create({
      data: {
        id,
        dedupeKey: input.dedupeKey,
        kind: input.kind,
        templateVersion: input.templateVersion,
        leadId: input.leadId,
        status: 'PENDING',
        createdAt: input.createdAt,
        nextAttemptAt: input.nextAttemptAt,
        expiresAt: input.expiresAt,
        recipientUserId: input.recipientUserId ?? null,
        viewingId: input.viewingId ?? null,
        taskId: input.taskId ?? null,
        sourceVersion: input.sourceVersion ?? null,
        scheduledStartsAt: input.scheduledStartsAt ?? null,
        scheduledEndsAt: input.scheduledEndsAt ?? null,
        ...crypto.seal(id, input.kind, input.templateVersion, input.payload),
      },
    });
    return id;
  };
}
