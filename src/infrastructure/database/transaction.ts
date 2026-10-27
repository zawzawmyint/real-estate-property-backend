import type { PrismaClient, Prisma } from '../../generated/prisma/client.js';

export type Database = PrismaClient;
export type Transaction = Prisma.TransactionClient;

// A single Prisma SQLite adapter cannot run overlapping interactive writes.
// Serialize them per client; the transaction's first write also locks across processes.
const queues = new WeakMap<Database, Promise<unknown>>();

export async function serializedTransaction<T>(
  database: Database,
  run: (tx: Transaction) => Promise<T>,
): Promise<T> {
  const prior = queues.get(database) ?? Promise.resolve();
  const pending = prior
    .catch(() => undefined)
    .then(() =>
      database.$transaction(run, { maxWait: 10_000, timeout: 15_000 }),
    );

  queues.set(database, pending);

  try {
    return await pending;
  } finally {
    if (queues.get(database) === pending) queues.delete(database);
  }
}
