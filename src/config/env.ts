import { resolve } from 'node:path';
import { z } from 'zod';

const origin = z.url().refine((value) => {
  const url = URL.parse(value);

  return (
    url !== null &&
    ['http:', 'https:'].includes(url.protocol) &&
    url.origin === value &&
    !url.username &&
    !url.password
  );
}, 'Must be an exact HTTP(S) origin without path or credentials');
const schema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    HOST: z.string().min(1).default('127.0.0.1'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4311),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    DATABASE_URL: z
      .string()
      .regex(/^file:.+$/, 'Must be a SQLite file: URL')
      .default('file:./var/data/development.db'),
    STORAGE_ROOT: z.string().min(1).default('./var/uploads'),
    PUBLIC_ORIGIN: z
      .url()
      .refine((value) => {
        const url = URL.parse(value);

        return (
          url !== null &&
          ['http:', 'https:'].includes(url.protocol) &&
          url.pathname === '/' &&
          !url.search &&
          !url.hash &&
          !url.username &&
          !url.password
        );
      }, 'Must be an HTTP(S) origin without path or credentials')
      .default('http://localhost:4311'),
    APP_ORIGIN: origin.default('http://localhost:3100'),
    BETTER_AUTH_URL: z.url().default('http://localhost:3100/api/v1/auth'),
    BETTER_AUTH_SECRET: z.string().min(32),
    INQUIRY_RELAY_SECRET: z.string().min(32).optional(),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && !env.INQUIRY_RELAY_SECRET)
      ctx.addIssue({
        code: 'custom',
        path: ['INQUIRY_RELAY_SECRET'],
        message:
          'Production inquiry capture requires a server-only relay secret',
      });
    if (env.BETTER_AUTH_URL !== `${env.APP_ORIGIN}/api/v1/auth`)
      ctx.addIssue({
        code: 'custom',
        path: ['BETTER_AUTH_URL'],
        message: 'Must equal APP_ORIGIN/api/v1/auth',
      });
    if (env.NODE_ENV === 'production' && !env.APP_ORIGIN.startsWith('https://'))
      ctx.addIssue({
        code: 'custom',
        path: ['APP_ORIGIN'],
        message: 'Production requires HTTPS',
      });
  });

export type Env = z.infer<typeof schema>;

export function parseEnv(input: Record<string, string | undefined>): Env {
  const result = schema.safeParse(input);

  if (!result.success)
    throw new Error(
      `Invalid environment configuration: ${result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`,
    );

  return { ...result.data, STORAGE_ROOT: resolve(result.data.STORAGE_ROOT) };
}
