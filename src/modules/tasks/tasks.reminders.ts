import type { NotificationService } from '../notifications/notifications.service.js';
import {
  findDueReminderCandidates,
  lockReminderScan,
} from './tasks.repository.js';

const reminderWindowMs = 30 * 60_000;
const batchLimit = 100;

export async function scanDueTaskReminders(
  notifications: NotificationService,
  clock = () => new Date(),
) {
  await notifications.transactionWithChanges(async (tx, recipientIds) => {
    await lockReminderScan(tx);
    const now = clock();
    const until = new Date(now.getTime() + reminderWindowMs);
    const candidates = await findDueReminderCandidates(
      now,
      until,
      batchLimit,
      tx,
    );
    for (const candidate of candidates) {
      recipientIds.push(
        await notifications.createNotification(
          {
            ...candidate,
            type: 'task_due_soon',
          },
          tx,
        ),
      );
    }
  });
}
