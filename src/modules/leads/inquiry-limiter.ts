import { AppError } from '../../shared/errors/app-error.js';
import type { RequestHandler } from 'express';
import type { Env } from '../../config/env.js';
import { inquiryRelayIdentity } from '../../shared/http/inquiry-relay.js';

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
      const retry = limiter.consume(inquiryRelayIdentity(req, env));
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
