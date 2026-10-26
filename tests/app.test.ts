import request from 'supertest';
import { authFixture, testSecret } from './auth-fixture.js';
import { afterAll } from 'vitest';

const fixture = await authFixture();

afterAll(() => fixture.close());

import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalStorage } from '../src/infrastructure/storage/local-storage.js';

const app = createApp(
  parseEnv({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    BETTER_AUTH_SECRET: testSecret,
  }),
  fixture.auth,
  fixture.database,
);

describe('HTTP boundary', () => {
  it('exposes liveness with a response request ID', async () => {
    const response = await request(app).get('/api/v1/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok', service: 'real-estate-api' });
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.headers['x-powered-by']).toBeUndefined();
  });
  it('returns structured missing route errors without reflecting query secrets', async () => {
    const response = await request(app).get('/missing?token=secret');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'Route not found',
        requestId: response.headers['x-request-id'],
      },
    });
  });
  it('rejects malformed JSON using the shared error contract', async () => {
    const response = await request(app)
      .post('/missing')
      .set('Content-Type', 'application/json')
      .send('{');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_JSON');
    expect(response.body.error.requestId).toBe(
      response.headers['x-request-id'],
    );
  });
  it('limits request bodies', async () => {
    const response = await request(app)
      .post('/missing')
      .send({ data: 'x'.repeat(110_000) });

    expect(response.status).toBe(413);
    expect(response.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });
});

it('serves saved public images across the frontend origin and rejects unknown keys', async () => {
  const root = await mkdtemp(join(tmpdir(), 'real-estate-http-'));

  try {
    const storage = new LocalStorage(root, 'http://localhost:4311');
    const key = await storage.save(Buffer.from('image bytes'), '.png');
    const mediaApp = createApp(
      parseEnv({
        NODE_ENV: 'test',
        LOG_LEVEL: 'silent',
        BETTER_AUTH_SECRET: testSecret,
        STORAGE_ROOT: root,
      }),
      fixture.auth,
      fixture.database,
    );
    const response = await request(mediaApp).get(`/media/${key}`);

    expect(response.status).toBe(200);
    expect(response.body.toString()).toBe('image bytes');
    expect(response.headers['cross-origin-resource-policy']).toBe(
      'cross-origin',
    );
    expect((await request(mediaApp).get('/media/invalid')).status).toBe(404);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('does not misreport storage infrastructure failures as missing images', async () => {
  const root = await mkdtemp(join(tmpdir(), 'real-estate-http-'));

  try {
    const file = join(root, 'not-a-directory');

    await writeFile(file, 'blocked storage');

    const mediaApp = createApp(
      parseEnv({
        NODE_ENV: 'test',
        LOG_LEVEL: 'silent',
        BETTER_AUTH_SECRET: testSecret,
        STORAGE_ROOT: file,
      }),
      fixture.auth,
      fixture.database,
    );
    const response = await request(mediaApp).get(
      '/media/00000000-0000-4311-8000-000000000000.jpg',
    );

    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(response.body)).not.toContain(file);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
