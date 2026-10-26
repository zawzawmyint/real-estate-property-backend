import express, { type Express } from 'express';
import type { Env } from '../../config/env.js';
import type { StaffAuth } from '../auth/auth.js';
import { requireStaff } from '../auth/auth.middleware.js';
import type { Database } from '../properties/properties.repository.js';
import { createLeadController } from './leads.controller.js';
import {
  inquiryProtection,
  noStore,
  requireJsonContentType,
  requireTrustedOrigin,
} from './leads.middleware.js';
import { createLeadService } from './leads.service.js';

export function mountLeads(
  app: Express,
  auth: StaffAuth,
  env: Env,
  database: Database,
) {
  const controller = createLeadController(createLeadService(database)),
    staff = express.Router(),
    inquiries = express.Router();

  const origin = requireTrustedOrigin(env.APP_ORIGIN),
    parseJson = express.json({ limit: '16kb' }),
    live = requireStaff(auth),
    managers = requireStaff(auth, ['admin', 'manager']);
  const write = [live, origin, requireJsonContentType, parseJson];

  staff.use(noStore);
  staff.get('/', live, controller.list);
  staff.get('/assignment-candidates', managers, controller.candidates);
  staff.get('/:id', live, controller.detail);
  staff.get('/:id/activity', live, controller.activity);

  staff.post('/', ...write, controller.create);
  staff.patch('/:id', ...write, controller.patch);
  staff.patch(
    '/:id/assignment',
    managers,
    origin,
    requireJsonContentType,
    parseJson,
    controller.assignment,
  );
  staff.patch('/:id/stage', ...write, controller.stage);
  staff.post('/:id/notes', ...write, controller.note);

  inquiries.use(noStore);
  inquiries.post(
    '/:propertyId/inquiries',
    origin,
    inquiryProtection(env),
    requireJsonContentType,
    parseJson,
    controller.inquiry,
  );

  app.use('/api/v1/staff/leads', staff);
  app.use('/api/v1/public/properties', inquiries);
}
