import type { Request, Response } from 'express';
import { AppError } from '../../shared/errors/app-error.js';
import type { Actor } from '../leads/leads.repository.js';
import type { DashboardService } from './dashboard.service.js';
export function createDashboardController(service: DashboardService) {
  return {
    async summary(req: Request, res: Response) {
      if (new URL(req.originalUrl, 'http://localhost').searchParams.size !== 0)
        throw new AppError(
          400,
          'VALIDATION_ERROR',
          'Dashboard does not accept query parameters',
        );
      res.json(await service.summary(res.locals.staff as Actor));
    },
  };
}
