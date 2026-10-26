import { parseEnv } from '../src/config/env.js';
import { createDatabase } from '../src/infrastructure/database/client.js';
import { verifyPropertySearch } from '../src/modules/properties/property-search.js';

const env = parseEnv(process.env);
const db = await createDatabase(env.DATABASE_URL);

try {
  const result = await db.$queryRaw<
    Array<{ connected: bigint }>
  >`SELECT 1 AS connected`;

  if (Number(result[0]?.connected) !== 1)
    throw new Error('SQLite connection check failed');

  // Verify every delivered table is accessible without disclosing record data.
  await Promise.all([
    db.user.count(),
    db.account.count(),
    db.session.count(),
    db.verification.count(),
    db.property.count(),
    db.propertyPhoto.count(),
  ]);
  await verifyPropertySearch(db);
  console.info(
    'SQLite connection, staff-authentication and property schemas verified.',
  );
} finally {
  await db.$disconnect();
}
