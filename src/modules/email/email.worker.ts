import { createServer } from 'node:http';
import { stat } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { DelayedError, Worker } from 'bullmq';
import { createDatabase } from '../../infrastructure/database/client.js';
import { createLogger } from '../../shared/logger.js';
import { readWorkerConfig, type WorkerConfig } from './email.config.js';
import { createEmailCrypto } from './email.crypto.js';
import {
  createEmailRepository,
  type EmailRepository,
} from './email.repository.js';
import { createEmailSender, type EmailSender } from './email.sender.js';
import { createEmailConsumer } from './email.consumer.js';
import {
  createEmailQueue,
  emailConnection,
  emailQueueName,
  type EmailJobData,
} from './email.queue.js';
import { createEmailDispatcher } from './email.dispatcher.js';

export async function openWorkerDatabase(url: string) {
  if (!url.startsWith('file:') || !(await stat(url.slice(5))).isFile())
    throw new Error('EMAIL_DATABASE_REQUIRED');
  const database = await createDatabase(url, { fileMustExist: true });
  try {
    await database.emailNotification.findFirst({
      select: {
        recipientUserId: true,
        viewingId: true,
        taskId: true,
        sourceVersion: true,
        scheduledStartsAt: true,
        scheduledEndsAt: true,
      },
    });
  } catch {
    await database.$disconnect();
    throw new Error('EMAIL_DATABASE_MIGRATION_REQUIRED');
  }
  return database;
}
async function bounded(work: Promise<unknown>, timeout: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work.then(() => true),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), timeout);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
export async function startEmailRuntime(input: {
  config: WorkerConfig;
  repository: EmailRepository;
  sender: EmailSender;
  healthPort?: number;
  observe?: (code: string, id?: string) => void;
}) {
  const { config, repository: repo, sender } = input;
  const observe = input.observe ?? (() => undefined);
  const keys = Object.keys(config.keys);
  const { queue, connection } = createEmailQueue(config);
  const consumerConnection = emailConnection(config, true);
  const consume = createEmailConsumer({
    repository: repo,
    sender,
    keyIds: keys,
    observe,
  });
  const dispatchEmails = createEmailDispatcher(repo, queue, keys, observe);
  let stopped = false,
    ticking = false,
    lastProgress = 0,
    keysReady = false,
    publicationReady = true;
  const dispatch = async (forceReconcile = false) => {
    const result = await dispatchEmails(forceReconcile);
    if (result.publication === 'failed') publicationReady = false;
    else if (result.publication === 'published') publicationReady = true;
    return result;
  };
  let tickWork: Promise<void> = Promise.resolve();
  const sends = new Set<Promise<void>>();
  const worker = new Worker<EmailJobData>(
    emailQueueName,
    (job, token) => {
      if (stopped) return Promise.resolve();
      const work = (async () => {
        if (
          !job.data ||
          Object.keys(job.data).length !== 1 ||
          typeof job.data.notificationId !== 'string'
        )
          return;
        await consume(job.data.notificationId);
        if (stopped) return;
        const row = await repo.get(job.data.notificationId);
        if (
          row &&
          ['PENDING', 'ENQUEUED'].includes(row.status) &&
          row.payloadKeyId &&
          keys.includes(row.payloadKeyId)
        ) {
          await job.moveToDelayed(
            Math.max(row.nextAttemptAt.getTime(), Date.now() + 1000),
            token,
          );
          throw new DelayedError();
        }
      })();
      sends.add(work);
      void work.finally(() => sends.delete(work)).catch(() => undefined);
      return work;
    },
    {
      connection: consumerConnection,
      prefix: config.prefix,
      concurrency: config.concurrency,
      limiter: { max: config.rateMax, duration: config.rateDuration },
    },
  );
  worker.on('error', () => observe('EMAIL_WORKER_ERROR'));
  worker.on('failed', () => observe('EMAIL_JOB_FAILED'));
  const readiness = async () =>
    !stopped &&
    keysReady &&
    publicationReady &&
    Date.now() - lastProgress < 30_000 &&
    connection.status === 'ready' &&
    consumerConnection.status === 'ready' &&
    worker.isRunning() &&
    !worker.isPaused();
  const health = createServer((req, res) => {
    void (async () => {
      const known = req.url === '/health' || req.url === '/ready';
      const ok = req.url === '/health' ? !stopped : await readiness();
      res.writeHead(!known ? 404 : ok ? 200 : 503, {
        'content-type': 'application/json',
      });
      res.end(
        JSON.stringify({
          status: !known ? 'unknown' : ok ? 'ok' : 'unavailable',
        }),
      );
    })().catch(() => {
      res.writeHead(503);
      res.end();
    });
  });
  const tick = async () => {
    if (stopped || ticking) return;
    ticking = true;
    try {
      await repo.maintain(Date.now());
      if (stopped) return;
      keysReady = !(await repo.hasMissingKeys(keys));
      if (stopped) return;
      const result = await dispatch();
      lastProgress = publicationReady && result.healthy ? Date.now() : 0;
    } catch {
      lastProgress = 0;
      observe('EMAIL_MAINTENANCE_FAILED');
    } finally {
      ticking = false;
    }
  };
  let timer: ReturnType<typeof setInterval> | undefined;
  let closing: Promise<void> | undefined;
  const close = () =>
    (closing ??= (async () => {
      stopped = true;
      clearInterval(timer);
      health.close();
      await worker.pause(true);
      const drain = Promise.allSettled([...sends, tickWork]);
      if (!(await bounded(drain, 35_000))) {
        sender.close();
        await bounded(Promise.allSettled([...sends]), 1000);
      }
      sender.close();
      await bounded(worker.close(true), 1000);
      await bounded(queue.close(), 1000);
      consumerConnection.disconnect();
      connection.disconnect();
    })());
  try {
    await repo.maintain(Date.now());
    if (
      !(await bounded(
        Promise.all([worker.waitUntilReady(), queue.waitUntilReady()]),
        10_000,
      ))
    )
      throw new Error('EMAIL_REDIS_START_TIMEOUT');
    await new Promise<void>((resolve, reject) => {
      health.once('error', reject);
      health.listen(
        input.healthPort ?? config.healthPort,
        '127.0.0.1',
        resolve,
      );
    });
    tickWork = tick();
    await tickWork;
    timer = setInterval(() => {
      if (!stopped && !ticking) tickWork = tick();
    }, 1000);
    return {
      worker,
      queue,
      dispatch,
      readiness,
      close,
      address: health.address(),
    };
  } catch (error) {
    await close();
    throw error;
  }
}

async function main() {
  const config = readWorkerConfig(process.env);
  const logger = createLogger('info');
  const database = await openWorkerDatabase(config.databaseUrl);
  try {
    const crypto = createEmailCrypto(config);
    const runtime = await startEmailRuntime({
      config,
      repository: createEmailRepository(database, crypto, config),
      sender: createEmailSender(config.smtp),
      observe: (code, id) =>
        logger.info({ code, notificationId: id }, 'Email worker event'),
    });
    let stopping = false;
    const shutdown = () => {
      if (stopping) return;
      stopping = true;
      void runtime
        .close()
        .finally(() => database.$disconnect())
        .catch(() => {
          process.exitCode = 1;
        });
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
    logger.info('Email worker started');
  } catch {
    await database.$disconnect();
    throw new Error('EMAIL_WORKER_START_FAILED');
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  void main().catch(() => {
    console.error('EMAIL_WORKER_START_FAILED');
    process.exitCode = 1;
  });
}
