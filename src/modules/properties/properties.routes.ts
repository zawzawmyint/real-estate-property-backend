import express, { type Express } from 'express';
import type { Logger } from 'pino';
import type { Env } from '../../config/env.js';
import type { Storage } from '../../infrastructure/storage/storage.js';
import type { StaffAuth } from '../auth/auth.js';
import { requireStaff } from '../auth/auth.middleware.js';
import { createPropertyController } from './properties.controller.js';
import {
  noStore,
  requireJsonContentType,
  requirePropertyPhotoUpload,
  requireTrustedOrigin,
} from './properties.middleware.js';
import type { Database } from './properties.repository.js';
import { createPropertyService } from './properties.service.js';

export function mountProperties(
  app: Express,
  auth: StaffAuth,
  env: Env,
  database: Database,
  storage: Storage,
  logger: Logger,
) {
  const service = createPropertyService(database, storage, logger);
  const controller = createPropertyController(service);

  const router = express.Router();
  const staff = express.Router();

  const origin = requireTrustedOrigin(env.APP_ORIGIN);
  const parseJson = express.json({ limit: '100kb' });
  const write = [requireStaff(auth, ['admin', 'manager']), origin];
  const jsonWrite = [...write, requireJsonContentType, parseJson];

  router.use(noStore);
  router.get('/', controller.publicList);
  router.get('/:id', controller.publicDetail);

  staff.use(noStore);
  staff.get('/', requireStaff(auth), controller.staffList);
  staff.get('/:id', requireStaff(auth), controller.staffDetail);
  staff.post('/', ...jsonWrite, controller.create);
  staff.patch('/:id', ...jsonWrite, controller.patch);
  staff.delete(
    '/:id',
    requireStaff(auth, ['admin']),
    origin,
    controller.remove,
  );
  staff.post(
    '/:id/photos',
    ...write,
    requirePropertyPhotoUpload(service),
    controller.upload,
  );
  staff.patch('/:id/photos/order', ...jsonWrite, controller.order);
  staff.delete('/:id/photos/:photoId', ...write, controller.removePhoto);

  app.use('/api/v1/properties', router);
  app.use('/api/v1/staff/properties', staff);
}
