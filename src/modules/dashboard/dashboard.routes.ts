import express, { type Express } from 'express';
import type { Database } from '../../infrastructure/database/transaction.js';
import type { StaffAuth } from '../auth/auth.js';
import { requireStaff } from '../auth/auth.middleware.js';
import { noStore } from '../../shared/http/middleware.js';
import { createDashboardController } from './dashboard.controller.js';
import { createDashboardService } from './dashboard.service.js';
export function mountDashboard(
  app: Express,
  auth: StaffAuth,
  database: Database,
) {
  const router = express.Router();
  const controller = createDashboardController(
    createDashboardService(database),
  );
  router.use(noStore);
  router.get('/', requireStaff(auth), controller.summary);
  app.use('/api/v1/staff/dashboard', router);
}
