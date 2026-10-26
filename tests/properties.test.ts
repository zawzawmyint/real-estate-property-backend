import request from 'supertest';
import sharp from 'sharp';
import { readdir, readFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { crc32 } from 'node:zlib';
import { createApp } from '../src/app.js';
import { LocalStorage } from '../src/infrastructure/storage/local-storage.js';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { authFixture } from './auth-fixture.js';

const staffPath = '/api/v1/staff/properties';
const publicPath = '/api/v1/properties';
const fixture = await authFixture();
const cookies: Record<string, string> = {};
const complete = {
  title: 'Marina apartment',
  purpose: 'sale',
  type: 'apartment',
  description: 'A bright apartment',
  priceFils: 123456789,
  city: 'Dubai',
  community: 'Dubai Marina',
  bedrooms: 2,
  bathrooms: 2,
  areaSqft: '1186.25',
  ownerName: 'Private Owner',
  ownerPhone: '+971 50 123 4567',
  featured: true,
};

beforeAll(async () => {
  for (const role of ['admin', 'manager', 'agent'] as const) {
    await fixture.operator.create({
      name: role,
      email: `${role}@example.test`,
      password: 'Test-password-123!',
      role,
    });

    const login = await request(fixture.app)
      .post('/api/v1/auth/sign-in/email')
      .set('Origin', fixture.env.APP_ORIGIN)
      .send({
        email: `${role}@example.test`,
        password: 'Test-password-123!',
        rememberMe: true,
      });

    cookies[role] = (
      login.headers['set-cookie'] as unknown as string[]
    )[0]!.split(';')[0]!;
  }
});
afterAll(() => fixture.close());

const png = await sharp({
  create: { width: 20, height: 10, channels: 3, background: 'red' },
})
  .png()
  .toBuffer();

function apng(first: Buffer, second: Buffer) {
  function chunks(image: Buffer) {
    const result: Array<{ type: string; data: Buffer }> = [];

    for (let offset = 8; offset + 12 <= image.length;) {
      const length = image.readUInt32BE(offset);

      result.push({
        type: image.toString('ascii', offset + 4, offset + 8),
        data: image.subarray(offset + 8, offset + 8 + length),
      });
      offset += length + 12;
    }

    return result;
  }
  function chunk(type: string, data: Buffer) {
    const output = Buffer.alloc(data.length + 12);

    output.writeUInt32BE(data.length);
    output.write(type, 4, 'ascii');
    data.copy(output, 8);
    output.writeUInt32BE(crc32(output.subarray(4, -4)), output.length - 4);

    return output;
  }

  const firstChunks = chunks(first),
    secondChunks = chunks(second);
  const header = firstChunks.find((item) => item.type === 'IHDR')!.data;
  const control = Buffer.alloc(8);

  control.writeUInt32BE(2, 0);

  function frame(sequence: number) {
    const data = Buffer.alloc(26);

    data.writeUInt32BE(sequence);
    header.subarray(0, 8).copy(data, 4);
    data.writeUInt16BE(1, 20);
    data.writeUInt16BE(10, 22);

    return chunk('fcTL', data);
  }

  const secondData = Buffer.concat(
    secondChunks
      .filter((item) => item.type === 'IDAT')
      .map((item) => item.data),
  );
  const sequence = Buffer.alloc(4);

  sequence.writeUInt32BE(2);

  return Buffer.concat([
    first.subarray(0, 8),
    chunk('IHDR', header),
    chunk('acTL', control),
    frame(0),
    ...firstChunks
      .filter((item) => item.type === 'IDAT')
      .map((item) => chunk('IDAT', item.data)),
    frame(1),
    chunk('fdAT', Buffer.concat([sequence, secondData])),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function write(
  method: 'post' | 'patch' | 'delete',
  path: string,
  role = 'manager',
) {
  const client = request(fixture.app);

  return client[method](path)
    .set('Cookie', cookies[role]!)
    .set('Origin', fixture.env.APP_ORIGIN);
}

async function create(data: object = complete) {
  const response = await write('post', staffPath).send(data);

  expect(response.status, JSON.stringify(response.body)).toBe(201);

  return response.body;
}

it('creates persisted drafts and projects private owner contact only for managers and admins', async () => {
  const created = await create();

  expect(created).toMatchObject({
    ...complete,
    publishingState: 'draft',
    availability: 'available',
    photos: [],
  });
  expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
  expect(
    (await request(fixture.app).get(`${publicPath}/${created.id}`)).status,
  ).toBe(404);

  const agent = await request(fixture.app)
    .get(`${staffPath}/${created.id}`)
    .set('Cookie', cookies.agent!);

  expect(agent.status).toBe(200);
  expect(agent.body).not.toHaveProperty('ownerName');
  expect(agent.body).not.toHaveProperty('ownerPhone');

  const list = await request(fixture.app)
    .get(staffPath)
    .set('Cookie', cookies.agent!);

  expect(
    list.body.items.some((item: { id: string }) => item.id === created.id),
  ).toBe(true);
  expect(JSON.stringify(list.body)).not.toContain('Private Owner');
  expect(agent.headers['cache-control']).toBe('no-store');
});

it('enforces roles, trusted origin before parsing and strict atomic field validation', async () => {
  expect(
    (await request(fixture.app).post(staffPath).send(complete)).status,
  ).toBe(401);
  expect((await write('post', staffPath, 'agent').send(complete)).status).toBe(
    403,
  );
  expect(
    (
      await request(fixture.app)
        .post(staffPath)
        .set('Cookie', cookies.manager!)
        .set('Content-Type', 'application/json')
        .send('{')
    ).status,
  ).toBe(403);

  for (const data of [
    { ...complete, unknown: true },
    { ...complete, areaSqft: '1.001' },
    { ...complete, priceFils: 1.5 },
    { ...complete, publishingState: 'published' },
    { ...complete, ownerPhone: 'abc' },
  ]) {
    expect((await write('post', staffPath).send(data)).status).toBe(400);
  }

  expect(
    (await write('post', staffPath).set('Content-Type', 'text/plain').send('x'))
      .status,
  ).toBe(415);

  const created = await create();

  expect(
    (
      await write('patch', `${staffPath}/${created.id}`).send({
        publishingState: 'published',
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await write('patch', `${staffPath}/${created.id}`).send({
        title: 'Changed',
        availability: 'rented',
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await request(fixture.app)
        .get(`${staffPath}/${created.id}`)
        .set('Cookie', cookies.manager!)
    ).body.title,
  ).toBe(complete.title);
  expect(
    (await write('patch', `${staffPath}/${created.id}`).send({})).status,
  ).toBe(400);
});

it('archives/restores safely and permits permanent deletion only by admin on archived records', async () => {
  const created = await create({ title: 'Draft', purpose: 'rent' });

  expect(
    (await write('delete', `${staffPath}/${created.id}`, 'admin')).status,
  ).toBe(409);
  expect(
    (
      await write('patch', `${staffPath}/${created.id}`).send({
        publishingState: 'archived',
      })
    ).status,
  ).toBe(200);

  for (const data of [
    { title: 'Blocked' },
    { publishingState: 'published' },
    { publishingState: 'draft', title: 'Blocked' },
  ])
    expect(
      (await write('patch', `${staffPath}/${created.id}`).send(data)).status,
    ).toBe(409);

  expect(
    (
      await write('patch', `${staffPath}/${created.id}`).send({
        publishingState: 'draft',
      })
    ).body.publishingState,
  ).toBe('draft');
  await write('patch', `${staffPath}/${created.id}`).send({
    publishingState: 'archived',
  });
  expect((await write('delete', `${staffPath}/${created.id}`)).status).toBe(
    403,
  );
  expect(
    (await write('delete', `${staffPath}/${created.id}`, 'admin')).status,
  ).toBe(204);
  expect(
    (await write('delete', `${staffPath}/${created.id}`, 'admin')).status,
  ).toBe(404);
});

it('rejects unknown, duplicate, empty, malformed and contradictory filters', async () => {
  for (const query of [
    'foo=x',
    'page=1&page=2',
    'page=1e1',
    'pageSize=49',
    'location=',
    'featured=1',
    'minPriceFils=2&maxPriceFils=1',
    'publishingState=draft',
    'minBedrooms=2.5',
    'sort=updated_desc',
    '__proto__=ignored',
  ]) {
    const response = await request(fixture.app).get(`${publicPath}?${query}`);

    expect(response.status, query).toBe(400);
  }

  expect(
    (await request(fixture.app).get(`${publicPath}/not-a-uuid`)).status,
  ).toBe(400);
  expect(
    (await request(fixture.app).get(`${publicPath}?page=10000`)).body,
  ).toMatchObject({ items: [], page: 10000, pageSize: 12 });
});

it('publishes complete photographic listings, filters eligible public DTOs and hides status changes immediately', async () => {
  const first = await create();
  const uploaded = await write('post', `${staffPath}/${first.id}/photos`)
    .set('Content-Type', 'image/png')
    .send(png);

  expect(uploaded.status, JSON.stringify(uploaded.body)).toBe(201);
  expect(uploaded.body.photos).toHaveLength(1);
  expect(uploaded.body.photos[0]).toMatchObject({ width: 20, height: 10 });
  expect(uploaded.body.photos[0]).not.toHaveProperty('storageKey');

  const published = await write('patch', `${staffPath}/${first.id}`).send({
    publishingState: 'published',
  });

  expect(published.status, JSON.stringify(published.body)).toBe(200);

  const publicDetail = await request(fixture.app).get(
    `${publicPath}/${first.id}`,
  );

  expect(publicDetail.status).toBe(200);
  expect(Object.keys(publicDetail.body).sort()).toEqual(
    [
      'id',
      'isDemo',
      'title',
      'purpose',
      'type',
      'priceFils',
      'city',
      'community',
      'bedrooms',
      'bathrooms',
      'areaSqft',
      'coverPhoto',
      'description',
      'photos',
    ].sort(),
  );
  expect(publicDetail.body.coverPhoto).toEqual(publicDetail.body.photos[0]);

  const listing = await request(fixture.app).get(
    `${publicPath}?purpose=sale&type=apartment&location=MARINA&minPriceFils=123456789&maxPriceFils=123456789&minBedrooms=2&featured=true&sort=price_asc&pageSize=1`,
  );

  expect(listing.status).toBe(200);
  expect(listing.body.items[0].id).toBe(first.id);
  expect(listing.body.items[0]).not.toHaveProperty('description');
  expect(
    (
      await write('patch', `${staffPath}/${first.id}`).send({
        description: null,
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await write(
        'delete',
        `${staffPath}/${first.id}/photos/${uploaded.body.photos[0].id}`,
      )
    ).status,
  ).toBe(409);
  expect(
    (
      await write('patch', `${staffPath}/${first.id}`).send({
        availability: 'sold',
      })
    ).status,
  ).toBe(200);
  expect(
    (await request(fixture.app).get(`${publicPath}/${first.id}`)).status,
  ).toBe(404);
  expect(
    (await request(fixture.app).get(`${publicPath}?featured=true`)).body.items,
  ).toEqual([]);
  expect(
    (
      await write('patch', `${staffPath}/${first.id}`).send({
        publishingState: 'draft',
        description: null,
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await write(
        'delete',
        `${staffPath}/${first.id}/photos/${uploaded.body.photos[0].id}`,
      )
    ).status,
  ).toBe(200);
});

it('validates image content, MIME, frames, decoded pixels and metadata then stores only normalized WebP', async () => {
  const property = await create();

  for (const [mime, bytes] of [
    ['image/jpeg', png],
    ['image/png', Buffer.from('<svg/>')],
    ['image/png', Buffer.from('corrupt')],
    ['image/png', png.subarray(0, 40)],
  ] as const) {
    const response = await write('post', `${staffPath}/${property.id}/photos`)
      .set('Content-Type', mime)
      .send(bytes);

    expect(response.status, JSON.stringify(response.body)).toBe(400);
    expect(response.body.error.code).toBe('INVALID_IMAGE');
  }

  expect(
    (
      await write('post', `${staffPath}/${property.id}/photos`)
        .set('Content-Type', 'image/gif')
        .send(png)
    ).status,
  ).toBe(415);

  const giant = await sharp({
    create: { width: 5001, height: 5000, channels: 3, background: 'red' },
  })
    .png()
    .toBuffer();

  expect(
    (
      await write('post', `${staffPath}/${property.id}/photos`)
        .set('Content-Type', 'image/png')
        .send(giant)
    ).status,
  ).toBe(400);

  const blue = await sharp({
    create: { width: 20, height: 10, channels: 3, background: 'blue' },
  })
    .png()
    .toBuffer();
  const animation = await sharp([png, blue], { join: { animated: true } })
    .webp({ loop: 0 })
    .toBuffer();

  expect((await sharp(animation).metadata()).pages).toBe(2);
  expect(
    (
      await write('post', `${staffPath}/${property.id}/photos`)
        .set('Content-Type', 'image/webp')
        .send(animation)
    ).status,
  ).toBe(400);

  const animatedPng = apng(png, blue);
  const rejectedAnimation = await write(
    'post',
    `${staffPath}/${property.id}/photos`,
  )
    .set('Content-Type', 'image/png')
    .send(animatedPng);

  expect(rejectedAnimation.status, JSON.stringify(rejectedAnimation.body)).toBe(
    400,
  );

  const oriented = await sharp({
    create: { width: 3000, height: 100, channels: 3, background: 'blue' },
  })
    .withMetadata({ orientation: 6 })
    .jpeg()
    .toBuffer();
  const uploaded = await write('post', `${staffPath}/${property.id}/photos`)
    .set('Content-Type', 'image/jpeg')
    .send(oriented);

  expect(uploaded.status).toBe(201);
  expect(uploaded.body.photos[0]).toMatchObject({ width: 80, height: 2400 });

  const url = uploaded.body.photos[0].url as string;
  const response = await request(fixture.app).get(new URL(url).pathname);

  expect(response.status).toBe(200);

  const metadata = await sharp(response.body).metadata();

  expect(metadata.format).toBe('webp');
  expect(metadata.exif).toBeUndefined();
  expect(metadata.icc).toBeUndefined();
});

it('checks upload access/resource/state before content and rejects declared byte overflow', async () => {
  const property = await create();
  const path = `${staffPath}/${property.id}/photos`;

  expect(
    (
      await request(fixture.app)
        .post(path)
        .set('Content-Type', 'image/png')
        .send(png)
    ).status,
  ).toBe(401);
  expect(
    (
      await write('post', path, 'agent')
        .set('Content-Type', 'image/png')
        .send(png)
    ).status,
  ).toBe(403);
  expect(
    (
      await request(fixture.app)
        .post(path)
        .set('Cookie', cookies.manager!)
        .set('Origin', 'null')
        .set('Content-Type', 'image/png')
        .send(png)
    ).status,
  ).toBe(403);
  expect(
    (
      await write(
        'post',
        `${staffPath}/00000000-0000-4000-8000-000000000000/photos`,
      )
        .set('Content-Type', 'image/png')
        .send(png)
    ).status,
  ).toBe(404);

  const tooBig = await write('post', path)
    .set('Content-Type', 'image/png')
    .set('Content-Length', '5242881');

  expect(tooBig.status).toBe(413);
  expect(tooBig.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  await write('patch', `${staffPath}/${property.id}`).send({
    publishingState: 'archived',
  });
  expect(
    (await write('post', path).set('Content-Type', 'image/png').send(png))
      .status,
  ).toBe(409);
});

it('preserves exact photo ordering, rejects foreign/stale sets and serializes max-count uploads', async () => {
  const property = await create();
  const path = `${staffPath}/${property.id}/photos`;
  const results = await Promise.all(
    Array.from({ length: 13 }, () =>
      write('post', path).set('Content-Type', 'image/png').send(png),
    ),
  );

  expect(results.filter((result) => result.status === 201)).toHaveLength(12);
  expect(results.filter((result) => result.status === 409)).toHaveLength(1);

  const current = await request(fixture.app)
    .get(`${staffPath}/${property.id}`)
    .set('Cookie', cookies.manager!);
  const ids = current.body.photos.map(
    (photo: { id: string }) => photo.id,
  ) as string[];
  const reversed = [...ids].reverse();

  expect(
    (
      await write('patch', `${path}/order`).send({ photoIds: reversed })
    ).body.photos.map((photo: { id: string }) => photo.id),
  ).toEqual(reversed);

  for (const photoIds of [
    ids.slice(1),
    [...ids.slice(1), ids[1]],
    [...ids.slice(1), '00000000-0000-4000-8000-000000000000'],
  ])
    expect(
      (await write('patch', `${path}/order`).send({ photoIds })).status,
    ).toBe(409);

  const other = await create();

  expect(
    (await write('delete', `${staffPath}/${other.id}/photos/${ids[0]}`)).status,
  ).toBe(404);

  const removed = await write('delete', `${path}/${reversed[0]}`);

  expect(removed.status).toBe(200);
  expect(removed.body.photos.map((photo: { id: string }) => photo.id)).toEqual(
    reversed.slice(1),
  );
  expect(
    (await write('patch', `${path}/order`).send({ photoIds: ids })).status,
  ).toBe(409);
});

it('compensates saved files after failed attachment and keeps committed removals after cleanup failure', async () => {
  const local = new LocalStorage(
    fixture.env.STORAGE_ROOT,
    fixture.env.PUBLIC_ORIGIN,
  );
  const orphaned = await create();
  const priorFiles = await readdir(fixture.env.STORAGE_ROOT);
  const failingAttachmentStorage = {
    async save(bytes: Buffer, ext: string) {
      const key = await local.save(bytes, ext);

      await fixture.database.property.delete({ where: { id: orphaned.id } });

      return key;
    },

    delete: (key: string) => local.delete(key),
    resolveUrl: (key: string) => local.resolveUrl(key),
  };
  const app = createApp(
    fixture.env,
    fixture.auth,
    fixture.database,
    failingAttachmentStorage,
  );
  const attachment = await request(app)
    .post(`${staffPath}/${orphaned.id}/photos`)
    .set('Origin', fixture.env.APP_ORIGIN)
    .set('Cookie', cookies.manager!)
    .set('Content-Type', 'image/png')
    .send(png);

  expect(attachment.status).toBe(404);
  expect(await readdir(fixture.env.STORAGE_ROOT)).toEqual(priorFiles);

  const property = await create();
  const added = await write('post', `${staffPath}/${property.id}/photos`)
    .set('Content-Type', 'image/png')
    .send(png);
  const photo = added.body.photos[0];
  const cleanupApp = createApp(fixture.env, fixture.auth, fixture.database, {
    save: (bytes, ext) => local.save(bytes, ext),
    resolveUrl: (key) => local.resolveUrl(key),

    async delete() {
      throw new Error('secret storage path');
    },
  });
  const removed = await request(cleanupApp)
    .delete(`${staffPath}/${property.id}/photos/${photo.id}`)
    .set('Origin', fixture.env.APP_ORIGIN)
    .set('Cookie', cookies.manager!);

  expect(removed.status).toBe(200);
  expect(removed.body.photos).toEqual([]);
  expect(
    await fixture.database.propertyPhoto.count({ where: { id: photo.id } }),
  ).toBe(0);
  expect(JSON.stringify(removed.body)).not.toContain('secret');
  expect(
    (
      await readFile(
        await local.resolveFile(new URL(photo.url).pathname.split('/').at(-1)!),
      )
    ).length,
  ).toBeGreaterThan(0);
});

it('bounds chunked image streams without a declared length at exactly 5 MiB', async () => {
  const property = await create();
  const server = fixture.app.listen(0, '127.0.0.1');

  await once(server, 'listening');

  try {
    async function upload(size: number) {
      return new Promise<{ status: number; body: { error: { code: string } } }>(
        (resolve, reject) => {
          const address = server.address();

          if (!address || typeof address === 'string')
            throw new Error('Missing address');

          let responded = false;
          const req = httpRequest(
            {
              host: '127.0.0.1',
              port: address.port,
              path: `${staffPath}/${property.id}/photos`,
              method: 'POST',
              headers: {
                Cookie: cookies.manager!,
                Origin: fixture.env.APP_ORIGIN,
                'Content-Type': 'image/png',
                'Transfer-Encoding': 'chunked',
              },
            },
            (res) => {
              responded = true;

              let body = '';

              res.setEncoding('utf8');
              res.on('data', (chunk) => {
                body += chunk;
              });
              res.on('end', () =>
                resolve({ status: res.statusCode!, body: JSON.parse(body) }),
              );
            },
          );

          req.on('error', (error) => {
            if (!responded) reject(error);
          });

          let sent = 0;

          function pump() {
            if (responded) {
              req.end();
              return;
            }
            if (sent >= size) {
              req.end();
              return;
            }

            const length = Math.min(16384, size - sent);

            sent += length;
            req.write(Buffer.alloc(length));
            setImmediate(pump);
          }

          pump();
        },
      );
    }

    const atLimit = await upload(5_242_880);

    expect(atLimit.status).toBe(400);
    expect(atLimit.body.error.code).toBe('INVALID_IMAGE');

    const overLimit = await upload(5_242_881);

    expect(overLimit.status).toBe(413);
    expect(overLimit.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it('keeps publish and last-photo removal atomic when they race', async () => {
  const property = await create();
  const upload = await write('post', `${staffPath}/${property.id}/photos`)
    .set('Content-Type', 'image/png')
    .send(png);
  const result = await Promise.all([
    write('patch', `${staffPath}/${property.id}`).send({
      publishingState: 'published',
    }),
    write(
      'delete',
      `${staffPath}/${property.id}/photos/${upload.body.photos[0].id}`,
    ),
  ]);

  expect(result.filter((response) => response.status === 200)).toHaveLength(1);
  expect(
    result.filter((response) => [400, 409].includes(response.status)),
  ).toHaveLength(1);

  const state = await fixture.database.property.findUniqueOrThrow({
    where: { id: property.id },
    include: { photos: true },
  });

  expect(state.publishingState !== 'published' || state.photos.length > 0).toBe(
    true,
  );
});

it('uses stable ID ordering, bounded empty pages and never searches private owner fields', async () => {
  const a = await create({
    title: 'Stable tie',
    purpose: 'sale',
    ownerName: 'OnlyPrivateSearch',
  });
  const b = await create({ title: 'Stable tie', purpose: 'sale' });

  await fixture.database.property.updateMany({
    where: { id: { in: [a.id, b.id] } },
    data: { createdAt: new Date('2026-01-01T00:00:00Z') },
  });

  const response = await request(fixture.app)
    .get(`${staffPath}?q=Stable%20tie&sort=newest&pageSize=1`)
    .set('Cookie', cookies.manager!);

  expect(response.body.items.map((item: { id: string }) => item.id)).toEqual(
    [a.id, b.id].sort().slice(0, 1),
  );
  expect(response.body.total).toBe(2);

  const noOwnerSearch = await request(fixture.app)
    .get(`${staffPath}?q=OnlyPrivateSearch`)
    .set('Cookie', cookies.manager!);

  expect(noOwnerSearch.body.total).toBe(0);

  for (const q of ['%', '_']) {
    const literal = await request(fixture.app)
      .get(`${staffPath}?q=${encodeURIComponent(q)}`)
      .set('Cookie', cookies.manager!);

    expect(literal.body.total).toBe(0);
  }

  const unicode = await create({
    title: 'Étage apartment',
    purpose: 'sale',
    city: 'München',
  });
  const unicodeSearch = await request(fixture.app)
    .get(
      `${staffPath}?q=${encodeURIComponent('ÉTAGE')}&location=${encodeURIComponent('MÜNCHEN')}`,
    )
    .set('Cookie', cookies.manager!);

  expect(
    unicodeSearch.body.items.map((item: { id: string }) => item.id),
  ).toEqual([unicode.id]);
});

it('handles save and database failures with safe infrastructure envelopes', async () => {
  const property = await create();
  const failingStorage = {
    async save(): Promise<string> {
      throw new Error('PRIVATE filesystem path');
    },

    async delete() {},

    resolveUrl: (key: string) => `http://localhost/${key}`,
  };
  const app = createApp(
    fixture.env,
    fixture.auth,
    fixture.database,
    failingStorage,
  );
  const response = await request(app)
    .post(`${staffPath}/${property.id}/photos`)
    .set('Cookie', cookies.manager!)
    .set('Origin', fixture.env.APP_ORIGIN)
    .set('Content-Type', 'image/png')
    .send(png);

  expect(response.status).toBe(500);
  expect(response.body.error.code).toBe('INTERNAL_ERROR');
  expect(JSON.stringify(response.body)).not.toContain('PRIVATE');
  expect(
    await fixture.database.propertyPhoto.count({
      where: { propertyId: property.id },
    }),
  ).toBe(0);
  await fixture.database.$executeRawUnsafe(
    'ALTER TABLE "Property" RENAME TO "UnavailableProperty"',
  );

  try {
    const unavailable = await request(fixture.app).get(publicPath);

    expect(unavailable.status).toBe(500);
    expect(unavailable.body.error.code).toBe('INTERNAL_ERROR');
  } finally {
    await fixture.database.$executeRawUnsafe(
      'ALTER TABLE "UnavailableProperty" RENAME TO "Property"',
    );
  }
});

it('retains referenced images when attachment commits but its transaction reports a failure', async () => {
  const property = await create();
  const uncertainDatabase = new Proxy(fixture.database, {
    get(target, key) {
      if (key === '$transaction')
        return async (...args: unknown[]) => {
          await Reflect.apply(target.$transaction, target, args);

          throw new Error('Ambiguous commit acknowledgement');
        };

      return Reflect.get(target, key);
    },
  });
  const app = createApp(fixture.env, fixture.auth, uncertainDatabase);
  const response = await request(app)
    .post(`${staffPath}/${property.id}/photos`)
    .set('Cookie', cookies.manager!)
    .set('Origin', fixture.env.APP_ORIGIN)
    .set('Content-Type', 'image/png')
    .send(png);

  expect(response.status).toBe(500);

  const saved = await fixture.database.propertyPhoto.findFirstOrThrow({
    where: { propertyId: property.id },
  });
  const local = new LocalStorage(
    fixture.env.STORAGE_ROOT,
    fixture.env.PUBLIC_ORIGIN,
  );

  expect(
    (await readFile(await local.resolveFile(saved.storageKey))).length,
  ).toBeGreaterThan(0);
});

it('retains recoverable files when the failed attachment outcome cannot be checked', async () => {
  const property = await create();
  const prior = await readdir(fixture.env.STORAGE_ROOT);
  const uncertainDatabase = new Proxy(fixture.database, {
    get(target, key) {
      if (key === '$transaction')
        return async () => {
          throw new Error('Database unavailable');
        };
      if (key === 'propertyPhoto')
        return new Proxy(target.propertyPhoto, {
          get(photos, operation) {
            if (operation === 'findUnique')
              return async () => {
                throw new Error('Database still unavailable');
              };

            return Reflect.get(photos, operation);
          },
        });

      return Reflect.get(target, key);
    },
  });
  const app = createApp(fixture.env, fixture.auth, uncertainDatabase);
  const response = await request(app)
    .post(`${staffPath}/${property.id}/photos`)
    .set('Cookie', cookies.manager!)
    .set('Origin', fixture.env.APP_ORIGIN)
    .set('Content-Type', 'image/png')
    .send(png);

  expect(response.status).toBe(500);
  expect(
    await fixture.database.propertyPhoto.count({
      where: { propertyId: property.id },
    }),
  ).toBe(0);

  const retained = (await readdir(fixture.env.STORAGE_ROOT)).filter(
    (key) => !prior.includes(key),
  );

  expect(retained).toHaveLength(1);
});

it('uses current role and revoked or disabled database sessions on every property request', async () => {
  const manager = await fixture.database.user.findUniqueOrThrow({
    where: { email: 'manager@example.test' },
  });

  await fixture.database.user.update({
    where: { id: manager.id },
    data: { role: 'agent' },
  });
  expect((await write('post', staffPath).send(complete)).status).toBe(403);

  const read = await request(fixture.app)
    .get(staffPath)
    .set('Cookie', cookies.manager!);

  expect(read.status).toBe(200);
  expect(JSON.stringify(read.body)).not.toContain('ownerName');
  await fixture.database.user.update({
    where: { id: manager.id },
    data: { role: 'manager', disabled: true },
  });
  expect(
    (await request(fixture.app).get(staffPath).set('Cookie', cookies.manager!))
      .status,
  ).toBe(401);
  await fixture.database.user.update({
    where: { id: manager.id },
    data: { disabled: false },
  });
  await fixture.database.session.deleteMany({ where: { userId: manager.id } });
  expect(
    (await request(fixture.app).get(staffPath).set('Cookie', cookies.manager!))
      .status,
  ).toBe(401);
});
