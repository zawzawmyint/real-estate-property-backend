import { request as httpRequest } from 'node:http';
import { once } from 'node:events';
import request from 'supertest';
import { expect, it } from 'vitest';
import { authFixture } from './auth-fixture.js';

it('rejects oversized native auth bodies before parsing for declared and chunked requests', async () => {
  const f = await authFixture();
  const body = JSON.stringify({ padding: 'x'.repeat(1024 * 1024) });
  const server = f.app.listen(0, '127.0.0.1');

  await once(server, 'listening');

  try {
    for (const path of ['/sign-in/email', '/sign-out']) {
      const declared = await request(f.app)
        .post(`/api/v1/auth${path}`)
        .set('Origin', f.env.APP_ORIGIN)
        .send(JSON.parse(body));

      expect(declared.status).toBe(413);
      expect(declared.body).toEqual({
        code: 'PAYLOAD_TOO_LARGE',
        message: 'Auth request body is too large',
      });
      expect(declared.headers['cache-control']).toBe('no-store');
      expect(declared.headers['x-request-id']).toBeTruthy();

      const chunked = await new Promise<{
        status: number;
        body: unknown;
        cache: string | undefined;
      }>((resolve, reject) => {
        const address = server.address();

        if (!address || typeof address === 'string')
          throw new Error('Server missing address');

        const req = httpRequest(
          {
            host: '127.0.0.1',
            port: address.port,
            path: `/api/v1/auth${path}`,
            method: 'POST',
            headers: {
              Origin: f.env.APP_ORIGIN,
              'Content-Type': 'application/json',
              'Transfer-Encoding': 'chunked',
            },
          },
          (res) => {
            let output = '';

            res.setEncoding('utf8');
            res.on('data', (value) => {
              output += value;
            });
            res.on('end', () =>
              resolve({
                status: res.statusCode!,
                body: JSON.parse(output),
                cache: res.headers['cache-control'],
              }),
            );
          },
        );

        req.on('error', reject);

        for (let start = 0; start < body.length; start += 4096)
          req.write(body.slice(start, start + 4096));

        req.end();
      });

      expect(chunked.status).toBe(413);
      expect(chunked.body).toEqual({
        code: 'PAYLOAD_TOO_LARGE',
        message: 'Auth request body is too large',
      });
      expect(chunked.cache).toBe('no-store');
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await f.close();
  }
});

it('accepts exactly 100 KiB while rejecting the next streamed byte', async () => {
  const f = await authFixture();
  const server = f.app.listen(0, '127.0.0.1');

  await once(server, 'listening');

  try {
    const send = async (size: number) =>
      new Promise<number>((resolve, reject) => {
        const address = server.address();

        if (!address || typeof address === 'string')
          throw new Error('Missing server address');

        const body = JSON.stringify({
          padding: 'x'.repeat(size - JSON.stringify({ padding: '' }).length),
        });
        const req = httpRequest(
          {
            host: '127.0.0.1',
            port: address.port,
            path: '/api/v1/auth/sign-out',
            method: 'POST',
            headers: {
              Origin: f.env.APP_ORIGIN,
              'Content-Type': 'application/json',
              'Transfer-Encoding': 'chunked',
            },
          },
          (res) => {
            res.resume();
            res.on('end', () => resolve(res.statusCode!));
          },
        );

        req.on('error', reject);

        for (let start = 0; start < body.length; start += 4096)
          req.write(body.slice(start, start + 4096));

        req.end();
      });

    expect(await send(102400)).toBe(200);
    expect(await send(102401)).toBe(413);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await f.close();
  }
});
