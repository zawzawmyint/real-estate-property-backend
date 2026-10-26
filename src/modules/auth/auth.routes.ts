import { getRequest, setResponse } from 'better-call/node';
import type { Express } from 'express';
import type { Env } from '../../config/env.js';
import type { StaffAuth } from './auth.js';

export function mountAuth(app: Express, auth: StaffAuth, env: Env) {
  const bodyLimit = 100 * 1024;

  app.use('/api/v1/auth', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');

    const allowed =
      (req.method === 'POST' &&
        ['/sign-in/email', '/sign-out'].includes(
          req.url.split('?')[0] ?? '',
        )) ||
      (req.method === 'GET' && req.url.split('?')[0] === '/get-session');

    if (!allowed) {
      res
        .status(404)
        .json({ code: 'NOT_FOUND', message: 'Auth route not found' });
      return;
    }
    if (req.method === 'POST') {
      if (req.headers.origin !== env.APP_ORIGIN) {
        res.status(403).json({
          code: 'INVALID_ORIGIN',
          message: 'Untrusted request origin',
        });
        return;
      }

      const hasBody =
        req.headers['transfer-encoding'] !== undefined ||
        Number(req.headers['content-length'] ?? 0) > 0;

      if (
        (req.url.split('?')[0] === '/sign-in/email' || hasBody) &&
        !req.is('application/json')
      ) {
        res
          .status(415)
          .json({ code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Expected JSON' });
        return;
      }
    }

    next();
  });

  app.all('/api/v1/auth/{*path}', async (req, res) => {
    try {
      // Better Auth's toNodeHandler uses this same vendor adapter without a
      // size limit. Bound raw bytes before the native handler parses JSON;
      // sign-out must be bounded even if its endpoint ignores the body.
      let nativeRequest = getRequest({
        request: req,
        base: env.APP_ORIGIN,
        bodySizeLimit: bodyLimit,
      });

      if (nativeRequest.body) {
        const bytes = await nativeRequest.arrayBuffer();
        nativeRequest = new Request(nativeRequest, { body: bytes });
      }

      await setResponse(res, await auth.handler(nativeRequest));
    } catch (error) {
      if (
        error instanceof Error &&
        (/^Received content-length of \d+, but only accept up to 102400 bytes\.$/.test(
          error.message,
        ) ||
          /^request body size exceeded '(?:content-length)' of 102400$/.test(
            error.message,
          ) ||
          error.message ===
            'request body size exceeded BODY_SIZE_LIMIT of 102400')
      ) {
        if (!res.headersSent)
          res.status(413).json({
            code: 'PAYLOAD_TOO_LARGE',
            message: 'Auth request body is too large',
          });

        return;
      }
      if (!res.headersSent)
        res.status(500).json({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Authentication service unavailable',
        });
    }
  });
}
