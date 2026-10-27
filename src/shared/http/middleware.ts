import type { RequestHandler } from 'express';
import { AppError } from '../errors/app-error.js';

export const noStore: RequestHandler = (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
};

export function requireTrustedOrigin(appOrigin: string): RequestHandler {
  return (req, _res, next) => {
    if (req.headers.origin !== appOrigin)
      throw new AppError(403, 'INVALID_ORIGIN', 'Untrusted request origin');

    next();
  };
}

export const requireJsonContentType: RequestHandler = (req, _res, next) => {
  if (!req.is('application/json'))
    throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Expected JSON');

  next();
};
