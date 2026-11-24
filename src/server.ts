import { verifyLeadPhoneCanonical } from './modules/leads/lead-phone-backfill.js';
import { createDatabase } from './infrastructure/database/client.js';
import { createStaffAuth } from './modules/auth/auth.js';
import { createApp } from './app.js';
import { parseEnv } from './config/env.js';
import { createLogger } from './shared/logger.js';
import { scanDueTaskReminders } from './modules/tasks/tasks.reminders.js';
import { readProducerConfig } from './modules/email/email.config.js';
import { createTaskEmailReminderScanner } from './modules/tasks/tasks.emails.js';
import { readNotificationTransportConfig } from './modules/notifications/notifications.config.js';
import { startRedisNotificationTransport } from './modules/notifications/notifications.redis-transport.js';

const env = parseEnv(process.env);
const logger = createLogger(env.LOG_LEVEL);
const database = await createDatabase(env.DATABASE_URL);
try {
  await verifyLeadPhoneCanonical(database);
} catch {
  await database.$disconnect();
  logger.fatal(
    'Lead phone identity verification failed; stop writes and run bun run db:migrate',
  );
  process.exit(1);
}
let notificationRuntime:
  Awaited<ReturnType<typeof startRedisNotificationTransport>> | undefined;
let app: ReturnType<typeof createApp>;
try {
  const auth = createStaffAuth(env, database);
  const config = readNotificationTransportConfig(process.env);
  if (config.mode === 'redis')
    notificationRuntime = await startRedisNotificationTransport(config, logger);
  app = createApp(
    env,
    auth,
    database,
    undefined,
    undefined,
    undefined,
    notificationRuntime
      ? { transport: notificationRuntime.transport }
      : undefined,
  );
} catch {
  await notificationRuntime?.close();
  await database.$disconnect();
  logger.fatal({ code: 'API_STARTUP_FAILED' }, 'API startup failed');
  process.exit(1);
}
const scanTaskEmails = createTaskEmailReminderScanner(
  database,
  readProducerConfig(env),
);
let reminderScan: Promise<void> | undefined;
let reminderTimer: ReturnType<typeof setInterval> | undefined;
let stopping = false;

function scanReminders() {
  if (stopping || reminderScan) return;

  reminderScan = Promise.allSettled([
    scanDueTaskReminders(app.notifications),
    scanTaskEmails(),
  ])
    .then((results) => {
      for (const result of results)
        if (result.status === 'rejected') throw result.reason;
    })
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

const server = app.listen(env.PORT, env.HOST, (error?: Error) => {
  // Express 5 forwards listen errors to this callback as well as the error event.
  if (error) return;
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
  shutdown('listen-error');
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
    try {
      await reminderScan;
      await notificationRuntime?.close();
      await database.$disconnect();
      if (error) process.exitCode = 1;
    } catch {
      process.exitCode = 1;
      logger.warn({ code: 'API_SHUTDOWN_FAILED' }, 'API shutdown failed');
    } finally {
      clearTimeout(timeout);
    }
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
