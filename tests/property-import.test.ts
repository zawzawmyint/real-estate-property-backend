import request from 'supertest';
import { request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { afterAll, expect, it, vi } from 'vitest';
import { createPropertyImportService } from '../src/modules/properties/property-import.service.js';
import { propertyImportRepository } from '../src/modules/properties/property-import.repository.js';
import type { Actor } from '../src/modules/leads/leads.repository.js';
import { leadFixture } from './lead-fixture.js';
const fixture = await leadFixture();
afterAll(() => fixture.close());
const base = '/api/v1/staff/properties/imports';
const post = (path: string, body: object, role = 'manager') =>
  request(fixture.app)
    .post(`${base}/${path}`)
    .set('Cookie', fixture.cookies[role]!)
    .set('Origin', fixture.env.APP_ORIGIN)
    .send(body);

it('rejects malformed Unicode on replay even when replacement UTF-8 bytes share the digest', async () => {
  const csv = 'title,purpose\nReplacement\ufffd,sale';
  const preview = await post('preview', { csv });
  const payload = {
    csv,
    submissionId: randomUUID(),
    schemaVersion: 1,
    digest: preview.body.digest,
  };
  expect((await post('commit', payload)).status).toBe(201);
  const before = await fixture.database.property.count();
  const receipts = await fixture.database.propertyImportReceipt.count();
  const response = await post('commit', {
    ...payload,
    csv: csv.replace('\ufffd', '\ud800'),
  });
  expect(response.status).toBe(400);
  expect(response.body.error.code).toBe('IMPORT_INVALID_CSV');
  expect(await fixture.database.property.count()).toBe(before);
  expect(await fixture.database.propertyImportReceipt.count()).toBe(receipts);
  expect((await post('commit', payload)).status).toBe(200);
});
it('previews without writes and atomically commits/replays a draft batch', async () => {
  const csv =
    '\ufefftitle,purpose,price_aed,owner_phone\r\nHome,sale,1.01,0012345\r\nOther,rent,,\r\n';
  const before = await fixture.database.property.count();
  const preview = await post('preview', { csv });
  expect(preview.status, JSON.stringify(preview.body)).toBe(200);
  expect(await fixture.database.property.count()).toBe(before);
  const payload = {
    csv,
    submissionId: randomUUID(),
    schemaVersion: 1,
    digest: preview.body.digest,
  };
  const [first, second] = await Promise.all([
    post('commit', payload),
    post('commit', payload),
  ]);
  expect([first.status, second.status].sort()).toEqual([200, 201]);
  expect(first.body.propertyIds).toEqual(second.body.propertyIds);
  expect(await fixture.database.property.count()).toBe(before + 2);
  const properties = await fixture.database.property.findMany({
    where: { id: { in: first.body.propertyIds } },
  });
  expect(
    properties.every(
      (p) =>
        p.publishingState === 'draft' &&
        p.availability === 'available' &&
        !p.featured &&
        !p.isDemo,
    ),
  ).toBe(true);
  const changed = await post('commit', { ...payload, csv: csv + '\n' });
  expect(changed.status).toBe(409);
  expect(changed.body.error.code).toBe('IMPORT_CONFLICT');
  expect((await post('commit', payload, 'admin')).status).toBe(409);
});
it('rejects the entire batch including an invalid final row', async () => {
  const csv = 'title,purpose\nGood,sale\n,bad';
  const preview = await post('preview', { csv });
  expect(preview.body.valid).toBe(false);
  const before = await fixture.database.property.count();
  const response = await post('commit', {
    csv,
    submissionId: randomUUID(),
    schemaVersion: 1,
    digest: preview.body.digest,
  });
  expect(response.status).toBe(422);
  expect(response.body.error.code).toBe('IMPORT_VALIDATION_FAILED');
  expect(response.body.issues).toHaveLength(2);
  expect(await fixture.database.property.count()).toBe(before);
});
it('denies agents and requires the exact schema, Origin and content type', async () => {
  expect(
    (await post('preview', { csv: 'title,purpose\nHome,sale' }, 'agent'))
      .status,
  ).toBe(403);
  expect(
    (await post('preview', { csv: 'title,purpose\nHome,sale', extra: 1 }))
      .status,
  ).toBe(400);
  const template = await request(fixture.app)
    .get(`${base}/template`)
    .set('Cookie', fixture.cookies.manager!);
  expect(template.status).toBe(200);
  expect(template.headers['content-disposition']).toContain(
    'property-import-template.csv',
  );
});

it('rejects malformed UTF-8 transport before replacement decoding', async () => {
  const bytes = Buffer.concat([
    Buffer.from('{"csv":"title,purpose\\n'),
    Buffer.from([0xc3, 0x28]),
    Buffer.from(',sale"}'),
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

it('commits the maximum 500-row batch within the existing transaction budget', async () => {
  const csv =
    'title,purpose,bedrooms,price_aed\n' +
    Array.from(
      { length: 500 },
      (_, index) => `Maximum ${index},sale,0,100.01`,
    ).join('\n');
  const preview = await post('preview', { csv });
  expect(preview.status).toBe(200);
  const started = performance.now();
  const payload = {
    csv,
    submissionId: randomUUID(),
    schemaVersion: 1,
    digest: preview.body.digest,
  };
  const response = await post('commit', payload);
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  expect(response.body.createdCount).toBe(500);
  expect(performance.now() - started).toBeLessThan(15000);
  const property = await fixture.database.property.findUniqueOrThrow({
    where: { id: response.body.propertyIds[0] },
  });
  expect(property).toMatchObject({
    title: 'Maximum 0',
    searchTitle: 'maximum 0',
    bedrooms: 0,
    priceFils: 10001n,
  });
  expect(
    await fixture.database.propertyPhoto.count({
      where: { propertyId: { in: response.body.propertyIds } },
    }),
  ).toBe(0);
  await fixture.database.property.delete({
    where: { id: response.body.propertyIds[0] },
  });
  const replay = await post('commit', payload);
  expect(replay.status).toBe(200);
  expect(replay.body.propertyIds).toEqual(response.body.propertyIds);
  expect(
    await fixture.database.property.findUnique({
      where: { id: response.body.propertyIds[0] },
    }),
  ).toBeNull();
  const changed = csv.replace('Maximum 0', 'Changed');
  const changedPreview = await post('preview', { csv: changed });
  const conflict = await post('commit', {
    ...payload,
    csv: changed,
    digest: changedPreview.body.digest,
  });
  expect(conflict.status).toBe(409);
  expect(conflict.body.error.code).toBe('IMPORT_CONFLICT');
});

it('rolls back drafts and receipt after an injected middle insert failure', async () => {
  const csv = 'title,purpose\nFirst,sale\nSecond,rent';
  const preview = await post('preview', { csv });
  const before = await fixture.database.property.count();
  const receipts = await fixture.database.propertyImportReceipt.count();
  const realCreate = propertyImportRepository.create;
  let count = 0;
  const spy = vi
    .spyOn(propertyImportRepository, 'create')
    .mockImplementation((data, tx) => {
      if (++count === 2) throw new Error('PRIVATE DATABASE FAILURE');
      return realCreate(data, tx);
    });
  try {
    const response = await post('commit', {
      csv,
      submissionId: randomUUID(),
      schemaVersion: 1,
      digest: preview.body.digest,
    });
    expect(response.status).toBe(500);
    expect(JSON.stringify(response.body)).not.toContain('PRIVATE');
    expect(await fixture.database.property.count()).toBe(before);
    expect(await fixture.database.propertyImportReceipt.count()).toBe(receipts);
  } finally {
    spy.mockRestore();
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
  const service = createPropertyImportService(fixture.database);
  const csv = 'title,purpose\nLive,sale';
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
  const service = createPropertyImportService(fixture.database);
  const csv = 'title,purpose\nLive,sale';
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
