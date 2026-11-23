import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import type { WorkerConfig } from './email.config.js';

export const emailQueueName = 'transactional-emails';
export type EmailJobData = { notificationId: string };
export function emailConnection(config: WorkerConfig, consumer: boolean) {
  const connection = new Redis(config.redisUrl, {
    maxRetriesPerRequest: consumer ? null : 1,
    enableOfflineQueue: consumer,
    connectTimeout: 3000,
    ...(consumer ? {} : { commandTimeout: 3000 }),
    retryStrategy: (times) => Math.min(times * 250, 5000),
  });
  // Consumers of this module log allowlisted codes, never raw Redis errors/URLs.
  connection.on('error', () => undefined);
  return connection;
}
export function createEmailQueue(config: WorkerConfig) {
  const connection = emailConnection(config, false);
  const queue = new Queue<EmailJobData>(emailQueueName, {
    connection,
    prefix: config.prefix,
    defaultJobOptions: {
      attempts: 1,
      removeOnComplete: { age: 86400, count: 10_000 },
      removeOnFail: { age: 7 * 86400, count: 10_000 },
    },
  });
  queue.on('error', () => undefined);
  return { queue, connection };
}
