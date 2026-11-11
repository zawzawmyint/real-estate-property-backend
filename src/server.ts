import { createDatabase } from './infrastructure/database/client.js';
import { createStaffAuth } from './modules/auth/auth.js';
import { createApp } from './app.js';
import { parseEnv } from './config/env.js';
import { createLogger } from './shared/logger.js';
import { scanDueTaskReminders } from './modules/tasks/tasks.reminders.js';

const env = parseEnv(process.env);
const logger = createLogger(env.LOG_LEVEL);
const database = await createDatabase(env.DATABASE_URL);
const auth = createStaffAuth(env, database);
const app = createApp(env, auth, database);
let reminderScan: Promise<void> | undefined;
let reminderTimer: ReturnType<typeof setInterval> | undefined;
let stopping = false;

function scanReminders() {
  if (stopping || reminderScan) return;

  reminderScan = scanDueTaskReminders(app.notifications)
    .catch((error: unknown) => {
      logger.warn(
        { errorType: error instanceof Error ? error.name : typeof error },
        'Task reminder scan failed',
      );
    })
    .finally(() => {
      reminderScan = undefined;
    });
}

const server = app.listen(env.PORT, env.HOST, () => {
  logger.info({ host: env.HOST, port: env.PORT }, 'API listening');
  scanReminders();
  reminderTimer = setInterval(scanReminders, 60_000);
  reminderTimer.unref();
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

function shutdown(signal: string) {
  if (stopping) return;

  stopping = true;
  logger.info({ signal }, 'Stopping API');
  clearInterval(reminderTimer);
  app.closeNotificationStreams();

  const timeout = setTimeout(() => {
    server.closeAllConnections();
    process.exitCode = 1;
  }, 10_000);

  timeout.unref();
  server.close(async (error) => {
    await reminderScan;
    await database.$disconnect();
    clearTimeout(timeout);

    if (error) process.exitCode = 1;
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
