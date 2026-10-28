import { serializedTransaction } from '../../infrastructure/database/transaction.js';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { z } from 'zod';
import type { PrismaClient } from '../../generated/prisma/client.js';
import type { StaffAuth } from './auth.js';
import { normalizeEmail, staffRoles } from './auth.js';

const staffInput = z
  .object({
    name: z.string().trim().min(1).max(200),
    email: z.string().transform(normalizeEmail).pipe(z.email().max(254)),
    role: z.enum(staffRoles),
    password: z.string().min(12).max(128),
  })
  .strict();

export function createStaffOperator(auth: StaffAuth, database: PrismaClient) {
  return {
    async create(input: z.input<typeof staffInput>, bootstrap = false) {
      const data = staffInput.parse(input);

      return serializedTransaction(database, async (tx) => {
        if (
          bootstrap &&
          (data.role !== 'admin' ||
            (await tx.user.count({ where: { role: 'admin' } })) !== 0)
        )
          throw new Error('An Admin already exists; bootstrap refused');

        // Rebind only the adapter to the transaction: library credential creation
        // and the first-Admin check must succeed or roll back as a single unit.
        const transactionalAuth = betterAuth({
          ...auth.options,
          database: prismaAdapter(tx, {
            provider: 'sqlite',
            transaction: false,
          }),
        });

        return (await transactionalAuth.api.createUser({ body: data })).user;
      });
    },

    async resetPassword(email: string, password: string) {
      z.string().min(12).max(128).parse(password);

      const user = await database.user.findUnique({
        where: { email: normalizeEmail(email) },
      });

      if (!user) throw new Error('Staff account not found');

      // Headerless Admin setUserPassword still requires an authenticated Admin.
      // Use Better Auth's configured primitive, then atomically replace/revoke.
      const hash = await (await auth.$context).password.hash(password);

      await serializedTransaction(database, async (tx) => {
        const account = await tx.account.updateMany({
          where: { userId: user.id, providerId: 'credential' },
          data: { password: hash },
        });

        if (account.count !== 1)
          throw new Error('Credential account not found');

        await tx.user.update({
          where: { id: user.id },
          data: { credentialVersion: { increment: 1 } },
        });
        await tx.session.deleteMany({ where: { userId: user.id } });
      });
    },

    async deactivate(email: string) {
      return serializedTransaction(database, async (tx) => {
        // Acquire SQLite's writer lock before eligibility reads so assignment
        // and deactivation agree across independent database clients too.
        await tx.$executeRaw`UPDATE User SET id=id WHERE email=${normalizeEmail(email)}`;
        const user = await tx.user.findUnique({
          where: { email: normalizeEmail(email) },
        });

        if (!user) throw new Error('Staff account not found');
        if (
          user.role === 'admin' &&
          !user.disabled &&
          !user.banned &&
          (await tx.user.count({
            where: {
              role: 'admin',
              disabled: false,
              OR: [{ banned: false }, { banned: null }],
            },
          })) <= 1
        )
          throw new Error('Cannot deactivate the last active Admin');

        await tx.user.update({
          where: { id: user.id },
          data: { disabled: true },
        });
        await tx.session.deleteMany({ where: { userId: user.id } });
        const assignedLeadCount = await tx.lead.count({
          where: { assignedAgentId: user.id },
        });

        return { assignedLeadCount };
      });
    },
  };
}
