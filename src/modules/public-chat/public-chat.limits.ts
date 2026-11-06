import type { RequestHandler } from 'express';
import type { Env } from '../../config/env.js';
import { inquiryRelayIdentity } from '../../shared/http/inquiry-relay.js';
import {
  publicChatRateLimited,
  publicChatUnavailable,
} from './public-chat.errors.js';

const clientWindowMs = 60_000;
const clientRequestLimit = 5;
const maxClients = 10_000;
const upstreamWindowMs = 24 * 60 * 60_000;

export function limitPublicChatClients(env: Env): RequestHandler {
  const clients = new Map<string, { count: number; expiresAt: number }>();

  return (req, res, next) => {
    const identity = inquiryRelayIdentity(req, env);
    const now = Date.now();
    const window = clients.get(identity);

    if (window && window.expiresAt > now) {
      if (window.count >= clientRequestLimit) {
        res.setHeader(
          'Retry-After',
          Math.ceil((window.expiresAt - now) / 1000),
        );
        throw publicChatRateLimited();
      }
      window.count++;
    } else {
      if (!window && clients.size >= maxClients) {
        for (const [key, entry] of clients)
          if (entry.expiresAt <= now) clients.delete(key);
        if (clients.size >= maxClients) throw publicChatUnavailable();
      }
      clients.set(identity, { count: 1, expiresAt: now + clientWindowMs });
    }

    next();
  };
}

export function createPublicChatUpstreamLimit(
  maxCalls: number,
  now: () => number = Date.now,
) {
  const timestamps: number[] = [];

  return () => {
    const time = now();
    while (timestamps.length && timestamps[0]! <= time - upstreamWindowMs)
      timestamps.shift();
    if (timestamps.length >= maxCalls) throw publicChatRateLimited();
    timestamps.push(time);
  };
}
