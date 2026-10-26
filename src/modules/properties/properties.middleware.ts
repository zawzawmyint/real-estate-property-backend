import type { RequestHandler } from 'express';
import { AppError } from '../../shared/errors/app-error.js';
import type { StaffRole } from '../auth/auth.js';
import { imageContentTypes } from './properties.image.js';
import { parseId } from './properties.schema.js';
import type { PropertyService } from './properties.service.js';

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

export function requirePropertyPhotoUpload(
  service: Pick<PropertyService, 'assertUpload'>,
): RequestHandler {
  return async (req, res, next) => {
    // Check the resource before inspecting/reading the upload body. The service
    // remains responsible for permissions, state and saved-photo constraints.
    await service.assertUpload(
      parseId(req.params.id),
      res.locals.staff.role as StaffRole,
    );

    const contentType = req.get('Content-Type')?.split(';')[0]?.trim() ?? '';

    if (!imageContentTypes.includes(contentType))
      throw new AppError(
        415,
        'UNSUPPORTED_MEDIA_TYPE',
        'Expected raw JPEG, PNG or WebP',
      );

    next();
  };
}
