import express, { type Express } from 'express';
import type { Env } from '../../config/env.js';
import type { StaffAuth } from '../auth/auth.js';
import { requireStaff } from '../auth/auth.middleware.js';
import type { Database } from '../../infrastructure/database/transaction.js';
import { createLeadController } from './leads.controller.js';
import {
  noStore,
  requireJsonContentType,
  requireTrustedOrigin,
} from '../../shared/http/middleware.js';
import { inquiryProtection } from './inquiry-limiter.js';
import { createLeadService } from './leads.service.js';

export function mountLeads(
  app: Express,
  auth: StaffAuth,
  env: Env,
  database: Database,
) {
  const controller = createLeadController(createLeadService(database)),
    staff = express.Router(),
    inquiries = express.Router(),
    agencyInquiries = express.Router();

  const origin = requireTrustedOrigin(env.APP_ORIGIN),
    parseJson = express.json({ limit: '16kb' }),
    live = requireStaff(auth),
    managers = requireStaff(auth, ['admin', 'manager']);
  const write = [live, origin, requireJsonContentType, parseJson];
  const protectInquiry = inquiryProtection(env);

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
    protectInquiry,
    requireJsonContentType,
    parseJson,
    controller.inquiry,
  );

  agencyInquiries.use(noStore);
  agencyInquiries.post(
    '/',
    origin,
    protectInquiry,
    requireJsonContentType,
    parseJson,
    controller.agencyInquiry,
  );

  app.use('/api/v1/staff/leads', staff);
  app.use('/api/v1/public/properties', inquiries);
  app.use('/api/v1/public/inquiries', agencyInquiries);
}
