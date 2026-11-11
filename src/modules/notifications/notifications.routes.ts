import express, { type Express } from 'express';
import type { Env } from '../../config/env.js';
import { noStore, requireTrustedOrigin } from '../../shared/http/middleware.js';
import { requireStaff } from '../auth/auth.middleware.js';
import type { StaffAuth } from '../auth/auth.js';
import { createNotificationController } from './notifications.controller.js';
import type { NotificationService } from './notifications.service.js';
import type { NotificationStreams } from './notifications.stream.js';

export function mountNotifications(
  app: Express,
  auth: StaffAuth,
  env: Env,
  service: NotificationService,
  streams: NotificationStreams,
) {
  const router = express.Router();
  const controller = createNotificationController(service, streams);
  const live = requireStaff(auth);

  router.use(noStore);
  router.get('/', live, controller.list);
  router.get('/stream', live, controller.stream);
  router.patch(
    '/:id/read',
    live,
    requireTrustedOrigin(env.APP_ORIGIN),
    controller.markRead,
  );

  app.use('/api/v1/staff/notifications', router);
}
