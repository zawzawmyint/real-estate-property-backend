import type { Request, Response } from 'express';
import type { Actor } from '../leads/leads.repository.js';
import type { TaskService } from './tasks.service.js';
import {
  parse,
  parseId,
  parseQuery,
  createSchema,
  updateSchema,
  statusSchema,
} from './tasks.schema.js';
const actor = (res: Response) => res.locals.staff as Actor;
export function createTaskController(service: TaskService) {
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
            code: 'TASK_RECEIPT_CONFLICT',
            message:
              'An earlier attempt saved this task. Review the saved task before making changes.',
            requestId: res.locals.requestId,
            existingTaskId: result.existingTaskId,
          },
        });
        return;
      }
      res
        .status(result.replay ? 200 : 201)
        .json({ task: result.task, asOf: result.asOf });
    },

    async update(req: Request, res: Response) {
      res.json(
        await service.update(
          parseId(req.params.id),
          parse(updateSchema, req.body),
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
