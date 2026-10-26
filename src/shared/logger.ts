import pino from 'pino';

export function createLogger(level: string) {
  return pino({
    level,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers["set-cookie"]',
        'password',
        'token',
      ],
      censor: '[REDACTED]',
    },
  });
}
