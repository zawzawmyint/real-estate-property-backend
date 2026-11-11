import { once } from 'node:events';
import type { Server } from 'node:http';
import request from 'supertest';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createInProcessNotificationTransport } from '../src/modules/notifications/notifications.transport.js';
import { leadFixture } from './lead-fixture.js';

const streamPath = '/api/v1/staff/notifications/stream';
const changed = 'event: notifications.changed\ndata: {}';
let f: Awaited<ReturnType<typeof leadFixture>>;
let server: Server | undefined;
let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  f = await leadFixture();
});

afterEach(async () => {
  if (server) {
    app.closeNotificationStreams();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  }
  await f?.close();
});

it('rejects an anonymous stream before opening it', async () => {
  const response = await request(f.app).get(streamPath);
  expect(response.status).toBe(401);
  expect(response.headers['cache-control']).toBe('no-store');
});

async function listen(options: NonNullable<Parameters<typeof createApp>[6]>) {
  app = createApp(
    f.env,
    f.auth,
    f.database,
    undefined,
    undefined,
    undefined,
    options,
  );
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Expected TCP address');
  return `http://127.0.0.1:${address.port}${streamPath}`;
}

async function connect(url: string, role: string) {
  const controller = new AbortController();
  const response = await fetch(url, {
    headers: { Cookie: f.cookies[role]! },
    signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
  });
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('text/event-stream');
  expect(response.headers.get('cache-control')).toBe('no-store, no-transform');
  const reader = response
    .body!.pipeThrough(new TextDecoderStream())
    .getReader();
  let pending = '';

  return {
    close: () => controller.abort(),
    async frame(): Promise<string | null> {
      while (!pending.includes('\n\n')) {
        const { value, done } = await reader.read();
        if (done) return null;
        pending += value;
      }
      const end = pending.indexOf('\n\n');
      const frame = pending.slice(0, end);
      pending = pending.slice(end + 2);
      return frame;
    },
  };
}

it('sends committed changes only to the affected recipient through an injected transport', async () => {
  const url = await listen({
    transport: createInProcessNotificationTransport(),
    heartbeatMs: 150,
  });
  const agent = await connect(url, 'agent');
  const other = await connect(url, 'other');
  expect(await agent.frame()).toBe(changed);
  expect(await other.frame()).toBe(changed);

  const response = await request(app)
    .post('/api/v1/staff/leads')
    .set('Cookie', f.cookies.manager!)
    .set('Origin', f.env.APP_ORIGIN)
    .send({
      submissionId: crypto.randomUUID(),
      name: 'Contact',
      email: 'contact@example.test',
      purpose: 'sale',
      source: 'walk_in',
      assignedAgentId: f.ids.agent,
    });
  expect(response.status).toBe(201);

  let frame = await agent.frame();
  while (frame?.startsWith(':')) frame = await agent.frame();
  expect(frame).toBe(changed);
  const inbox = await request(app)
    .get('/api/v1/staff/notifications')
    .set('Cookie', f.cookies.agent!);
  expect(inbox.body).toMatchObject({
    unreadCount: 1,
    items: [{ leadId: response.body.id }],
  });

  app.closeNotificationStreams();
  for (
    let frame = await other.frame();
    frame !== null;
    frame = await other.frame()
  )
    expect(frame).toMatch(/^:/);
});

it('unsubscribes after disconnect, revocation and shutdown, and reconnects with an initial event', async () => {
  const transport = createInProcessNotificationTransport();
  let subscribers = 0;
  const url = await listen({
    heartbeatMs: 75,
    transport: {
      publish: transport.publish,
      subscribe(id, callback) {
        const stop = transport.subscribe(id, callback);
        subscribers++;
        return () => {
          subscribers--;
          stop();
        };
      },
    },
  });
  const first = await connect(url, 'agent');
  expect(await first.frame()).toBe(changed);
  expect(await first.frame()).toMatch(/^:/);
  first.close();
  await expect.poll(() => subscribers).toBe(0);

  const reconnected = await connect(url, 'agent');
  expect(await reconnected.frame()).toBe(changed);
  await f.database.session.deleteMany({ where: { userId: f.ids.agent! } });
  let frame = await reconnected.frame();
  while (frame?.startsWith(':')) frame = await reconnected.frame();
  expect(frame).toBeNull();
  expect(subscribers).toBe(0);

  const other = await connect(url, 'other');
  expect(await other.frame()).toBe(changed);
  app.closeNotificationStreams();
  expect(await other.frame()).toBeNull();
  expect(subscribers).toBe(0);
  const rejected = await request(app)
    .get(streamPath)
    .set('Cookie', f.cookies.other!);
  expect(rejected.status).toBe(503);
});

it('keeps a committed lead and alert when the signal transport fails', async () => {
  await listen({
    transport: {
      ...createInProcessNotificationTransport(),
      publish() {
        throw new Error('Transport unavailable');
      },
    },
  });
  const response = await request(app)
    .post('/api/v1/staff/leads')
    .set('Cookie', f.cookies.manager!)
    .set('Origin', f.env.APP_ORIGIN)
    .send({
      submissionId: crypto.randomUUID(),
      name: 'Contact',
      email: 'contact@example.test',
      purpose: 'sale',
      source: 'walk_in',
      assignedAgentId: f.ids.agent,
    });
  expect(response.status).toBe(201);
  const inbox = await request(app)
    .get('/api/v1/staff/notifications')
    .set('Cookie', f.cookies.agent!);
  expect(inbox.body).toMatchObject({
    unreadCount: 1,
    items: [{ leadId: response.body.id }],
  });
});
