import {
  serializedTransaction,
  type Database,
} from '../../infrastructure/database/transaction.js';
import type { ProducerConfig } from '../email/email.config.js';
import { createEmailOutbox } from '../email/email.outbox.js';
import { lockReminderScan } from './tasks.repository.js';
import { taskReminderWindowMs } from './tasks.rules.js';

export function createTaskEmailReminderScanner(
  database: Database,
  config: ProducerConfig | null,
  clock = Date.now,
) {
  const record = config ? createEmailOutbox(config) : null;
  let cursor: { dueAt: Date; id: string } | null = null;

  return async () => {
    if (!config?.staffEnabled || !record) return;
    const nextCursor = await serializedTransaction(database, async (tx) => {
      await lockReminderScan(tx);
      const now = new Date(clock());
      const candidates = await tx.task.findMany({
        where: {
          status: 'open',
          dueAt: {
            gt: now,
            lte: new Date(now.getTime() + taskReminderWindowMs),
          },
          lead: {
            assignedAgent: {
              is: {
                role: 'agent',
                disabled: false,
                OR: [{ banned: false }, { banned: null }],
              },
            },
          },
          ...(cursor
            ? {
                OR: [
                  { dueAt: { gt: cursor.dueAt } },
                  { dueAt: cursor.dueAt, id: { gt: cursor.id } },
                ],
              }
            : {}),
        },
        orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
        take: 100,
        include: { lead: { include: { assignedAgent: true } } },
      });
      // Ownership periods change only on assignment events, not ordinary lead edits.
      const ownershipCounts = candidates.length
        ? await tx.leadActivity.groupBy({
            by: ['leadId'],
            where: {
              leadId: {
                in: [...new Set(candidates.map((task) => task.leadId))],
              },
              type: { in: ['assigned', 'unassigned'] },
            },
            _count: { _all: true },
          })
        : [];
      const ownership = new Map(
        ownershipCounts.map((row) => [row.leadId, row._count._all]),
      );
      for (const task of candidates) {
        const user = task.lead.assignedAgent!;
        await record(tx, {
          kind: 'TASK_DUE_SOON',
          templateVersion: 1,
          dedupeKey: `TASK_DUE_SOON:${task.id}:${task.dueAt.toISOString()}:${user.id}:${ownership.get(task.leadId) ?? 0}`,
          leadId: task.leadId,
          taskId: task.id,
          recipientUserId: user.id,
          sourceVersion: task.version,
          createdAt: now,
          nextAttemptAt: now,
          expiresAt: task.dueAt,
          payload: {
            to: user.email,
            name: user.name,
            publicOrigin: config.origin,
            brand: config.brand,
            replyTo: config.replyTo,
            crmUrl: `${config.origin}/crm/leads/${encodeURIComponent(task.leadId)}`,
            dueAt: task.dueAt.toISOString(),
          },
        });
      }
      const last = candidates.at(-1);
      return candidates.length === 100 && last
        ? { dueAt: last.dueAt, id: last.id }
        : null;
    });
    cursor = nextCursor;
  };
}
