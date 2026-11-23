import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '../../generated/prisma/client.js';

/** The caller owns disconnecting this client during its lifecycle. */
export async function createDatabase(
  databaseUrl: string,
  options: { fileMustExist?: boolean } = {},
) {
  const file = resolve(databaseUrl.slice('file:'.length));

  if (!options.fileMustExist) await mkdir(dirname(file), { recursive: true });

  return new PrismaClient({
    adapter: new PrismaBetterSqlite3({
      url: `file:${file}`,
      fileMustExist: options.fileMustExist ?? false,
    }),
  });
}
