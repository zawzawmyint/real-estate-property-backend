import { APIError } from 'better-auth/api';

/** One process only; account keys are bounded and never evict live limits. */
export class LoginLimiter {
  private accounts = new Map<string, { count: number; until: number }>();
  private service = { count: 0, until: 0 };

  constructor(
    private readonly now: () => number = Date.now,
    private readonly capacity = 10_000,
  ) {}

  consume(email: string) {
    const now = this.now();

    for (const [key, bucket] of this.accounts)
      if (bucket.until <= now) this.accounts.delete(key);

    if (this.service.until <= now)
      this.service = { count: 0, until: now + 60_000 };

    const existing = this.accounts.get(email);
    let retry = 0;

    if (this.service.count >= 100) retry = this.service.until - now;
    if (existing && existing.count >= 5)
      retry = Math.max(retry, existing.until - now);
    if (!existing && this.accounts.size >= this.capacity)
      retry = Math.max(
        retry,
        Math.min(
          ...Array.from(this.accounts.values(), (entry) => entry.until - now),
        ),
      );
    if (retry)
      throw new APIError(
        'TOO_MANY_REQUESTS',
        {
          code: 'TOO_MANY_REQUESTS',
          message: 'Too many sign-in attempts. Try again later.',
        },
        { 'Retry-After': String(Math.max(1, Math.ceil(retry / 1000))) },
      );

    this.service.count++;

    const bucket = existing ?? { count: 0, until: now + 900_000 };

    bucket.count++;
    this.accounts.set(email, bucket);
  }
}
