import type { Request, Response } from 'express';
import type { createAuditLogService } from './audit-log.service.js';
import { parseListQuery, parseActorQuery } from './audit-log.schema.js';
import { auditLogDto } from './audit-log.dto.js';

export function createAuditController(
  service: ReturnType<typeof createAuditLogService>,
) {
  return {
    async list(req: Request, res: Response) {
      const result = await service.list(
        () => parseListQuery(req.originalUrl),
        res.locals.staff,
      );

      res.json(auditLogDto(result));
    },

    async actors(req: Request, res: Response) {
      res.json(
        await service.actors(
          () => parseActorQuery(req.originalUrl),
          res.locals.staff,
        ),
      );
    },
  };
}
