import type { Express } from 'express';
import type { Database } from '../../../infrastructure/database/transaction.js';
import { noStore } from '../../../shared/http/middleware.js';
import { requireStaff } from '../../auth/auth.middleware.js';
import type { StaffAuth } from '../../auth/auth.js';
import { createAgentPerformanceController } from './agent-performance.controller.js';
import { createAgentPerformanceService } from './agent-performance.service.js';

export function mountAgentPerformance(
  app: Express,
  auth: StaffAuth,
  database: Database,
) {
  const controller = createAgentPerformanceController(
    createAgentPerformanceService(database),
  );
  app.get(
    '/api/v1/staff/reports/agent-performance',
    noStore,
    requireStaff(auth),
    controller,
  );
}
