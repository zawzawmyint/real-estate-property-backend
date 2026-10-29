import express, { type Express } from 'express';
import type { Env } from '../../config/env.js';
import type { Database } from '../../infrastructure/database/transaction.js';
import type { StaffAuth } from '../auth/auth.js';
import { requireStaff } from '../auth/auth.middleware.js';
import {
  noStore,
  requireTrustedOrigin,
  requireJsonContentType,
} from '../../shared/http/middleware.js';
import { createTaskService } from './tasks.service.js';
import { createTaskController } from './tasks.controller.js';
export function mountTasks(
  app: Express,
  auth: StaffAuth,
  env: Env,
  database: Database,
) {
  const router = express.Router(),
    controller = createTaskController(createTaskService(database));
  const live = requireStaff(auth),
    write = [
      live,
      requireTrustedOrigin(env.APP_ORIGIN),
      requireJsonContentType,
      express.json({ limit: '16kb' }),
    ];
  router.use(noStore);
  router.get('/', live, controller.list);
  router.get('/:id', live, controller.detail);
  router.post('/', ...write, controller.create);
  router.patch('/:id', ...write, controller.update);
  router.patch('/:id/status', ...write, controller.status);
  app.use('/api/v1/staff/tasks', router);
}
