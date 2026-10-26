import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { admin } from 'better-auth/plugins';
import { adminAc, userAc } from 'better-auth/plugins/admin/access';
import { deleteSessionCookie } from 'better-auth/cookies';
import { z } from 'zod';
import type { Env } from '../../config/env.js';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { LoginLimiter } from './login-limiter.js';

export const staffRoles = ['admin', 'manager', 'agent'] as const;

export type StaffRole = (typeof staffRoles)[number];

export const isStaffRole = (value: unknown): value is StaffRole =>
  staffRoles.some((role) => role === value);
export const normalizeEmail = (value: string) => value.trim().toLowerCase();
const loginSchema = z
  .object({
    email: z.string().transform(normalizeEmail).pipe(z.email().max(254)),
    password: z.string().min(1).max(128),
    rememberMe: z.literal(true),
  })
  .strict();
const credentialsError = () =>
  new APIError('UNAUTHORIZED', {
    code: 'INVALID_EMAIL_OR_PASSWORD',
    message: 'Invalid email or password',
  });

type CredentialContext = {
  agencyCredentialSnapshot?: { userId: string; version: number };
};

export function createStaffAuth(
  env: Env,
  database: PrismaClient,
  limiter = new LoginLimiter(),
) {
  return betterAuth({
    appName: 'Agency CRM',
    baseURL: env.BETTER_AUTH_URL,
    basePath: '/api/v1/auth',
    secret: env.BETTER_AUTH_SECRET,
    database: prismaAdapter(database, {
      provider: 'sqlite',
      transaction: true,
    }),
    trustedOrigins: [env.APP_ORIGIN],
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
    },
    session: {
      expiresIn: 28_800,
      disableSessionRefresh: true,
      cookieCache: { enabled: false },
      additionalFields: {
        credentialVersion: {
          type: 'number',
          defaultValue: 0,
          input: false,
          returned: false,
        },
      },
    },
    user: {
      additionalFields: {
        searchName: {
          type: 'string',
          defaultValue: '',
          input: false,
          returned: false,
        },
        credentialVersion: {
          type: 'number',
          defaultValue: 0,
          input: false,
          returned: false,
        },
        disabled: {
          type: 'boolean',
          defaultValue: false,
          input: false,
          returned: false,
        },
      },
    },
    plugins: [
      admin({
        defaultRole: 'agent',
        adminRoles: ['admin'],
        roles: { admin: adminAc, manager: userAc, agent: userAc },
      }),
    ],
    advanced: {
      useSecureCookies: false,
      cookies: {
        session_token: {
          name:
            env.NODE_ENV === 'production'
              ? '__Host-agency.session'
              : 'agency.session',
          attributes: {
            secure: env.NODE_ENV === 'production',
            httpOnly: true,
            sameSite: 'lax',
            path: '/',
          },
        },
      },
    },
    rateLimit: { enabled: false },
    logger: { disabled: true },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => ({
            data: {
              ...user,
              searchName: user.name.normalize('NFC').toLowerCase(),
            },
          }),
        },
        update: {
          before: async (user) => ({
            data: {
              ...user,
              ...(user.name !== undefined
                ? { searchName: user.name.normalize('NFC').toLowerCase() }
                : {}),
            },
          }),
        },
      },
      session: {
        create: {
          before: async (session, ctx) => {
            const user = await database.user.findUnique({
              where: { id: session.userId },
            });
            const snapshot = (ctx as CredentialContext | null)
              ?.agencyCredentialSnapshot;

            if (
              !user ||
              user.disabled ||
              user.banned ||
              !isStaffRole(user.role) ||
              !snapshot ||
              snapshot.userId !== user.id ||
              snapshot.version !== user.credentialVersion
            )
              throw credentialsError();

            return {
              data: { ...session, credentialVersion: snapshot.version },
            };
          },
        },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== '/sign-in/email') return;

        const parsed = loginSchema.safeParse(ctx.body);

        if (!parsed.success)
          throw new APIError('BAD_REQUEST', {
            code: 'INVALID_INPUT',
            message: 'Invalid sign-in input',
          });

        limiter.consume(parsed.data.email);

        // Capture before Better Auth reads/verifies the credential. A reset after
        // this read invalidates this generation even if verification was in flight.
        const user = await database.user.findUnique({
          where: { email: parsed.data.email },
          select: { id: true, credentialVersion: true },
        });

        return {
          context: {
            body: parsed.data,
            agencyCredentialSnapshot: user
              ? { userId: user.id, version: user.credentialVersion }
              : undefined,
          },
        };
      }),
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path === '/sign-in/email' && ctx.context.newSession) {
          const issued = await database.session.findUnique({
            where: { id: ctx.context.newSession.session.id },
            include: { user: true },
          });

          if (
            !issued ||
            issued.credentialVersion !== issued.user.credentialVersion ||
            issued.user.disabled ||
            issued.user.banned ||
            !isStaffRole(issued.user.role)
          ) {
            if (issued)
              await database.session.deleteMany({ where: { id: issued.id } });

            deleteSessionCookie(ctx);

            throw credentialsError();
          }
        }
        if (ctx.path === '/get-session') {
          const session = ctx.context.session;

          if (session) {
            const persisted = await database.session.findUnique({
              where: { id: session.session.id },
              include: { user: true },
            });
            const user = persisted?.user;

            if (
              !user ||
              user.disabled ||
              user.banned ||
              !isStaffRole(user.role) ||
              !persisted ||
              persisted.credentialVersion !== user.credentialVersion
            )
              return ctx.json(null);
          }
        }
      }),
    },
    onAPIError: { throw: false },
  });
}

export type StaffAuth = ReturnType<typeof createStaffAuth>;
