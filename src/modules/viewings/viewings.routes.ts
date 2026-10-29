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
import { createViewingService } from './viewings.service.js';
import { createViewingController } from './viewings.controller.js';
export function mountViewings(
  app: Express,
  auth: StaffAuth,
  env: Env,
  database: Database,
) {
  const router = express.Router(),
    controller = createViewingController(createViewingService(database));
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
  router.patch('/:id', ...write, controller.reschedule);
  router.patch('/:id/status', ...write, controller.status);
  app.use('/api/v1/staff/viewings', router);
}
