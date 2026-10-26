import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { AppError } from '../../shared/errors/app-error.js';
import type { RequestHandler } from 'express';
import type { Env } from '../../config/env.js';

export class InquiryLimiter {
  private readonly clients = new Map<string, number[]>();
  constructor(
    private readonly now: () => number = Date.now,
    private readonly capacity = 10_000,
  ) {}
  consume(identity: string) {
    const now = this.now(),
      cutoff = now - 15 * 60_000;
    for (const [key, times] of this.clients)
      if (times.at(-1)! <= cutoff) this.clients.delete(key);
    const active = (this.clients.get(identity) ?? []).filter(
      (time) => time > cutoff,
    );
    if (active.length >= 5)
      return Math.max(1, Math.ceil((active[0]! + 15 * 60_000 - now) / 1000));
    if (
      !active.length &&
      !this.clients.has(identity) &&
      this.clients.size >= this.capacity
    )
      throw new AppError(
        503,
        'SERVICE_UNAVAILABLE',
        'Inquiry service is busy; try again later',
      );
    active.push(now);
    this.clients.set(identity, active);
    return 0;
  }
}
export function inquiryProtection(
  env: Env,
  limiter = new InquiryLimiter(),
): RequestHandler {
  return (req, res, next) => {
    try {
      const key = req.get('x-inquiry-client-key'),
        signature = req.get('x-inquiry-relay-signature');
      let identity: string;
      if (key !== undefined || signature !== undefined) {
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
        identity = `relay:${key}`;
      } else
        identity = `socket:${createHash('sha256')
          .update(req.socket.remoteAddress ?? 'unknown')
          .digest('hex')}`;
      const retry = limiter.consume(identity);
      if (retry) {
        res.setHeader('Retry-After', retry);
        throw new AppError(
          429,
          'RATE_LIMITED',
          'Too many inquiry attempts; try again later',
        );
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}
