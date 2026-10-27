import express, {
  type Express,
  type RequestHandler,
  type ErrorRequestHandler,
} from 'express';
import { AppError } from '../../shared/errors/app-error.js';
import { noStore } from '../../shared/http/middleware.js';
import { createAgencyController } from './agency.controller.js';
import { createAgencyRepository } from './agency.repository.js';
import { createAgencyService } from './agency.service.js';

const noQuery: RequestHandler = (req, _res, next) => {
  if (new URL(req.originalUrl, 'http://local').searchParams.size)
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'Query parameters are not supported',
    );
  next();
};

const invalidAgentEncoding: ErrorRequestHandler = (error, _req, res, next) => {
  if (error instanceof URIError) {
    res.setHeader('Cache-Control', 'no-store');
    next(new AppError(404, 'NOT_FOUND', 'Agent not found'));
    return;
  }
  next(error);
};

export function mountAgency(app: Express, readCatalog?: () => unknown) {
  const router = express.Router();
  const controller = createAgencyController(
    createAgencyService(createAgencyRepository(readCatalog)),
  );

  router.get('/agency', noStore, noQuery, controller.agency);
  router.get('/agents', noStore, noQuery, controller.agents);
  router.get('/agents/:slug', noStore, noQuery, controller.agent);
  router.use(invalidAgentEncoding);

  app.use('/api/v1/public', router);
}
