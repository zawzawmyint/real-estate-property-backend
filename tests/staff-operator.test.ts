import { describe, expect, it } from 'vitest';
import { authFixture } from './auth-fixture.js';
import { createStaffAuth } from '../src/modules/auth/auth.js';
import { createStaffOperator } from '../src/modules/auth/staff-operator.js';
import { createDatabase } from '../src/infrastructure/database/client.js';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { betterAuth } from 'better-auth';

describe('trusted operator atomic lifecycle', () => {
  it('does not leave partial accounts after a credential operation fails', async () => {
    const f = await authFixture();

    try {
      const auth = createStaffAuth(f.env, f.database);
      const broken = betterAuth({
        ...auth.options,
        database: prismaAdapter(f.database, {
          provider: 'sqlite',
          transaction: true,
        }),
        emailAndPassword: {
          ...auth.options.emailAndPassword,
          password: {
            hash: async () => {
              throw new Error('hash failure');
            },
            verify: async () => false,
          },
        },
      });
      const operator = createStaffOperator(
        broken as unknown as typeof auth,
        f.database,
      );

      await expect(
        operator.create(
          {
            name: 'Admin',
            email: 'partial@example.test',
            role: 'admin',
            password: 'Test-password-123!',
          },
          true,
        ),
      ).rejects.toThrow();
      expect(await f.database.user.count()).toBe(0);
    } finally {
      await f.close();
    }
  });
  it('refuses conflicting concurrent bootstraps', async () => {
    const f = await authFixture();

    try {
      const secondDatabase = await createDatabase(f.env.DATABASE_URL);
      const secondOperator = createStaffOperator(
        createStaffAuth(f.env, secondDatabase),
        secondDatabase,
      );
      const create = (email: string) =>
        f.operator.create(
          {
            name: 'Admin',
            email,
            role: 'admin',
            password: 'Test-password-123!',
          },
          true,
        );
      const results = await Promise.allSettled([
        create('one@example.test'),
        secondOperator.create(
          {
            name: 'Second',
            email: 'two@example.test',
            role: 'admin',
            password: 'Test-password-123!',
          },
          true,
        ),
      ]);

      expect(
        results.filter((result) => result.status === 'fulfilled'),
      ).toHaveLength(1);
      expect(await f.database.user.count({ where: { role: 'admin' } })).toBe(1);
      await secondDatabase.$disconnect();
    } finally {
      await f.close();
    }
  });
});
