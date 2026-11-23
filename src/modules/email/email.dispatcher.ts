import { randomUUID } from 'node:crypto';
import type { Queue } from 'bullmq';
import type { EmailRepository } from './email.repository.js';
import type { EmailJobData } from './email.queue.js';

type DispatchResult = {
  publication: 'idle' | 'published' | 'failed';
  healthy: boolean;
};

export function createEmailDispatcher(
  repo: EmailRepository,
  queue: Queue<EmailJobData>,
  keyIds: string[],
  observe: (code: string) => void,
  clock = Date.now,
) {
  let running = false,
    lastReconcile = 0;

  async function release(id: string, token: string) {
    try {
      await repo.releaseDispatch(id, token, clock());
    } catch {
      // The fenced lease expires normally if the database cannot release it now.
      observe('EMAIL_DISPATCH_RELEASE_FAILED');
    }
  }

  return async (forceReconcile = false): Promise<DispatchResult> => {
    if (running) return { publication: 'idle', healthy: false };
    running = true;
    let published = false;
    try {
      const now = clock();
      const reconcile = forceReconcile || now - lastReconcile >= 30_000;
      if (reconcile) lastReconcile = now;
      for (const candidate of await repo.due(now, keyIds)) {
        if (
          candidate.status === 'ENQUEUED' &&
          !reconcile &&
          candidate.enqueuedAt &&
          candidate.enqueuedAt.getTime() > now - 30_000
        )
          continue;
        const token = randomUUID();
        const row = await repo.claimDispatch(candidate.id, now, token);
        if (!row) continue;
        try {
          const existing = await queue.getJob(row.id);
          let needsPublication = true;
          if (existing) {
            const state = await existing.getState();
            if (state === 'completed' || state === 'failed')
              await existing.remove();
            else needsPublication = false;
          }
          if (needsPublication) {
            await queue.add(
              'send-email',
              { notificationId: row.id },
              { jobId: row.id },
            );
            published = true;
          }
        } catch {
          await release(row.id, token);
          observe('REDIS_PUBLISH_FAILED');
          // One unavailable Redis must not produce 50 sequential command timeouts.
          return { publication: 'failed', healthy: false };
        }

        try {
          await repo.markEnqueued(row.id, token, clock());
        } catch {
          await release(row.id, token);
          observe('EMAIL_ENQUEUE_ACK_FAILED');
          return {
            publication: published ? 'published' : 'idle',
            healthy: false,
          };
        }
      }
      return { publication: published ? 'published' : 'idle', healthy: true };
    } finally {
      running = false;
    }
  };
}
