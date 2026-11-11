import { randomUUID } from 'node:crypto';
import type {
  NotificationType,
  Prisma,
} from '../../generated/prisma/client.js';
import type { Transaction } from '../../infrastructure/database/transaction.js';
import type { Actor } from '../leads/leads.repository.js';

export type NotificationInput = {
  recipientId: string;
  type: NotificationType;
  leadId: string;
  viewingId?: string;
  taskId?: string;
  occurrenceKey: string;
};

export type NotificationRetirement = {
  leadId?: string;
  recipientId?: string;
  types?: readonly NotificationType[];
  viewingId?: string;
  taskId?: string;
};

export type NotificationCursor = { createdAt: Date; id: string };

const itemSelect = {
  id: true,
  type: true,
  leadId: true,
  viewingId: true,
  taskId: true,
  createdAt: true,
  readAt: true,
} satisfies Prisma.NotificationSelect;

function visibleTo(actor: Actor): Prisma.NotificationWhereInput {
  const assigned: Prisma.NotificationWhereInput = {
    type: { not: 'website_inquiry_received' },
    lead: { assignedAgentId: actor.id },
  };
  const where = { recipientId: actor.id, retiredAt: null };

  if (actor.role === 'agent') return { ...where, ...assigned };

  return {
    ...where,
    OR: [
      assigned,
      { type: 'website_inquiry_received', lead: { assignedAgentId: null } },
    ],
  };
}

export const notificationRepository = {
  async create(input: NotificationInput, tx: Transaction) {
    const roles =
      input.type === 'website_inquiry_received'
        ? ['admin', 'manager']
        : ['agent'];
    const recipient = await tx.user.findFirst({
      where: {
        id: input.recipientId,
        role: { in: roles },
        disabled: false,
        OR: [{ banned: false }, { banned: null }],
      },
      select: { id: true },
    });

    if (!recipient) return null;

    const changed = await tx.$executeRaw`
      INSERT INTO "Notification" ("id", "recipientId", "type", "leadId", "viewingId", "taskId", "occurrenceKey", "createdAt")
      VALUES (${randomUUID()}, ${recipient.id}, ${input.type}, ${input.leadId}, ${input.viewingId ?? null}, ${input.taskId ?? null}, ${input.occurrenceKey}, ${new Date()})
      ON CONFLICT ("recipientId", "occurrenceKey") DO NOTHING`;

    return changed === 1 ? recipient.id : null;
  },

  async retire(filter: NotificationRetirement, tx: Transaction) {
    const { leadId, recipientId, taskId, viewingId, types } = filter;
    if (!leadId && !taskId && !viewingId)
      throw new Error('Notification retirement requires a resource ID');

    const retired = await tx.notification.updateManyAndReturn({
      where: {
        ...(leadId === undefined ? {} : { leadId }),
        ...(recipientId === undefined ? {} : { recipientId }),
        ...(taskId === undefined ? {} : { taskId }),
        ...(viewingId === undefined ? {} : { viewingId }),
        ...(types === undefined ? {} : { type: { in: [...types] } }),
        retiredAt: null,
      },
      data: { retiredAt: new Date() },
      select: { recipientId: true },
    });

    return retired.map((row) => row.recipientId);
  },

  async list(
    actor: Actor,
    cursor: NotificationCursor | null,
    take: number,
    tx: Transaction,
  ) {
    const visible = visibleTo(actor);
    const afterCursor: Prisma.NotificationWhereInput | undefined = cursor
      ? {
          OR: [
            { createdAt: { lt: cursor.createdAt } },
            { createdAt: cursor.createdAt, id: { lt: cursor.id } },
          ],
        }
      : undefined;
    const rows = await tx.notification.findMany({
      where: afterCursor ? { AND: [visible, afterCursor] } : visible,
      select: itemSelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take,
    });
    const unreadCount = await tx.notification.count({
      where: { ...visible, readAt: null },
    });

    return { rows, unreadCount };
  },

  lock(id: string, recipientId: string, tx: Transaction) {
    return tx.$executeRaw`UPDATE "Notification" SET "readAt"="readAt" WHERE "id"=${id} AND "recipientId"=${recipientId}`;
  },

  findForRead(id: string, actor: Actor, tx: Transaction) {
    return tx.notification.findFirst({
      where: { id, ...visibleTo(actor) },
      select: { id: true, readAt: true },
    });
  },

  markRead(id: string, tx: Transaction) {
    return tx.notification.update({
      where: { id },
      data: { readAt: new Date() },
      select: { id: true },
    });
  },
};
