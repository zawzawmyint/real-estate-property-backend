import request from 'supertest';
import sharp from 'sharp';
import { afterAll, expect, it } from 'vitest';
import { leadFixture } from './lead-fixture.js';

const f = await leadFixture();
afterAll(() => f.close());
function write(
  method: 'post' | 'patch' | 'delete',
  suffix = '',
  role = 'manager',
) {
  const client = request(f.app);
  return client[method](`/api/v1/staff/properties${suffix}`)
    .set('Cookie', f.cookies[role]!)
    .set('Origin', f.env.APP_ORIGIN);
}

it('retains safe property, photo and lifecycle events through deletion and skips unchanged data', async () => {
  const input = {
    title: 'Audit home',
    purpose: 'sale',
    priceFils: 123456,
    ownerName: 'Private owner sentinel',
    description: 'Sensitive prose',
  };
  const created = await write('post', '', 'admin').send(input);
  expect(created.status).toBe(201);
  const id = created.body.id;
  const path = `/${id}`;
  expect((await write('patch', path).send({ title: input.title })).status).toBe(
    200,
  );
  const photo = await sharp({
    create: { width: 12, height: 12, channels: 3, background: 'red' },
  })
    .png()
    .toBuffer();
  const photos = path + '/photos';
  const ids: string[] = [];
  for (let n = 0; n < 2; n++) {
    const result = await write('post', photos)
      .set('Content-Type', 'image/png')
      .send(photo);
    expect(result.status).toBe(201);
    ids.push(result.body.photos[n].id);
  }
  const reverse = [...ids].reverse();
  for (const order of [ids, reverse])
    expect(
      (await write('patch', photos + '/order').send({ photoIds: order }))
        .status,
    ).toBe(200);
  expect((await write('delete', photos + '/' + ids[0])).status).toBe(200);
  expect(
    (await write('patch', path).send({ publishingState: 'archived' })).status,
  ).toBe(200);
  expect((await write('delete', path)).status).toBe(403);
  expect((await write('delete', path, 'admin')).status).toBe(204);
  const rows = await f.database.recordAuditEvent.findMany({
    where: { entityId: id },
  });
  expect(rows.map((r) => r.action).sort()).toEqual(
    [
      'property.created',
      'property.photo_added',
      'property.photo_added',
      'property.photo_removed',
      'property.photos_reordered',
      'property.updated',
      'property.deleted',
    ].sort(),
  );
  const creation = rows.find((r) => r.action === 'property.created')!;
  expect(creation).toMatchObject({
    actorId: f.ids.admin,
    actorRole: 'admin',
    entityLabel: input.title,
  });
  expect(JSON.parse(creation.changesJson)).toEqual(
    expect.arrayContaining([
      { field: 'ownerName', redacted: true },
      { field: 'priceFils', redacted: false, before: null, after: '123456' },
    ]),
  );
  const reorder = rows.find((r) => r.action === 'property.photos_reordered')!;
  expect(JSON.parse(reorder.changesJson)).toEqual([
    expect.objectContaining({ before: ids, after: reverse, redacted: false }),
  ]);
  for (const hidden of [input.ownerName, input.description, '/media/', '.webp'])
    expect(JSON.stringify(rows)).not.toContain(hidden);
});
