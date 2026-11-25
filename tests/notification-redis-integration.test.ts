import { fork, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer, connect as connectTcp, type Socket } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, expect, it } from 'vitest';
import { leadFixture } from './lead-fixture.js';
import { cleanupNotificationFixture } from './notification-fixture-cleanup.js';

const redisUrl = process.env.EMAIL_TEST_REDIS_URL ?? 'redis://127.0.0.1:6379';
const children: ChildProcess[] = [];
const streams: AbortController[] = [];
let f: Awaited<ReturnType<typeof leadFixture>> | undefined;
const disposers: (() => Promise<void>)[] = [];
afterEach(async () => {
  const fixture = f;
  f = undefined;
  await cleanupNotificationFixture({
    streams,
    children,
    disposers,
    closeFixture: async () => {
      await fixture?.close();
    },
  });
}, 45000);

async function freePort() {
  const server = createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

async function api(
  channel: string,
  connection = redisUrl,
  options: { port?: number; failure?: boolean } = {},
) {
  const port = options.port ?? (await freePort());
  let output = '';
  const child = fork(
    new URL('./notification-api-process.ts', import.meta.url),
    [],
    {
      execArgv: ['--import', 'tsx'],
      silent: true,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        PORT: String(port),
        LOG_LEVEL: 'info',
        DATABASE_URL: f!.env.DATABASE_URL,
        STORAGE_ROOT: f!.env.STORAGE_ROOT,
        BETTER_AUTH_SECRET: f!.env.BETTER_AUTH_SECRET,
        APP_ORIGIN: f!.env.APP_ORIGIN,
        BETTER_AUTH_URL: f!.env.BETTER_AUTH_URL,
        EMAIL_ENQUIRY_NOTIFICATIONS_ENABLED: 'false',
        EMAIL_STAFF_NOTIFICATIONS_ENABLED: 'false',
        EMAIL_CUSTOMER_VIEWING_NOTIFICATIONS_ENABLED: 'false',
        PUBLIC_CHAT_ENABLED: 'false',
        NOTIFICATION_SIGNAL_TRANSPORT: 'redis',
        NOTIFICATION_REDIS_CHANNEL: channel,
        REDIS_URL: connection,
      },
    },
  );
  children.push(child);
  child.stdout!.on('data', (chunk) => {
    output += String(chunk);
  });
  child.stderr!.on('data', (chunk) => {
    output += String(chunk);
  });
  await expect
    .poll(
      () =>
        (!options.failure && output.includes('API listening')) ||
        child.exitCode !== null,
      {
        timeout: 15000,
      },
    )
    .toBe(true);
  if (options.failure) expect(child.exitCode, output).toBe(1);
  else expect(child.exitCode, output).toBeNull();
  return {
    origin: `http://127.0.0.1:${port}`,
    port,
    child,
    output: () => output,
  };
}

async function stream(origin: string, role: string) {
  const controller = new AbortController();
  streams.push(controller);
  const response = await fetch(`${origin}/api/v1/staff/notifications/stream`, {
    headers: { Cookie: f!.cookies[role]! },
    signal: controller.signal,
  });
  expect(response.status).toBe(200);
  let frames = 0;
  const reading = (async () => {
    const reader = response
      .body!.pipeThrough(new TextDecoderStream())
      .getReader();
    let pending = '';
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        pending += value;
        let end: number;
        while ((end = pending.indexOf('\n\n')) !== -1) {
          if (pending.slice(0, end).includes('event: notifications.changed'))
            frames++;
          pending = pending.slice(end + 2);
        }
      }
    } catch {
      if (!controller.signal.aborted) throw new Error('STREAM_FAILED');
    }
  })();
  // Observe rejection immediately; assertions below inspect the actual signal count.
  void reading.catch(() => {});
  await expect.poll(() => frames).toBe(1);
  return () => frames;
}

async function requestApi(
  origin: string,
  path: string,
  method = 'GET',
  role = 'agent',
  body?: object,
) {
  return fetch(`${origin}/api/v1/staff/${path}`, {
    method,
    headers: {
      Cookie: f!.cookies[role]!,
      Origin: f!.env.APP_ORIGIN,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

it('delivers committed changes, read state and retirement across two API processes with recipient/channel isolation', async () => {
  f = await leadFixture({ notificationRedis: true });
  const channel = f.env.NOTIFICATION_REDIS_CHANNEL!;
  const a = await api(channel);
  const b = await api(channel);
  const isolated = await api(`${channel}-isolated`);
  const frames = await stream(b.origin, 'agent');
  const otherFrames = await stream(b.origin, 'other');
  const isolatedFrames = await stream(isolated.origin, 'agent');
  const lead = await f.create();
  const assign = await requestApi(
    a.origin,
    `leads/${lead.id}/assignment`,
    'PATCH',
    'manager',
    { expectedVersion: 1, assignedAgentId: f.ids.agent },
  );
  expect(assign.status).toBe(200);
  await expect.poll(frames).toBe(2);
  const snapshot = await (await requestApi(b.origin, 'notifications')).json();
  expect(snapshot.items).toHaveLength(1);
  expect(snapshot.unreadCount).toBe(1);
  expect(snapshot.items[0].leadId).toBe(lead.id);
  expect(
    (
      await requestApi(
        a.origin,
        `notifications/${snapshot.items[0].id}/read`,
        'PATCH',
      )
    ).status,
  ).toBe(204);
  await expect.poll(frames).toBe(3);
  expect(
    (await (await requestApi(b.origin, 'notifications')).json()).unreadCount,
  ).toBe(0);
  expect(
    (
      await requestApi(
        a.origin,
        `notifications/${snapshot.items[0].id}/read`,
        'PATCH',
        'other',
      )
    ).status,
  ).toBe(404);
  expect(
    (
      await requestApi(
        a.origin,
        `leads/${lead.id}/assignment`,
        'PATCH',
        'manager',
        { expectedVersion: 2, assignedAgentId: f.ids.other },
      )
    ).status,
  ).toBe(200);
  await expect.poll(frames).toBe(4);
  await expect.poll(otherFrames).toBe(2);
  expect(
    (await (await requestApi(b.origin, 'notifications')).json()).items,
  ).toHaveLength(0);
  expect(
    (
      await requestApi(
        a.origin,
        `leads/${lead.id}/assignment`,
        'PATCH',
        'manager',
        { expectedVersion: 1, assignedAgentId: f.ids.agent },
      )
    ).status,
  ).toBe(409);
  await delay(150);
  expect(frames()).toBe(4);
  expect(isolatedFrames()).toBe(1);
  expect(
    await f.database.notification.count({ where: { leadId: lead.id } }),
  ).toBe(2);
}, 30000);

it('starts degraded with unavailable Redis and releases clients after listen failure or shutdown', async () => {
  f = await leadFixture();
  const unused = await freePort();
  const started = Date.now();
  const a = await api(
    `notification-test-${randomUUID()}`,
    `redis://127.0.0.1:${unused}`,
  );
  expect(Date.now() - started).toBeLessThan(10000);
  expect(a.output()).toContain('NOTIFICATION_SUBSCRIPTION_UNAVAILABLE');
  const frames = await stream(a.origin, 'agent');
  const lead = await f.create();
  expect(
    (
      await requestApi(
        a.origin,
        `leads/${lead.id}/assignment`,
        'PATCH',
        'manager',
        { expectedVersion: 1, assignedAgentId: f.ids.agent },
      )
    ).status,
  ).toBe(200);
  await expect.poll(frames).toBe(2);
  const failed = await api(`notification-test-${randomUUID()}`, redisUrl, {
    port: a.port,
    failure: true,
  });
  expect(failed.output()).toContain('EADDRINUSE');
}, 30000);

it('refreshes an existing remote SSE after acknowledged Redis reconnection and keeps writes/local delivery during publication failure', async () => {
  f = await leadFixture();
  const channel = `notification-test-${randomUUID()}`;
  const upstream = new URL(redisUrl);
  let blocked = false;
  const sockets = new Set<Socket>();
  const proxy = createServer((client) => {
    if (blocked) {
      client.destroy();
      return;
    }
    const remote = connectTcp(Number(upstream.port || 6379), upstream.hostname);
    sockets.add(client);
    sockets.add(remote);
    client.on('error', () => {});
    remote.on('error', () => client.destroy());
    client.on('close', () => {
      sockets.delete(client);
      remote.destroy();
    });
    remote.on('close', () => {
      sockets.delete(remote);
      client.destroy();
    });
    client.pipe(remote).pipe(client);
  }).listen(0, '127.0.0.1');
  await once(proxy, 'listening');
  disposers.push(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => proxy.close(() => resolve()));
  });
  const proxyUrl = new URL(redisUrl);
  proxyUrl.host = `127.0.0.1:${(proxy.address() as { port: number }).port}`;
  const a = await api(channel);
  const b = await api(channel, proxyUrl.href);
  const remoteFrames = await stream(b.origin, 'agent');
  blocked = true;
  for (const socket of sockets) socket.destroy();
  await expect
    .poll(() => b.output().includes('NOTIFICATION_SUBSCRIPTION_UNAVAILABLE'))
    .toBe(true);
  const lead = await f.create();
  expect(
    (
      await requestApi(
        a.origin,
        `leads/${lead.id}/assignment`,
        'PATCH',
        'manager',
        { expectedVersion: 1, assignedAgentId: f.ids.agent },
      )
    ).status,
  ).toBe(200);
  await delay(100);
  expect(remoteFrames()).toBe(1);
  expect(
    (await (await requestApi(b.origin, 'notifications')).json()).unreadCount,
  ).toBe(1);
  const localFrames = await stream(b.origin, 'other');
  const localLead = await f.create();
  const started = Date.now();
  expect(
    (
      await requestApi(
        b.origin,
        `leads/${localLead.id}/assignment`,
        'PATCH',
        'manager',
        { expectedVersion: 1, assignedAgentId: f.ids.other },
      )
    ).status,
  ).toBe(200);
  expect(Date.now() - started).toBeLessThan(4000);
  await expect.poll(localFrames).toBe(2);
  blocked = false;
  await expect
    .poll(() => b.output().includes('NOTIFICATION_SUBSCRIPTION_RECOVERED'), {
      timeout: 10000,
    })
    .toBe(true);
  await expect.poll(remoteFrames).toBe(2);
  await expect.poll(localFrames).toBe(3);
}, 30000);
