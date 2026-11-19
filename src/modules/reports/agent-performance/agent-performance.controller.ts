import type { Request, Response } from 'express';
import type { Actor } from '../../leads/leads.repository.js';
import { parsePerformanceQuery } from './agent-performance.schema.js';
import type { createAgentPerformanceService } from './agent-performance.service.js';

export function createAgentPerformanceController(
  service: ReturnType<typeof createAgentPerformanceService>,
) {
  return async (req: Request, res: Response) => {
    const query = parsePerformanceQuery(req.originalUrl);
    res.json(await service.report(res.locals.staff as Actor, query));
  };
}
