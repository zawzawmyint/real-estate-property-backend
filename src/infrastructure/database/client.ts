import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '../../generated/prisma/client.js';

/** The caller owns disconnecting this client during its lifecycle. */
export async function createDatabase(databaseUrl: string) {
  const file = resolve(databaseUrl.slice('file:'.length));

  await mkdir(dirname(file), { recursive: true });

  return new PrismaClient({
    adapter: new PrismaBetterSqlite3({ url: `file:${file}` }),
  });
}
