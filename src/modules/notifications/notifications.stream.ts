import type { Response } from 'express';
import { AppError } from '../../shared/errors/app-error.js';
import type { createLogger } from '../../shared/logger.js';
import type { Actor } from '../leads/leads.repository.js';
import type { NotificationService } from './notifications.service.js';
import type { NotificationSignalTransport } from './notifications.transport.js';

const changeEvent = 'event: notifications.changed\ndata: {}\n\n';

export function createNotificationStreams(
  service: NotificationService,
  transport: NotificationSignalTransport,
  logger: Pick<ReturnType<typeof createLogger>, 'warn'>,
  heartbeatMs = 15_000,
) {
  const connections = new Set<() => void>();
  let stopping = false;

  function logError(error: unknown) {
    logger.warn(
      { errorType: error instanceof Error ? error.name : typeof error },
      'Notification stream failed',
    );
  }

  return {
    async open(identity: Actor, res: Response) {
      await service.requireStreamStaff(identity);

      if (stopping)
        throw new AppError(
          503,
          'SERVICE_UNAVAILABLE',
          'Notification stream unavailable',
        );
      if (res.destroyed) return;

      let closed = false;
      let unsubscribe: (() => void) | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;

      function cleanup() {
        if (closed) return;

        closed = true;
        if (timer) clearTimeout(timer);
        connections.delete(end);
        try {
          unsubscribe?.();
        } catch (error) {
          logError(error);
        }
      }

      function end() {
        cleanup();
        if (!res.destroyed && !res.writableEnded) res.end();
      }

      function write(frame: string) {
        if (closed) return;
        try {
          if (res.write(frame)) return;
        } catch (error) {
          logError(error);
        }

        cleanup();
        res.destroy();
      }

      async function heartbeat() {
        try {
          await service.requireStreamStaff(identity);
          write(': heartbeat\n\n');
          if (!closed) timer = setTimeout(() => void heartbeat(), heartbeatMs);
        } catch (error) {
          if (!(error instanceof AppError && error.status === 401))
            logError(error);
          end();
        }
      }

      // Subscribe before the initial event. Suppress synchronous registration
      // callbacks until headers are ready since the initial event covers them.
      let ready = false;
      try {
        unsubscribe = transport.subscribe(identity.id, () => {
          if (ready) write(changeEvent);
        });
      } catch (error) {
        logError(error);
        throw new AppError(
          503,
          'SERVICE_UNAVAILABLE',
          'Notification stream unavailable',
        );
      }

      connections.add(end);
      res.once('close', cleanup);
      res.once('error', cleanup);
      res.set({
        // A compression proxy can hold small SSE frames in its output buffer.
        'Cache-Control': 'no-store, no-transform',
        'Content-Type': 'text/event-stream; charset=utf-8',
        'X-Accel-Buffering': 'no',
      });
      ready = true;
      write(changeEvent);
      if (!closed) timer = setTimeout(() => void heartbeat(), heartbeatMs);
    },

    closeAll() {
      stopping = true;
      for (const end of connections) end();
    },
  };
}

export type NotificationStreams = ReturnType<typeof createNotificationStreams>;
