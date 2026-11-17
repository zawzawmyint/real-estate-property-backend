import { Agent, request as httpRequest, type Server } from 'node:http';
import { once } from 'node:events';
import { expect, it } from 'vitest';
import { authFixture } from './auth-fixture.js';

async function closeFixture(
  server: Server,
  fixture: Awaited<ReturnType<typeof authFixture>>,
) {
  try {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      // Early rejection can leave an upload active rather than idle.
      server.closeAllConnections();
    });
  } finally {
    await fixture.close();
  }
}

it('rejects oversized native auth bodies before parsing for declared and chunked requests', async () => {
  const f = await authFixture();
  const body = JSON.stringify({ padding: 'x'.repeat(1024 * 1024) });
  const server = f.app.listen(0, '127.0.0.1');

  await once(server, 'listening');

  try {
    for (const path of ['/sign-in/email', '/sign-out']) {
      // Reject declared oversizes from headers before any body is consumed.
      // Eagerly sending 1 MiB races the early response with socket shutdown.
      const declared = await new Promise<{
        status: number;
        body: unknown;
        headers: import('node:http').IncomingHttpHeaders;
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
            agent: false,
            headers: {
              Origin: f.env.APP_ORIGIN,
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(body),
              Connection: 'close',
            },
          },
          (res) => {
            let output = '';

            res.setEncoding('utf8');
            res.on('error', reject);
            res.on('aborted', () => reject(new Error('Auth response aborted')));
            res.on('data', (value) => {
              output += value;
            });
            res.on('end', () => {
              try {
                resolve({
                  status: res.statusCode!,
                  body: JSON.parse(output),
                  headers: res.headers,
                });
              } catch (error) {
                reject(error);
              } finally {
                req.destroy();
              }
            });
          },
        );

        req.on('error', reject);
        req.flushHeaders();
      });
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
            agent: false,
            headers: {
              Origin: f.env.APP_ORIGIN,
              'Content-Type': 'application/json',
              'Transfer-Encoding': 'chunked',
              Connection: 'close',
            },
          },
          (res) => {
            let output = '';

            res.setEncoding('utf8');
            res.on('error', reject);
            res.on('aborted', () => reject(new Error('Auth response aborted')));
            res.on('data', (value) => {
              output += value;
            });
            res.on('end', () => {
              try {
                resolve({
                  status: res.statusCode!,
                  body: JSON.parse(output),
                  cache: res.headers['cache-control'],
                });
              } catch (error) {
                reject(error);
              } finally {
                req.destroy();
              }
            });
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
    await closeFixture(server, f);
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
            agent: false,
            headers: {
              Origin: f.env.APP_ORIGIN,
              'Content-Type': 'application/json',
              'Transfer-Encoding': 'chunked',
              Connection: 'close',
            },
          },
          (res) => {
            res.resume();
            res.on('error', reject);
            res.on('aborted', () => reject(new Error('Auth response aborted')));
            res.on('end', () => {
              resolve(res.statusCode!);
              req.destroy();
            });
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
    await closeFixture(server, f);
  }
});

it('rejects an oversized chunked upload before it finishes and releases its connection', async () => {
  const f = await authFixture();
  const server = f.app.listen(0, '127.0.0.1');
  const agent = new Agent({ keepAlive: true });
  let req: ReturnType<typeof httpRequest> | undefined;

  await once(server, 'listening');

  try {
    const address = server.address();

    if (!address || typeof address === 'string')
      throw new Error('Missing address');

    const response = await new Promise<{
      status: number;
      body: unknown;
      headers: import('node:http').IncomingHttpHeaders;
    }>((resolve, reject) => {
      req = httpRequest(
        {
          host: '127.0.0.1',
          port: address.port,
          path: '/api/v1/auth/sign-out',
          method: 'POST',
          agent,
          headers: {
            Origin: f.env.APP_ORIGIN,
            'Content-Type': 'application/json',
            'Transfer-Encoding': 'chunked',
            Connection: 'keep-alive',
          },
        },
        (res) => {
          let output = '';

          res.setEncoding('utf8');
          res.on('error', reject);
          res.on('aborted', () => reject(new Error('Auth response aborted')));
          res.on('data', (value) => {
            output += value;
          });
          res.on('end', () => {
            try {
              resolve({
                status: res.statusCode!,
                body: JSON.parse(output),
                headers: res.headers,
              });
            } catch (error) {
              reject(error);
            }
          });
        },
      );

      req.on('error', reject);
      // Deliberately leave the request open: rejection must not wait for EOF.
      req.write(Buffer.alloc(102401, 'x'));
    });

    expect(response.status).toBe(413);
    expect(response.body).toEqual({
      code: 'PAYLOAD_TOO_LARGE',
      message: 'Auth request body is too large',
    });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-request-id']).toBeTruthy();
  } finally {
    try {
      await closeFixture(server, f);
    } finally {
      req?.destroy();
      agent.destroy();
    }
  }
});
