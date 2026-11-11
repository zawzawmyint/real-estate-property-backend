import {
  serializedTransaction,
  type Database,
  type Transaction,
} from '../../infrastructure/database/transaction.js';
import { AppError } from '../../shared/errors/app-error.js';
import { createLogger } from '../../shared/logger.js';
import { requireCurrentStaff } from '../auth/staff-actor.js';
import type { Actor } from '../leads/leads.repository.js';
import {
  notificationRepository,
  type NotificationCursor,
} from './notifications.repository.js';
import {
  createInProcessNotificationTransport,
  type NotificationSignalTransport,
} from './notifications.transport.js';

export type { NotificationType } from '../../generated/prisma/client.js';

const pageSize = 20;

export function createNotificationService(
  database: Database,
  transport: NotificationSignalTransport = createInProcessNotificationTransport(),
  logger: Pick<ReturnType<typeof createLogger>, 'warn'> = createLogger('warn'),
) {
  async function publishChanges(recipientIds: Iterable<string | null>) {
    const ids = [...new Set(recipientIds)].filter((id) => id !== null);
    if (ids.length === 0) return;

    try {
      await transport.publish(ids);
    } catch (error) {
      logger.warn(
        { errorType: error instanceof Error ? error.name : typeof error },
        'Could not publish notification changes',
      );
    }
  }

  return {
    createNotification: notificationRepository.create,
    retireNotifications: notificationRepository.retire,
    publishChanges,

    async transactionWithChanges<T>(
      run: (tx: Transaction, recipientIds: (string | null)[]) => Promise<T>,
    ) {
      const recipientIds: (string | null)[] = [];
      const result = await serializedTransaction(database, (tx) =>
        run(tx, recipientIds),
      );
      await publishChanges(recipientIds);
      return result;
    },

    async list(
      identity: Actor,
      cursor: NotificationCursor | null,
      expectedAccount?: string,
    ) {
      const { rows, unreadCount } = await serializedTransaction(
        database,
        async (tx) => {
          const actor = await requireCurrentStaff(identity, tx);
          if (expectedAccount !== undefined && expectedAccount !== actor.id)
            throw new AppError(403, 'FORBIDDEN', 'Staff account changed');

          return notificationRepository.list(actor, cursor, pageSize + 1, tx);
        },
      );
      const items = rows.slice(0, pageSize).map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
        readAt: row.readAt?.toISOString() ?? null,
      }));
      const last = items.at(-1);
      const nextCursor =
        rows.length > pageSize && last
          ? Buffer.from(`${last.createdAt}|${last.id}`).toString('base64url')
          : null;

      return { items, unreadCount, nextCursor };
    },

    async markRead(id: string, identity: Actor) {
      const changed = await serializedTransaction(database, async (tx) => {
        await notificationRepository.lock(id, identity.id, tx);
        const actor = await requireCurrentStaff(identity, tx);
        const row = await notificationRepository.findForRead(id, actor, tx);

        if (!row)
          throw new AppError(404, 'NOT_FOUND', 'Notification not found');
        if (row.readAt) return false;

        await notificationRepository.markRead(id, tx);
        return true;
      });

      if (changed) await publishChanges([identity.id]);
    },

    requireStreamStaff(identity: Actor) {
      return requireCurrentStaff(identity, database);
    },
  };
}

export type NotificationService = ReturnType<typeof createNotificationService>;
