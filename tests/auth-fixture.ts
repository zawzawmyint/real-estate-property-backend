import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabase } from '../src/infrastructure/database/client.js';
import { createStaffAuth } from '../src/modules/auth/auth.js';
import { createStaffOperator } from '../src/modules/auth/staff-operator.js';
import { createApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';

export const testSecret = 'test-only-secret-for-authentication-integration';

export async function authFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'agency-auth-'));
  const env = parseEnv({
    NODE_ENV: 'test',
    INQUIRY_RELAY_SECRET: process.env.INQUIRY_RELAY_SECRET,
    LOG_LEVEL: 'silent',
    BETTER_AUTH_SECRET: testSecret,
    DATABASE_URL: `file:${join(directory, 'auth.db')}`,
    STORAGE_ROOT: join(directory, 'media'),
  });
  const database = await createDatabase(env.DATABASE_URL);
  const migrations = new URL('../prisma/migrations/', import.meta.url);

  for (const name of (await readdir(migrations, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()) {
    const migration = await readFile(
      new URL(`${name}/migration.sql`, migrations),
      'utf8',
    );

    for (const statement of migration
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean))
      await database.$executeRawUnsafe(statement);
  }

  const auth = createStaffAuth(env, database);

  return {
    directory,
    env,
    database,
    auth,
    operator: createStaffOperator(auth, database),
    app: createApp(env, auth, database),

    async close() {
      await database.$disconnect();
      await rm(directory, { recursive: true, force: true });
    },
  };
}
