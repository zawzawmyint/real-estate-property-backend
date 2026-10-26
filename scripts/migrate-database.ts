import { backfillLeadSearch } from '../src/modules/leads/lead-search.js';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { parseEnv } from '../src/config/env.js';
import { createDatabase } from '../src/infrastructure/database/client.js';
import { backfillPropertySearch } from '../src/modules/properties/property-search.js';

const env = parseEnv(process.env);
const databaseUrl = `file:${resolve(env.DATABASE_URL.slice('file:'.length)).replaceAll('\\', '/')}`;

// On Windows the schema engine cannot reliably create a missing SQLite file.
// The existing adapter initializes it; Prisma still owns every schema migration.
const database = await createDatabase(databaseUrl);

try {
  await database.$queryRaw`SELECT 1`;
} finally {
  await database.$disconnect();
}

const result = spawnSync(
  process.execPath,
  [
    resolve(import.meta.dirname, '../node_modules/prisma/build/index.js'),
    'migrate',
    'deploy',
  ],
  {
    cwd: resolve(import.meta.dirname, '..'),
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'inherit',
  },
);

if (result.error) throw result.error;

process.exitCode = result.status ?? 1;

if (process.exitCode === 0) {
  const migrated = await createDatabase(databaseUrl);
  try {
    await backfillPropertySearch(migrated);
    await backfillLeadSearch(migrated);
    console.info('Property search data verified and backfilled.');
  } finally {
    await migrated.$disconnect();
  }
}
