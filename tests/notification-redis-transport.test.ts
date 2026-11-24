import type { EventEmitter } from 'node:events';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { startRedisNotificationTransport } from '../src/modules/notifications/notifications.redis-transport.js';

type Client = EventEmitter & {
  options: Record<string, unknown>;
  status: string;
  subscribe: ReturnType<typeof vi.fn>;
  publish: ReturnType<typeof vi.fn>;
  quit: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
};
const state = vi.hoisted(() => ({
  clients: [] as Client[],
  holdSubscription: false,
}));
vi.mock('ioredis', async () => {
  const { EventEmitter } = await import('node:events');
  return {
    Redis: class extends EventEmitter {
      status = 'wait';
      subscribe = vi.fn(() =>
        state.holdSubscription
          ? new Promise<number>(() => {})
          : Promise.resolve(1),
      );
      publish = vi.fn(async () => 1);
      quit = vi.fn(async () => 'OK');
      disconnect = vi.fn(() => {
        this.status = 'end';
      });
      constructor(
        _url: string,
        public options: Record<string, unknown>,
      ) {
        super();
        state.clients.push(this as unknown as Client);
      }
      async connect() {
        this.status = 'ready';
        this.emit('ready');
      }
    },
  };
});

const config = {
  mode: 'redis' as const,
  redisUrl: 'redis://localhost:16386',
  channel: 'agency:test',
};
const origin = '075b36c0-f46c-41df-aaf0-623054ea117d';
let runtime:
  Awaited<ReturnType<typeof startRedisNotificationTransport>> | undefined;
const logSpy = () => vi.fn<(...args: unknown[]) => void>();
let logger: {
  info: ReturnType<typeof logSpy>;
  warn: ReturnType<typeof logSpy>;
};
beforeEach(() => {
  state.clients.length = 0;
  state.holdSubscription = false;
  logger = { info: logSpy(), warn: logSpy() };
});
afterEach(async () => {
  await runtime?.close();
  runtime = undefined;
  vi.useRealTimers();
});
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

it('uses dedicated connections, delivers locally once and ignores its own Redis echo', async () => {
  runtime = await startRedisNotificationTransport(config, logger);
  const [publisher, subscriber] = state.clients;
  expect(state.clients).toHaveLength(2);
  expect(publisher!.options).toMatchObject({
    enableOfflineQueue: false,
    autoResendUnfulfilledCommands: false,
    commandTimeout: 3000,
    maxRetriesPerRequest: 1,
  });
  expect(subscriber!.options.autoResubscribe).toBe(false);
  expect(subscriber!.subscribe).toHaveBeenCalledWith(config.channel);
  const agent = vi.fn();
  const other = vi.fn();
  const unsubscribe = runtime.transport.subscribe('agent', agent);
  runtime.transport.subscribe('other', other);
  await runtime.transport.publish(['agent', 'agent']);
  expect(agent).toHaveBeenCalledTimes(1);
  expect(other).not.toHaveBeenCalled();
  const envelope = publisher!.publish.mock.calls[0]![1];
  expect(JSON.parse(envelope)).toMatchObject({
    version: 1,
    recipientIds: ['agent'],
  });
  subscriber!.emit('message', config.channel, envelope);
  expect(agent).toHaveBeenCalledTimes(1);
  subscriber!.emit(
    'message',
    config.channel,
    JSON.stringify({ version: 1, origin, recipientIds: ['agent'] }),
  );
  expect(agent).toHaveBeenCalledTimes(2);
  unsubscribe();
  await runtime.transport.publish(['agent']);
  expect(agent).toHaveBeenCalledTimes(2);
});

it('bounds batches and rejects malformed, oversized, unrelated-channel and unknown-version frames', async () => {
  runtime = await startRedisNotificationTransport(config, logger);
  const [publisher, subscriber] = state.clients;
  await runtime.transport.publish(
    Array.from({ length: 101 }, (_, i) => `staff-${i}`),
  );
  expect(
    publisher!.publish.mock.calls.map(
      (call) => JSON.parse(call[1]).recipientIds.length,
    ),
  ).toEqual([100, 1]);
  const changed = vi.fn();
  runtime.transport.subscribe('agent', changed);
  const message = { version: 1, origin, recipientIds: ['agent'] };
  for (const frame of [
    'bad',
    ' '.repeat(32769),
    JSON.stringify({ ...message, version: 2 }),
    JSON.stringify({ ...message, secret: 'private' }),
    JSON.stringify({ ...message, recipientIds: ['agent', 'agent'] }),
    JSON.stringify({ ...message, recipientIds: ['x'.repeat(129)] }),
    JSON.stringify({ ...message, recipientIds: [] }),
  ])
    subscriber!.emit('message', config.channel, frame);
  subscriber!.emit('message', 'other-channel', JSON.stringify(message));
  expect(changed).not.toHaveBeenCalled();
  expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('private');
  expect(logger.warn.mock.calls.length).toBeLessThanOrEqual(1);
});

it('recovers only after current subscription acknowledgement and ignores stale restoration', async () => {
  vi.useFakeTimers();
  runtime = await startRedisNotificationTransport(config, logger);
  const subscriber = state.clients[1]!;
  const changed = vi.fn();
  runtime.transport.subscribe('agent', changed);
  let stale!: (value: number) => void;
  let current!: (value: number) => void;
  subscriber.subscribe.mockImplementationOnce(
    () =>
      new Promise<number>((resolve) => {
        stale = resolve;
      }),
  );
  subscriber.emit('close');
  subscriber.emit('ready');
  await flush();
  expect(changed).not.toHaveBeenCalled();
  subscriber.subscribe.mockImplementationOnce(
    () =>
      new Promise<number>((resolve) => {
        current = resolve;
      }),
  );
  subscriber.emit('close');
  subscriber.emit('ready');
  await flush();
  stale(1);
  await flush();
  expect(changed).not.toHaveBeenCalled();
  current(1);
  await flush();
  expect(changed).toHaveBeenCalledTimes(1);
});

it('continues locally through bounded startup and publication failure without a backlog', async () => {
  vi.useFakeTimers();
  state.holdSubscription = true;
  const starting = startRedisNotificationTransport(config, logger);
  await vi.advanceTimersByTimeAsync(3000);
  runtime = await starting;
  const [publisher, subscriber] = state.clients;
  const first = vi.fn();
  const second = vi.fn();
  runtime.transport.subscribe('agent', () => {
    first();
    throw new Error('private-error');
  });
  runtime.transport.subscribe('agent', second);
  publisher!.publish.mockRejectedValue(new Error('secret-url'));
  await runtime.transport.publish(['agent']);
  expect(first).toHaveBeenCalledTimes(1);
  expect(second).toHaveBeenCalledTimes(1);
  subscriber!.emit('close');
  subscriber!.emit('ready');
  await flush();
  expect(JSON.stringify(logger.warn.mock.calls)).not.toMatch(
    /private-error|secret-url/,
  );
});

it('retries rejected subscriptions and closes idempotently within a bounded drain', async () => {
  vi.useFakeTimers();
  runtime = await startRedisNotificationTransport(config, logger);
  const subscriber = state.clients[1]!;
  const changed = vi.fn();
  runtime.transport.subscribe('agent', changed);
  subscriber.subscribe.mockRejectedValueOnce(new Error('acl-secret'));
  subscriber.emit('close');
  subscriber.emit('ready');
  await flush();
  await vi.advanceTimersByTimeAsync(250);
  expect(changed).toHaveBeenCalledTimes(1);
  for (const client of state.clients)
    client.quit.mockImplementation(() => new Promise(() => {}));
  const closing = runtime.close();
  const again = runtime.close();
  await vi.advanceTimersByTimeAsync(3000);
  await Promise.all([closing, again]);
  for (const client of state.clients) {
    expect(client.quit).toHaveBeenCalledTimes(1);
    expect(client.disconnect).toHaveBeenCalledTimes(1);
  }
  subscriber.emit('ready');
  subscriber.emit(
    'message',
    config.channel,
    JSON.stringify({ version: 1, origin, recipientIds: ['agent'] }),
  );
  await runtime.transport.publish(['agent']);
  expect(changed).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it('stops remaining batches after the first stalled publication within one total budget', async () => {
  vi.useFakeTimers();
  runtime = await startRedisNotificationTransport(config, logger);
  const publisher = state.clients[0]!;
  publisher.publish.mockImplementation(
    () =>
      new Promise((_resolve, reject) => {
        setTimeout(() => reject(new Error('stalled-command')), 3000);
      }),
  );
  const local = vi.fn();
  runtime.transport.subscribe('staff-200', local);
  const done = vi.fn();
  const work = Promise.resolve(
    runtime.transport.publish(
      Array.from({ length: 201 }, (_, i) => `staff-${i}`),
    ),
  ).then(done);
  await vi.advanceTimersByTimeAsync(3000);
  expect(done).toHaveBeenCalledTimes(1);
  expect(local).toHaveBeenCalledTimes(1);
  expect(publisher.publish).toHaveBeenCalledTimes(1);
  await work;
});

it('shares the publication deadline across slow successful batches', async () => {
  vi.useFakeTimers();
  runtime = await startRedisNotificationTransport(config, logger);
  const publisher = state.clients[0]!;
  publisher.publish.mockImplementation(
    () =>
      new Promise((resolve) => {
        setTimeout(() => resolve(1), 2000);
      }),
  );
  const done = vi.fn();
  const work = Promise.resolve(
    runtime.transport.publish(
      Array.from({ length: 201 }, (_, i) => `staff-${i}`),
    ),
  ).then(done);
  await vi.advanceTimersByTimeAsync(3000);
  expect(done).toHaveBeenCalledTimes(1);
  expect(publisher.publish).toHaveBeenCalledTimes(2);
  await work;
});
