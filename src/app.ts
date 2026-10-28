import { mountLeads } from './modules/leads/leads.routes.js';
import express from 'express';
import { mountAuth } from './modules/auth/auth.routes.js';
import type { StaffAuth } from './modules/auth/auth.js';
import helmet from 'helmet';
import type { Env } from './config/env.js';
import {
  LocalStorage,
  StorageKeyError,
} from './infrastructure/storage/local-storage.js';
import { errorHandler } from './middleware/error-handler.js';
import { notFound } from './middleware/not-found.js';
import { requestId } from './middleware/request-id.js';
import { healthRouter } from './modules/health/health.routes.js';
import { AppError } from './shared/errors/app-error.js';
import { createLogger } from './shared/logger.js';
import { mountProperties } from './modules/properties/properties.routes.js';
import type { Database } from './infrastructure/database/transaction.js';
import type { Storage } from './infrastructure/storage/storage.js';
import { mountAgency } from './modules/agency/agency.routes.js';

export function createApp(
  env: Env,
  auth: StaffAuth,
  database: Database,
  propertyStorage?: Storage,
  readAgencyCatalog?: () => unknown,
) {
  const app = express();
  const logger = createLogger(env.LOG_LEVEL);
  const storage = new LocalStorage(env.STORAGE_ROOT, env.PUBLIC_ORIGIN);

  app.disable('x-powered-by');
  app.use(requestId);
  app.use(helmet());
  app.use((req, res, next) => {
    const start = performance.now();

    res.on('finish', () =>
      logger.info(
        {
          requestId: res.locals.requestId,
          method: req.method,
          status: res.statusCode,
          durationMs: Math.round(performance.now() - start),
        },
        'HTTP request',
      ),
    );
    next();
  });

  mountAuth(app, auth, env);
  mountLeads(app, auth, env, database);
  mountAgency(app, readAgencyCatalog);
  mountProperties(app, auth, env, database, propertyStorage ?? storage, logger);

  app.use(express.json({ limit: '100kb' }));
  app.use('/api/v1/health', healthRouter);

  app.get('/media/:key', async (req, res, next) => {
    let file: string;

    try {
      file = await storage.resolveFile(req.params.key);
    } catch (error) {
      if (
        error instanceof StorageKeyError ||
        (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      ) {
        throw new AppError(404, 'NOT_FOUND', 'Public image not found');
      }

      throw error;
    }

    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.sendFile(file, { dotfiles: 'deny' }, (error) => {
      if (error) next(error);
    });
  });

  app.use(notFound);
  app.use(errorHandler(logger));

  return app;
}
