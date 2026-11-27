import type { Express } from 'express';
import type { Database } from '../../infrastructure/database/transaction.js';
import { noStore } from '../../shared/http/middleware.js';
import { requireStaff } from '../auth/auth.middleware.js';
import type { StaffAuth } from '../auth/auth.js';
import { createAuditLogService } from './audit-log.service.js';
import { createAuditController } from './audit-log.controller.js';

export function mountAuditLog(
  app: Express,
  auth: StaffAuth,
  database: Database,
) {
  const handlers = createAuditController(createAuditLogService(database));
  const staff = requireStaff(auth);

  app.get('/api/v1/staff/audit-log', noStore, staff, handlers.list);
  app.get('/api/v1/staff/audit-log/actors', noStore, staff, handlers.actors);
}
