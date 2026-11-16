import express, { type RequestHandler } from 'express';
import { AppError } from '../errors/app-error.js';

export const requireImportUtf8: RequestHandler = (req, _res, next) => {
  const charset = /;\s*charset\s*=\s*"?([^;"\s]+)/i.exec(
    req.get('Content-Type') ?? '',
  )?.[1];
  if (charset && charset.toLowerCase() !== 'utf-8')
    throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Use UTF-8 JSON.');
  next();
};

export const parseImportJson = express.json({
  limit: '6mb',
  verify(_req, _res, buffer) {
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    } catch {
      throw new AppError(400, 'IMPORT_INVALID_CSV', 'Use valid UTF-8 input.');
    }
  },
});
