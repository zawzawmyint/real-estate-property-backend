import { afterAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { leadFixture } from './lead-fixture.js';
import { createPropertyService } from '../src/modules/properties/properties.service.js';
import { LocalStorage } from '../src/infrastructure/storage/local-storage.js';
import { createLogger } from '../src/shared/logger.js';
import type { Actor } from '../src/modules/leads/leads.repository.js';

const f = await leadFixture();
afterAll(() => f.close());

it('revalidates a formerly privileged property writer inside the transaction', async () => {
  const session = await f.database.session.findFirstOrThrow({
    where: { userId: f.ids.manager! },
  });
  const identity: Actor = {
    id: f.ids.manager!,
    name: 'manager',
    role: 'manager',
    sessionId: session.id,
  };
  await f.database.user.update({
    where: { id: identity.id },
    data: { role: 'agent' },
  });
  const service = createPropertyService(
    f.database,
    new LocalStorage(f.env.STORAGE_ROOT, f.env.PUBLIC_ORIGIN),
    createLogger('silent'),
  );

  // The stale captured identity must never grant current property-write access.
  await expect(
    service.create({ title: 'Denied stale writer', purpose: 'sale' }, identity),
  ).rejects.toMatchObject({ status: 403 });
  expect(await f.database.property.count()).toBe(0);

  const existing = await f.database.property.create({
    data: { title: 'Private existing property', purpose: 'sale' },
  });
  const operations = (id: string) => [
    () => service.patch(id, { title: 'Denied edit' }, identity),
    () => service.remove(id, identity, 'denied-delete'),
    () => service.assertUpload(id, identity),
    () =>
      service.attachPhoto(
        id,
        { data: Buffer.from('image'), width: 1, height: 1 },
        identity,
        'denied-upload',
      ),
    () => service.orderPhotos(id, [], identity),
    () =>
      service.removePhoto(id, randomUUID(), identity, 'denied-photo-delete'),
  ];

  for (const id of [existing.id, randomUUID()])
    for (const run of operations(id))
      await expect(run()).rejects.toMatchObject({ status: 403 });

  await f.database.session.delete({ where: { id: session.id } });
  for (const id of [existing.id, randomUUID()])
    for (const run of operations(id))
      await expect(run()).rejects.toMatchObject({ status: 401 });

  expect(await f.database.recordAuditEvent.count()).toBe(0);
  expect(await f.database.propertyPhoto.count()).toBe(0);
  expect(
    await f.database.property.findUnique({ where: { id: existing.id } }),
  ).toMatchObject({ title: 'Private existing property' });
});
