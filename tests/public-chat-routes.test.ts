import { createHmac } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { parseEnv } from '../src/config/env.js';
import { errorHandler } from '../src/middleware/error-handler.js';
import { requestId } from '../src/middleware/request-id.js';
import { createPublicChatUpstreamLimit } from '../src/modules/public-chat/public-chat.limits.js';
import { mountPublicChat } from '../src/modules/public-chat/public-chat.routes.js';
import { AppError } from '../src/shared/errors/app-error.js';
import { createLogger } from '../src/shared/logger.js';

const secret = 'test-only-secret-for-public-chat-ingress';
const faq = {
  kind: 'faq',
  message: 'Contact the agency to ask about viewing times.',
  sources: [{ id: 'viewings', title: 'Contact', path: '/contact' }],
  properties: [],
} as const;

function createTestApp(options: Record<string, string> = {}) {
  const env = parseEnv({
    NODE_ENV: 'test',
    BETTER_AUTH_SECRET: secret,
    PUBLIC_CHAT_ENABLED: 'true',
    ...options,
  });
  const reply = vi.fn().mockResolvedValue(faq);
  const app = express();

  app.use(requestId);
  mountPublicChat(app, env, reply);
  app.use(errorHandler(createLogger('silent')));

  return {
    reply,
    post: () =>
      request(app).post('/api/v1/public/chat').set('Origin', env.APP_ORIGIN),
  };
}

describe('public chat transport', () => {
  it('accepts anonymous bounded JSON and trims the question', async () => {
    const { post, reply } = createTestApp();
    const response = await post().send({ message: '  Viewing times?  ' });

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toEqual(faq);
    expect(reply).toHaveBeenCalledExactlyOnceWith('Viewing times?');
  });

  it('checks origins and payload bounds before invoking the service', async () => {
    const { post, reply } = createTestApp();
    const wrongOrigin = await post()
      .set('Origin', 'http://other.example')
      .send({ message: 'Hello' });
    const oversized = await post().send({ message: 'a'.repeat(8192) });
    const tooLong = await post().send({ message: 'a'.repeat(501) });
    const extraFields = await post().send({ message: 'Hello', extra: true });
    const malformed = await post().type('json').send('{"message":');
    const unsupportedEncoding = await post()
      .set('Content-Encoding', 'unknown')
      .send({ message: 'Hello' });

    expect(wrongOrigin.status).toBe(403);
    expect(oversized.status).toBe(413);
    expect(tooLong.status).toBe(400);
    expect(extraFields.status).toBe(400);
    expect(malformed.status).toBe(400);
    expect(unsupportedEncoding.status).toBe(415);
    expect(reply).not.toHaveBeenCalled();
  });

  it('requires signed client identity in production', async () => {
    const { post, reply } = createTestApp({
      NODE_ENV: 'production',
      APP_ORIGIN: 'https://agency.example',
      BETTER_AUTH_URL: 'https://agency.example/api/v1/auth',
      INQUIRY_RELAY_SECRET: secret,
    });
    const key = createHmac('sha256', secret).update('192.0.2.1').digest('hex');
    const signature = createHmac('sha256', secret).update(key).digest('hex');

    expect((await post().send({ message: 'Hello' })).status).toBe(403);
    expect(
      (
        await post()
          .set('x-inquiry-client-key', key)
          .set('x-inquiry-relay-signature', 'a'.repeat(64))
          .send({ message: 'Hello' })
      ).status,
    ).toBe(403);
    expect(
      (
        await post()
          .set('x-inquiry-client-key', key)
          .set('x-inquiry-relay-signature', signature)
          .send({ message: 'Hello' })
      ).status,
    ).toBe(200);
    expect(reply).toHaveBeenCalledOnce();
  });

  it('handles disabled mode and applies a separate per-client limit', async () => {
    const disabled = createTestApp({ PUBLIC_CHAT_ENABLED: 'false' });
    expect((await disabled.post().send({ message: 'Hello' })).status).toBe(503);
    expect(disabled.reply).not.toHaveBeenCalled();

    const enabled = createTestApp();
    for (let i = 0; i < 5; i++)
      expect((await enabled.post().send({ message: 'Hello' })).status).toBe(
        200,
      );
    const limited = await enabled.post().send({ message: 'Hello' });

    expect(limited.status).toBe(429);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect(enabled.reply).toHaveBeenCalledTimes(5);
  });

  it('returns safe provider errors with the normal correlation ID', async () => {
    const { post, reply } = createTestApp();
    reply.mockRejectedValueOnce(new Error('private provider failure'));
    const response = await post().send({ message: 'Hello' });

    expect(response.status).toBe(503);
    expect(response.body.error).toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      requestId: response.headers['x-request-id'],
    });
    expect(response.text).not.toContain('private provider failure');
  });

  it('charges the shared budget for individual calls and recovers after expiry', () => {
    let now = 0;
    const consume = createPublicChatUpstreamLimit(2, () => now);

    consume();
    now = 100;
    consume();
    expect(consume).toThrow(AppError);
    try {
      consume();
    } catch (error) {
      expect(error).toMatchObject({ status: 429, code: 'RATE_LIMITED' });
    }
    now = 24 * 60 * 60_000;
    expect(consume).not.toThrow();
    expect(consume).toThrow(AppError);
  });
});
