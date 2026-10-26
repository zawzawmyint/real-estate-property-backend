import { createDatabase } from './infrastructure/database/client.js';
import { createStaffAuth } from './modules/auth/auth.js';
import { createApp } from './app.js';
import { parseEnv } from './config/env.js';
import { createLogger } from './shared/logger.js';

const env = parseEnv(process.env);
const logger = createLogger(env.LOG_LEVEL);
const database = await createDatabase(env.DATABASE_URL);
const auth = createStaffAuth(env, database);
const server = createApp(env, auth, database).listen(env.PORT, env.HOST, () => {
  logger.info({ host: env.HOST, port: env.PORT }, 'API listening');
});

server.requestTimeout = 30_000;
server.headersTimeout = 15_000;
server.on('error', (error) => {
  logger.fatal(
    { errorType: error.name, code: 'code' in error ? error.code : undefined },
    'Server could not start',
  );
  process.exitCode = 1;
});

let stopping = false;

function shutdown(signal: string) {
  if (stopping) return;

  stopping = true;
  logger.info({ signal }, 'Stopping API');

  const timeout = setTimeout(() => {
    server.closeAllConnections();
    process.exitCode = 1;
  }, 10_000);

  timeout.unref();
  server.close(async (error) => {
    clearTimeout(timeout);
    await database.$disconnect();

    if (error) process.exitCode = 1;
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
