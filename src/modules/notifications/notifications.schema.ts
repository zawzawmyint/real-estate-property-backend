import { z } from 'zod';
import { AppError } from '../../shared/errors/app-error.js';

const idSchema = z.uuid();
const cursorSchema = z.tuple([z.iso.datetime({ precision: 3 }), idSchema]);

export function parseNotificationId(value: unknown): string {
  const result = idSchema.safeParse(value);
  if (!result.success)
    throw new AppError(400, 'VALIDATION_ERROR', 'Invalid notification ID');

  return result.data;
}

export function parseNotificationCursor(params: URLSearchParams) {
  if (params.size === 0) return null;

  const cursor = params.get('cursor');
  if (params.size !== 1 || !cursor || !/^[A-Za-z0-9_-]{1,160}$/.test(cursor))
    throw new AppError(400, 'VALIDATION_ERROR', 'Invalid notification cursor');

  const decoded = Buffer.from(cursor, 'base64url');
  const result = cursorSchema.safeParse(decoded.toString('utf8').split('|'));
  if (!result.success || decoded.toString('base64url') !== cursor)
    throw new AppError(400, 'VALIDATION_ERROR', 'Invalid notification cursor');

  const [createdAt, id] = result.data;
  return { createdAt: new Date(createdAt), id };
}
