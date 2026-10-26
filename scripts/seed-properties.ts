import { parseEnv } from '../src/config/env.js';
import { createDatabase } from '../src/infrastructure/database/client.js';
import { LocalStorage } from '../src/infrastructure/storage/local-storage.js';
import {
  requireDemoSeedConsent,
  seedDemoProperties,
} from '../src/modules/properties/demo-seed.js';

// Guard before parsing credentials, connecting or writing files.
requireDemoSeedConsent(
  process.argv.slice(2),
  process.env.NODE_ENV ?? 'development',
);

const env = parseEnv(process.env);
const database = await createDatabase(env.DATABASE_URL);

try {
  const result = await seedDemoProperties(
    database,
    new LocalStorage(env.STORAGE_ROOT, env.PUBLIC_ORIGIN),
  );

  console.info(
    `Demo properties: ${result.created} created, ${result.skipped} existing records preserved. Generated photos and all sample inventory are fictional.`,
  );
} finally {
  await database.$disconnect();
}
