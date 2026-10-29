import type { Request, Response } from 'express';
import type { Actor } from '../leads/leads.repository.js';
import type { ViewingService } from './viewings.service.js';
import {
  parse,
  parseId,
  parseQuery,
  createSchema,
  rescheduleSchema,
  statusSchema,
} from './viewings.schema.js';
const actor = (res: Response) => res.locals.staff as Actor;
export function createViewingController(service: ViewingService) {
  return {
    async list(req: Request, res: Response) {
      res.json(await service.list(parseQuery(req.originalUrl), actor(res)));
    },

    async detail(req: Request, res: Response) {
      res.json(await service.detail(parseId(req.params.id), actor(res)));
    },

    async create(req: Request, res: Response) {
      const result = await service.create(
        parse(createSchema, req.body),
        actor(res),
      );
      if ('receiptConflict' in result) {
        res.status(409).json({
          error: {
            code: 'VIEWING_RECEIPT_CONFLICT',
            message:
              'An earlier attempt saved this booking. Review the saved appointment before making changes.',
            requestId: res.locals.requestId,
            existingViewingId: result.existingViewingId,
          },
        });
        return;
      }
      res.status(result.replay ? 200 : 201).json(result.viewing);
    },

    async reschedule(req: Request, res: Response) {
      res.json(
        await service.reschedule(
          parseId(req.params.id),
          parse(rescheduleSchema, req.body),
          actor(res),
        ),
      );
    },

    async status(req: Request, res: Response) {
      res.json(
        await service.status(
          parseId(req.params.id),
          parse(statusSchema, req.body),
          actor(res),
        ),
      );
    },
  };
}
