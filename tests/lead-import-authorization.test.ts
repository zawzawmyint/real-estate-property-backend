import request from 'supertest';
import { request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { afterAll, expect, it } from 'vitest';
import { createLeadImportService } from '../src/modules/leads/lead-import.service.js';
import type { Actor } from '../src/modules/leads/leads.repository.js';
import { leadFixture } from './lead-fixture.js';
const fixture = await leadFixture();
afterAll(() => fixture.close());
const base = '/api/v1/staff/leads/imports';
const post = (path: string, body: object, role = 'manager') =>
  request(fixture.app)
    .post(`${base}/${path}`)
    .set('Cookie', fixture.cookies[role]!)
    .set('Origin', fixture.env.APP_ORIGIN)
    .send(body);
it('denies agents and requires the exact schema, Origin and content type', async () => {
  expect(
    (
      await post(
        'preview',
        { csv: 'name,email,purpose,source\nOne,a@example.test,sale,call' },
        'agent',
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await post('preview', {
        csv: 'name,email,purpose,source\nOne,a@example.test,sale,call',
        extra: 1,
      })
    ).status,
  ).toBe(400);
  const template = await request(fixture.app)
    .get(`${base}/template`)
    .set('Cookie', fixture.cookies.manager!);
  expect(template.status).toBe(200);
  expect(template.text).toBe(
    '\ufeffname,phone,email,purpose,budget_aed,source\r\n',
  );
  expect(template.headers['cache-control']).toBe('no-store');
  expect(template.headers['x-content-type-options']).toBe('nosniff');
  expect(template.headers['content-disposition']).toContain(
    'lead-import-template.csv',
  );
});

it('guards every import route and requires trusted Origin and JSON for manager POSTs', async () => {
  for (const role of ['agent', undefined]) {
    const expected = role ? 403 : 401;
    let template = request(fixture.app).get(`${base}/template`);
    if (role) template = template.set('Cookie', fixture.cookies[role]!);
    const response = await template;
    expect(response.status).toBe(expected);
    expect(response.headers['cache-control']).toBe('no-store');
    for (const path of ['preview', 'commit']) {
      let req = request(fixture.app)
        .post(`${base}/${path}`)
        .set('Origin', fixture.env.APP_ORIGIN);
      if (role) req = req.set('Cookie', fixture.cookies[role]!);
      expect((await req.send({})).status).toBe(expected);
    }
  }
  for (const origin of [undefined, 'https://untrusted.example.test']) {
    let req = request(fixture.app)
      .post(`${base}/preview`)
      .set('Cookie', fixture.cookies.manager!);
    if (origin) req = req.set('Origin', origin);
    expect(
      (
        await req.send({
          csv: 'name,email,purpose,source\nOne,a@example.test,sale,call',
        })
      ).status,
    ).toBe(403);
  }
  expect(
    (
      await request(fixture.app)
        .post(`${base}/preview`)
        .set('Cookie', fixture.cookies.manager!)
        .set('Origin', fixture.env.APP_ORIGIN)
        .set('Content-Type', 'text/plain')
        .send('text')
    ).status,
  ).toBe(415);
});

it('rejects malformed UTF-8 transport before replacement decoding', async () => {
  const bytes = Buffer.concat([
    Buffer.from('{"csv":"name,email,purpose,source\\n'),
    Buffer.from([0xc3, 0x28]),
    Buffer.from(',a@example.test,sale,call"}'),
  ]);
  const response = await request(fixture.app)
    .post(`${base}/preview`)
    .set('Cookie', fixture.cookies.manager!)
    .set('Origin', fixture.env.APP_ORIGIN)
    .set('Content-Type', 'application/json')
    .serialize(() => bytes as unknown as string)
    .send({});
  expect(response.status, JSON.stringify(response.body)).toBe(400);
  expect(response.body.error.code).toBe('IMPORT_INVALID_CSV');
});

it('enforces transport limits after role guards, and refuses unsupported charset', async () => {
  const csv = 'x'.repeat(6 * 1024 * 1024);
  expect((await post('preview', { csv })).status).toBe(413);
  const response = await request(fixture.app)
    .post(`${base}/preview`)
    .set('Cookie', fixture.cookies.manager!)
    .set('Origin', fixture.env.APP_ORIGIN)
    .set('Content-Type', 'application/json; charset=utf-16le')
    .send('{}');
  expect(response.status).toBe(415);
});

it('denies Agent headers without waiting for or consuming an upload body', async () => {
  const server = fixture.app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('Missing address');
    const status = await new Promise<number>((resolve, reject) => {
      const req = httpRequest(
        {
          host: '127.0.0.1',
          port: address.port,
          path: `${base}/preview`,
          method: 'POST',
          agent: false,
          headers: {
            Cookie: fixture.cookies.agent!,
            Origin: fixture.env.APP_ORIGIN,
            'Content-Type': 'application/json',
            'Content-Length': 7 * 1024 * 1024,
            Connection: 'close',
          },
        },
        (res) => {
          res.resume();
          res.on('end', () => {
            req.end();
            resolve(res.statusCode!);
          });
        },
      );
      req.on('error', reject);
      req.flushHeaders();
    });
    expect(status).toBe(403);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

it('validates live service identity on replay after demotion', async () => {
  const session = await fixture.database.session.findFirstOrThrow({
    where: { userId: fixture.ids.manager! },
  });
  const actor: Actor = {
    id: fixture.ids.manager!,
    name: 'manager',
    role: 'manager',
    sessionId: session.id,
  };
  const service = createLeadImportService(fixture.database);
  const csv = 'name,email,purpose,source\nLive,a@example.test,sale,call';
  const preview = await service.preview(csv, actor);
  const payload = {
    csv,
    submissionId: randomUUID(),
    schemaVersion: 1,
    digest: preview.digest,
  };
  await service.commit(payload, actor);
  await fixture.database.user.update({
    where: { id: actor.id },
    data: { role: 'agent' },
  });
  try {
    await expect(service.commit(payload, actor)).rejects.toMatchObject({
      status: 403,
    });
    await expect(service.preview(csv, actor)).rejects.toMatchObject({
      status: 403,
    });
    await expect(service.template(actor)).rejects.toMatchObject({
      status: 403,
    });
  } finally {
    await fixture.database.user.update({
      where: { id: actor.id },
      data: { role: 'manager' },
    });
  }
});

it.each([
  'expired',
  'revoked',
  'disabled',
  'banned',
  'credential-invalid',
] as const)('rejects stale service identity: %s', async (state) => {
  const user = await fixture.database.user.findUniqueOrThrow({
    where: { id: fixture.ids.manager! },
  });
  const session = await fixture.database.session.findFirstOrThrow({
    where: { userId: user.id },
  });
  const actor: Actor = {
    id: user.id,
    name: user.name,
    role: 'manager',
    sessionId: session.id,
  };
  const service = createLeadImportService(fixture.database);
  const csv = 'name,email,purpose,source\nLive,a@example.test,sale,call';
  const preview = await service.preview(csv, actor);
  const payload = {
    csv,
    submissionId: randomUUID(),
    schemaVersion: 1,
    digest: preview.digest,
  };
  await service.commit(payload, actor);
  if (state === 'expired')
    await fixture.database.session.update({
      where: { id: session.id },
      data: { expiresAt: new Date(0) },
    });
  if (state === 'revoked')
    await fixture.database.session.delete({ where: { id: session.id } });
  if (state === 'disabled')
    await fixture.database.user.update({
      where: { id: user.id },
      data: { disabled: true },
    });
  if (state === 'banned')
    await fixture.database.user.update({
      where: { id: user.id },
      data: { banned: true },
    });
  if (state === 'credential-invalid')
    await fixture.database.user.update({
      where: { id: user.id },
      data: { credentialVersion: user.credentialVersion + 1 },
    });
  try {
    await expect(service.commit(payload, actor)).rejects.toMatchObject({
      status: 401,
    });
    await expect(service.preview(csv, actor)).rejects.toMatchObject({
      status: 401,
    });
    await expect(service.template(actor)).rejects.toMatchObject({
      status: 401,
    });
  } finally {
    await fixture.database.user.update({
      where: { id: user.id },
      data: {
        disabled: user.disabled,
        banned: user.banned,
        credentialVersion: user.credentialVersion,
      },
    });
    if (state === 'revoked')
      await fixture.database.session.create({ data: session });
    else
      await fixture.database.session.update({
        where: { id: session.id },
        data: { expiresAt: session.expiresAt },
      });
  }
});
