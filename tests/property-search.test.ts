import type { Database } from '../src/infrastructure/database/transaction.js';
import { expect, it } from 'vitest';
import { authFixture } from './auth-fixture.js';
import { createPropertyRepository } from '../src/modules/properties/properties.repository.js';
import { createPropertyService } from '../src/modules/properties/properties.service.js';
import { LocalStorage } from '../src/infrastructure/storage/local-storage.js';
import pino from 'pino';
import {
  parseQuery,
  toData,
} from '../src/modules/properties/properties.schema.js';

it('paginates Unicode literal searches in SQLite without loading unbounded candidate rows', async () => {
  const fixture = await authFixture();
  let reads = 0;
  const database = fixture.database.$extends({
    query: {
      property: {
        async findMany({ args, query }) {
          reads++;
          expect(args.take).toBeGreaterThan(0);
          expect(args.take).toBeLessThanOrEqual(2);
          return query(args);
        },
      },
    },
  });

  try {
    for (let index = 0; index < 5; index++) {
      await fixture.database.property.create({
        data: {
          title: `Étage %_ ${index}`,
          purpose: 'sale',
          ...toData({ title: `Étage %_ ${index}`, city: 'Mu\u0308nchen' }),
        },
      });
    }
    const repository = createPropertyRepository(
      database as unknown as Database,
    );
    const result = await repository.list(
      parseQuery(
        '/?q=%25_&location=M%C3%9CNCHEN&pageSize=2&page=2&sort=price_asc',
        true,
      ),
      true,
      false,
    );

    expect(result.total).toBe(5);
    expect(result.items).toHaveLength(2);
    expect(reads).toBe(1);
    expect(result.items.map((item) => item.id)).toEqual(
      (await fixture.database.property.findMany({ orderBy: { id: 'asc' } }))
        .slice(2, 4)
        .map((item) => item.id),
    );
  } finally {
    await fixture.close();
  }
});

it('filters exact bedrooms and current public visibility before taking the first three chat matches', async () => {
  const fixture = await authFixture();
  try {
    const { database } = fixture;
    const search = createPropertyService(
      database,
      new LocalStorage(fixture.env.STORAGE_ROOT, fixture.env.PUBLIC_ORIGIN),
      pino({ level: 'silent' }),
    ).searchForChat;
    for (const [index, bedrooms] of [2, 3, 3, 3, 3].entries()) {
      await database.property.create({
        data: {
          ...toData({ city: 'Dubai Marina' }),
          title: `Chat property ${index}`,
          purpose: 'rent',
          bedrooms,
          priceFils: 12_000_000n,
          publishingState: 'published',
          createdAt: new Date(2026, 0, index + 1),
          ownerName: 'Private owner',
        },
      });
    }
    const filters = {
      location: 'Dubai Marina',
      exactBedrooms: 2,
      maxPriceFils: 12_000_000,
    };
    const [match] = await search(filters);
    expect(match?.title).toBe('Chat property 0');
    expect(match).not.toHaveProperty('ownerName');
    expect(await search({ ...filters, location: undefined })).toHaveLength(1);
    await database.property.update({
      where: { id: match!.id },
      data: { availability: 'rented' },
    });
    expect(await search(filters)).toEqual([]);
  } finally {
    await fixture.close();
  }
});
