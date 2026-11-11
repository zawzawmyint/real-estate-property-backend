import type { Request, Response } from 'express';
import { AppError } from '../../shared/errors/app-error.js';
import type { Actor } from '../leads/leads.repository.js';
import {
  parseNotificationCursor,
  parseNotificationId,
} from './notifications.schema.js';
import type { NotificationService } from './notifications.service.js';
import type { NotificationStreams } from './notifications.stream.js';

function query(req: Request) {
  return new URL(req.originalUrl, 'http://localhost').searchParams;
}

export function createNotificationController(
  service: NotificationService,
  streams: NotificationStreams,
) {
  return {
    async list(req: Request, res: Response) {
      const cursor = parseNotificationCursor(query(req));
      const expectedAccount = req.get('X-Staff-Account');
      res.json(
        await service.list(res.locals.staff as Actor, cursor, expectedAccount),
      );
    },

    async markRead(req: Request, res: Response) {
      if (
        query(req).size !== 0 ||
        Number(req.headers['content-length']) > 0 ||
        req.headers['transfer-encoding'] !== undefined
      )
        throw new AppError(
          400,
          'VALIDATION_ERROR',
          'Expected no query parameters or body',
        );

      await service.markRead(
        parseNotificationId(req.params.id),
        res.locals.staff as Actor,
      );
      res.status(204).end();
    },

    async stream(req: Request, res: Response) {
      if (query(req).size !== 0)
        throw new AppError(
          400,
          'VALIDATION_ERROR',
          'Expected no query parameters',
        );

      if (req.method === 'HEAD') {
        res.type('text/event-stream').end();
        return;
      }

      await streams.open(res.locals.staff as Actor, res);
    },
  };
}
