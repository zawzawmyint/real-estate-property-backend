import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { z } from 'zod';
import type { createLogger } from '../../shared/logger.js';
import type { NotificationTransportConfig } from './notifications.config.js';
import {
  createInProcessNotificationTransport,
  type NotificationSignalTransport,
} from './notifications.transport.js';

const timeoutMs = 3000;
const maxFrameBytes = 32 * 1024;
const recipient = z.string().min(1).max(128);
const envelope = z.strictObject({
  version: z.literal(1),
  origin: z.uuid(),
  recipientIds: z
    .array(recipient)
    .min(1)
    .max(100)
    .refine((ids) => new Set(ids).size === ids.length),
});

export async function startRedisNotificationTransport(
  config: Extract<NotificationTransportConfig, { mode: 'redis' }>,
  logger: Pick<ReturnType<typeof createLogger>, 'warn' | 'info'>,
): Promise<{ transport: NotificationSignalTransport; close(): Promise<void> }> {
  const origin = randomUUID();
  const local = createInProcessNotificationTransport();
  const subscriptions = new Map<() => void, string>();
  let stopped = false;
  let generation = 0;
  let restoring: number | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let delay = 250;
  let subscriptionFailed = false;
  let publicationFailed = false;
  let lastInvalidWarning = -Infinity;
  let closing: Promise<void> | undefined;
  let settleStartup!: () => void;
  const startup = new Promise<void>((resolve) => {
    settleStartup = resolve;
  });
  const startupTimer = setTimeout(() => {
    warnSubscription();
    settleStartup();
  }, timeoutMs);
  const options = {
    lazyConnect: true,
    enableOfflineQueue: false,
    autoResendUnfulfilledCommands: false,
    autoResubscribe: false,
    connectTimeout: timeoutMs,
    commandTimeout: timeoutMs,
    maxRetriesPerRequest: 1,
    retryStrategy: (times: number) => Math.min(times * 250, 5000),
    tls: config.redisUrl.startsWith('rediss:')
      ? { rejectUnauthorized: true }
      : undefined,
  };
  const publisher = new Redis(config.redisUrl, options);
  const subscriber = new Redis(config.redisUrl, options);

  function warnSubscription() {
    if (stopped || subscriptionFailed) return;
    subscriptionFailed = true;
    logger.warn(
      { code: 'NOTIFICATION_SUBSCRIPTION_UNAVAILABLE' },
      'Notification signals degraded',
    );
  }

  function changed(ids: readonly string[]) {
    if (!stopped) local.publish(ids);
  }

  function disconnected() {
    if (stopped) return;
    generation++;
    clearTimeout(retry);
    warnSubscription();
  }

  function restore() {
    const current = generation;
    if (stopped || subscriber.status !== 'ready' || restoring === current)
      return;
    restoring = current;
    void subscriber
      .subscribe(config.channel)
      .then(() => {
        if (stopped || current !== generation || subscriber.status !== 'ready')
          return;
        clearTimeout(startupTimer);
        delay = 250;
        if (subscriptionFailed)
          logger.info(
            { code: 'NOTIFICATION_SUBSCRIPTION_RECOVERED' },
            'Notification signals recovered',
          );
        subscriptionFailed = false;
        settleStartup();
        changed([...new Set(subscriptions.values())]);
      })
      .catch(() => {
        if (stopped || current !== generation) return;
        warnSubscription();
        retry = setTimeout(restore, delay);
        retry.unref();
        delay = Math.min(delay * 2, 5000);
      })
      .finally(() => {
        if (restoring === current) restoring = undefined;
      });
  }

  function received(channel: string, message: string) {
    if (stopped || channel !== config.channel) return;
    try {
      if (Buffer.byteLength(message) > maxFrameBytes) throw new Error();
      const parsed = envelope.parse(JSON.parse(message));
      if (parsed.origin !== origin) changed(parsed.recipientIds);
    } catch {
      if (Date.now() - lastInvalidWarning < 30_000) return;
      lastInvalidWarning = Date.now();
      logger.warn(
        { code: 'NOTIFICATION_SIGNAL_INVALID' },
        'Ignored invalid notification signal',
      );
    }
  }

  function publisherError() {
    if (stopped || publicationFailed) return;
    publicationFailed = true;
    logger.warn(
      { code: 'NOTIFICATION_PUBLICATION_UNAVAILABLE' },
      'Notification publication unavailable',
    );
  }

  subscriber.on('ready', restore);
  subscriber.on('close', disconnected);
  subscriber.on('error', warnSubscription);
  subscriber.on('message', received);
  publisher.on('error', publisherError);
  void subscriber.connect().catch(warnSubscription);
  void publisher.connect().catch(publisherError);

  const transport: NotificationSignalTransport = {
    subscribe(id, callback) {
      if (stopped) return () => {};
      const remove = local.subscribe(id, () => {
        try {
          callback();
        } catch {
          logger.warn(
            { code: 'NOTIFICATION_LISTENER_FAILED' },
            'Notification listener failed',
          );
        }
      });
      const unsubscribe = () => {
        remove();
        subscriptions.delete(unsubscribe);
      };
      subscriptions.set(unsubscribe, id);
      return unsubscribe;
    },
    async publish(ids) {
      if (stopped) return;
      const unique = [...new Set(ids)];
      if (!unique.every((id) => recipient.safeParse(id).success))
        throw new Error('NOTIFICATION_RECIPIENT_INVALID');
      changed(unique);
      const frame = (recipientIds: string[]) =>
        JSON.stringify({ version: 1, origin, recipientIds });
      const batches: string[][] = [];
      let batch: string[] = [];
      for (const id of unique) {
        if (
          batch.length === 100 ||
          Buffer.byteLength(frame([...batch, id])) > maxFrameBytes
        ) {
          batches.push(batch);
          batch = [];
        }
        batch.push(id);
      }
      if (batch.length) batches.push(batch);
      const deadline = Date.now() + timeoutMs;
      for (const group of batches) {
        if (stopped) return;
        const remaining = deadline - Date.now();
        if (remaining <= 0) {
          publisherError();
          return;
        }
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            publisher.publish(config.channel, frame(group)),
            new Promise<never>((_resolve, reject) => {
              timer = setTimeout(
                () => reject(new Error('NOTIFICATION_PUBLICATION_TIMEOUT')),
                remaining,
              );
            }),
          ]);
          if (!stopped && publicationFailed) {
            publicationFailed = false;
            logger.info(
              { code: 'NOTIFICATION_PUBLICATION_RECOVERED' },
              'Notification publication recovered',
            );
          }
        } catch {
          publisherError();
          return;
        } finally {
          clearTimeout(timer);
        }
      }
    },
  };

  await startup;
  return {
    transport,
    close() {
      if (closing) return closing;
      stopped = true;
      generation++;
      clearTimeout(startupTimer);
      clearTimeout(retry);
      for (const unsubscribe of [...subscriptions.keys()]) unsubscribe();
      subscriber.off('ready', restore);
      subscriber.off('close', disconnected);
      subscriber.off('message', received);
      closing = (async () => {
        let deadline: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            Promise.allSettled([publisher.quit(), subscriber.quit()]),
            new Promise<void>((resolve) => {
              deadline = setTimeout(resolve, timeoutMs);
            }),
          ]);
        } finally {
          clearTimeout(deadline);
          publisher.disconnect();
          subscriber.disconnect();
        }
      })();
      return closing;
    },
  };
}
