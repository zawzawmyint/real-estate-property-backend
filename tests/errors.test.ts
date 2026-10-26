import express from 'express';
import request from 'supertest';
import { expect, it } from 'vitest';
import { errorHandler } from '../src/middleware/error-handler.js';
import { requestId } from '../src/middleware/request-id.js';
import { AppError } from '../src/shared/errors/app-error.js';
import { createLogger } from '../src/shared/logger.js';

it('hides unexpected error details and keeps known domain errors safe', async () => {
  const app = express();

  app.use(requestId);
  app.get('/crash', () => {
    throw new Error('SECRET database path');
  });
  app.get('/known', () => {
    throw new AppError(409, 'CONFLICT', 'Record already exists');
  });
  app.use(errorHandler(createLogger('silent')));

  const response = await request(app).get('/crash');

  expect(response.status).toBe(500);
  expect(response.body.error.code).toBe('INTERNAL_ERROR');
  expect(response.body.error.message).toBe('An unexpected error occurred');
  expect(JSON.stringify(response.body)).not.toContain('SECRET');

  const known = await request(app).get('/known');

  expect(known.status).toBe(409);
  expect(known.body.error.code).toBe('CONFLICT');
});
