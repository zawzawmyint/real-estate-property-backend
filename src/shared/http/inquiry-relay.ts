import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import type { Env } from '../../config/env.js';
import { AppError } from '../errors/app-error.js';

export function inquiryRelayIdentity(req: Request, env: Env): string {
  const key = req.get('x-inquiry-client-key');
  const signature = req.get('x-inquiry-relay-signature');

  if (
    env.NODE_ENV !== 'production' &&
    key === undefined &&
    signature === undefined
  )
    return `socket:${createHash('sha256')
      .update(req.socket.remoteAddress ?? 'unknown')
      .digest('hex')}`;

  if (
    !env.INQUIRY_RELAY_SECRET ||
    !key ||
    !signature ||
    !/^[a-f0-9]{64}$/.test(key) ||
    !/^[a-f0-9]{64}$/.test(signature)
  )
    throw new AppError(403, 'FORBIDDEN', 'Untrusted inquiry relay');

  const expected = createHmac('sha256', env.INQUIRY_RELAY_SECRET)
    .update(key)
    .digest();
  if (!timingSafeEqual(expected, Buffer.from(signature, 'hex')))
    throw new AppError(403, 'FORBIDDEN', 'Untrusted inquiry relay');

  return `relay:${key}`;
}
