import { expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { access } from 'node:fs/promises';
import { authFixture } from './auth-fixture.js';
import { LocalStorage } from '../src/infrastructure/storage/local-storage.js';
import {
  seedDemoProperties,
  requireDemoSeedConsent,
} from '../src/modules/properties/demo-seed.js';

it('requires explicit consent and refuses production before writing', () => {
  expect(() => requireDemoSeedConsent([], 'development')).toThrow(
    'confirm-demo',
  );
  expect(() =>
    requireDemoSeedConsent(['--confirm-demo'], 'production'),
  ).toThrow('production');
  expect(() =>
    requireDemoSeedConsent(['--confirm-demo'], 'development'),
  ).not.toThrow();
  expect(() =>
    requireDemoSeedConsent(['--confirm-demo', '--reset'], 'development'),
  ).toThrow('Unknown');
});

it('inserts 15 complete photo-backed demo records once without overwriting edits or real stock', async () => {
  const fixture = await authFixture();
  const storage = new LocalStorage(
    join(fixture.directory, 'seed-media'),
    fixture.env.PUBLIC_ORIGIN,
  );

  try {
    const real = await fixture.database.property.create({
      data: { title: 'Real property untouched', purpose: 'sale' },
    });
    const first = await seedDemoProperties(fixture.database, storage);

    expect(first).toEqual({ created: 15, skipped: 0 });

    const records = await fixture.database.property.findMany({
      where: { isDemo: true },
      include: { photos: true },
    });

    expect(records).toHaveLength(15);
    expect(new Set(records.map((record) => record.purpose)).size).toBe(2);
    expect(new Set(records.map((record) => record.type)).size).toBe(4);
    expect(records.filter((record) => record.featured)).toHaveLength(3);

    for (const record of records) {
      expect(record.publishingState).toBe('published');
      expect(record.availability).toBe('available');
      expect(record.photos.length).toBeGreaterThanOrEqual(2);

      for (const photo of record.photos)
        await access(await storage.resolveFile(photo.storageKey));
    }

    const edited = records[0]!;

    await fixture.database.property.update({
      where: { id: edited.id },
      data: { title: 'Staff edited demo' },
    });
    expect(await seedDemoProperties(fixture.database, storage)).toEqual({
      created: 0,
      skipped: 15,
    });
    expect(
      (
        await fixture.database.property.findUniqueOrThrow({
          where: { id: edited.id },
        })
      ).title,
    ).toBe('Staff edited demo');
    expect(
      (
        await fixture.database.property.findUniqueOrThrow({
          where: { id: real.id },
        })
      ).title,
    ).toBe('Real property untouched');
    expect(await fixture.database.property.count()).toBe(16);
  } finally {
    await fixture.close();
  }
}, 60_000);

it('fails missing assets before inserting any records', async () => {
  const fixture = await authFixture();

  try {
    const storage = new LocalStorage(
      join(fixture.directory, 'media'),
      fixture.env.PUBLIC_ORIGIN,
    );

    await expect(
      seedDemoProperties(
        fixture.database,
        storage,
        join(fixture.directory, 'missing'),
      ),
    ).rejects.toThrow();
    expect(await fixture.database.property.count()).toBe(0);
  } finally {
    await fixture.close();
  }
});

it('retains photos referenced by an ambiguously committed seed insertion', async () => {
  const fixture = await authFixture();
  const storage = new LocalStorage(
    join(fixture.directory, 'ambiguous-media'),
    fixture.env.PUBLIC_ORIGIN,
  );

  try {
    const create = fixture.database.property.create.bind(
      fixture.database.property,
    );

    vi.spyOn(fixture.database.property, 'create').mockImplementationOnce(
      (args) => {
        const operation = create(args);

        return new Proxy(operation, {
          get(target, key, receiver) {
            if (key === 'then') {
              const failure = target.then(() => {
                throw new Error('Connection lost after commit');
              });

              return failure.then.bind(failure);
            }

            return Reflect.get(target, key, receiver);
          },
        });
      },
    );
    expect(await seedDemoProperties(fixture.database, storage)).toEqual({
      created: 14,
      skipped: 1,
    });

    const photos = await fixture.database.propertyPhoto.findMany();

    expect(photos).toHaveLength(30);

    for (const photo of photos)
      await access(await storage.resolveFile(photo.storageKey));
  } finally {
    vi.restoreAllMocks();
    await fixture.close();
  }
}, 60_000);

it('retains saved media when a failed insertion cannot be reconciled against the database', async () => {
  const fixture = await authFixture();
  const storage = new LocalStorage(
    join(fixture.directory, 'uncertain-media'),
    fixture.env.PUBLIC_ORIGIN,
  );

  try {
    vi.spyOn(fixture.database.property, 'create').mockRejectedValueOnce(
      new Error('Unknown commit outcome'),
    );
    vi.spyOn(fixture.database.propertyPhoto, 'findMany').mockRejectedValueOnce(
      new Error('Database unavailable'),
    );

    const cleanup = vi.spyOn(storage, 'delete');

    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(seedDemoProperties(fixture.database, storage)).rejects.toThrow(
      'Unknown commit outcome',
    );
    expect(cleanup).not.toHaveBeenCalled();
  } finally {
    vi.restoreAllMocks();
    await fixture.close();
  }
});
