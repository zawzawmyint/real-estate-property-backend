import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

export const requestId: RequestHandler = (_req, res, next) => {
  res.locals.requestId = randomUUID();
  res.setHeader('X-Request-Id', res.locals.requestId as string);
  next();
};
