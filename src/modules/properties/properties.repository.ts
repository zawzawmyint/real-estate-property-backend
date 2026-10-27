import { Prisma } from '../../generated/prisma/client.js';
import type {
  Database,
  Transaction,
} from '../../infrastructure/database/transaction.js';
import type { PropertyQuery } from './properties.schema.js';
import { normalizeSearchText } from '../../shared/search/normalize-search-text.js';

const photoSelect = {
  id: true,
  storageKey: true,
  width: true,
  height: true,
} as const;

export const summarySelect = {
  isDemo: true,
  id: true,
  title: true,
  purpose: true,
  type: true,
  priceFils: true,
  city: true,
  community: true,
  bedrooms: true,
  bathrooms: true,
  areaHundredths: true,
  photos: {
    orderBy: [{ position: 'asc' }, { id: 'asc' }],
    select: photoSelect,
  },
} satisfies Prisma.PropertySelect;

export const detailSelect = { ...summarySelect, description: true } as const;

export const staffSelect = {
  ...detailSelect,
  publishingState: true,
  availability: true,
  featured: true,
  createdAt: true,
  updatedAt: true,
} as const;

export const internalSelect = {
  ...staffSelect,
  ownerName: true,
  ownerPhone: true,
} as const;

export type PropertyRecord = Prisma.PropertyGetPayload<{
  select: typeof internalSelect;
}>;

export type PublicRecord = Prisma.PropertyGetPayload<{
  select: typeof detailSelect;
}>;

export function propertyWhere(
  query: PropertyQuery,
  staff: boolean,
): Prisma.PropertyWhereInput {
  const where: Prisma.PropertyWhereInput = staff
    ? {}
    : { publishingState: 'published', availability: 'available' };

  for (const field of ['purpose', 'type', 'featured'] as const)
    if (query[field] !== undefined)
      Object.assign(where, { [field]: query[field] });

  if (staff)
    for (const field of ['publishingState', 'availability'] as const)
      if (query[field] !== undefined)
        Object.assign(where, { [field]: query[field] });
  if (query.minPriceFils !== undefined || query.maxPriceFils !== undefined)
    where.priceFils = {
      ...(query.minPriceFils !== undefined
        ? { gte: BigInt(query.minPriceFils) }
        : {}),
      ...(query.maxPriceFils !== undefined
        ? { lte: BigInt(query.maxPriceFils) }
        : {}),
    };
  if (query.minBedrooms !== undefined)
    where.bedrooms = { gte: query.minBedrooms };

  return where;
}

export function propertyOrder(
  sort: PropertyQuery['sort'],
): Prisma.PropertyOrderByWithRelationInput[] {
  const primary =
    sort === 'price_asc'
      ? { priceFils: 'asc' }
      : sort === 'price_desc'
        ? { priceFils: 'desc' }
        : sort === 'updated_desc'
          ? { updatedAt: 'desc' }
          : { createdAt: 'desc' };

  return [primary as Prisma.PropertyOrderByWithRelationInput, { id: 'asc' }];
}

async function searchPage(
  tx: Transaction,
  query: PropertyQuery,
  where: Prisma.PropertyWhereInput,
  staff: boolean,
) {
  const clauses: Prisma.Sql[] = [];
  // Column names come only from this fixed list; every value is a parameter.
  for (const field of [
    'purpose',
    'type',
    'featured',
    'publishingState',
    'availability',
  ] as const) {
    if (where[field] !== undefined)
      clauses.push(Prisma.sql`${Prisma.raw(field)} = ${where[field]}`);
  }
  if (query.minPriceFils !== undefined)
    clauses.push(Prisma.sql`priceFils >= ${BigInt(query.minPriceFils)}`);
  if (query.maxPriceFils !== undefined)
    clauses.push(Prisma.sql`priceFils <= ${BigInt(query.maxPriceFils)}`);
  if (query.minBedrooms !== undefined)
    clauses.push(Prisma.sql`bedrooms >= ${query.minBedrooms}`);
  if (query.location) {
    const location = normalizeSearchText(query.location);
    clauses.push(
      Prisma.sql`(instr(searchCity, ${location}) > 0 OR instr(searchCommunity, ${location}) > 0)`,
    );
  }
  if (staff && query.q) {
    const text = normalizeSearchText(query.q);
    clauses.push(
      Prisma.sql`(instr(searchTitle, ${text}) > 0 OR instr(searchCity, ${text}) > 0 OR instr(searchCommunity, ${text}) > 0)`,
    );
  }
  const predicate = Prisma.join(clauses, ' AND ');
  const order =
    query.sort === 'price_asc'
      ? Prisma.sql`priceFils ASC, id ASC`
      : query.sort === 'price_desc'
        ? Prisma.sql`priceFils DESC, id ASC`
        : query.sort === 'updated_desc'
          ? Prisma.sql`updatedAt DESC, id ASC`
          : Prisma.sql`createdAt DESC, id ASC`;
  // instr() keeps percent/underscore literal. SQLite does the scan/count;
  // only the requested page of IDs and projected DTOs crosses into Node.
  const count = await tx.$queryRaw<Array<{ total: bigint }>>`
    SELECT COUNT(*) AS total FROM Property WHERE ${predicate}`;
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM Property WHERE ${predicate} ORDER BY ${order}
    LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`;

  return { ids: rows.map((row) => row.id), total: Number(count[0]!.total) };
}

export function createPropertyRepository(database: Database) {
  return {
    async list(query: PropertyQuery, staff: boolean, privateOwner: boolean) {
      const where = propertyWhere(query, staff);
      const select = staff
        ? privateOwner
          ? internalSelect
          : staffSelect
        : summarySelect;
      const { items, total } = await database.$transaction(async (tx) => {
        if (query.location || (staff && query.q)) {
          const { ids, total } = await searchPage(tx, query, where, staff);
          const items = await tx.property.findMany({
            where: { id: { in: ids } },
            select,
            orderBy: propertyOrder(query.sort),
            take: query.pageSize,
          });

          return { items, total };
        }

        const items = await tx.property.findMany({
          where,
          select,
          orderBy: propertyOrder(query.sort),
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        });
        const total = await tx.property.count({ where });

        return { items, total };
      });

      return { items, total, page: query.page, pageSize: query.pageSize };
    },

    findPublic(id: string) {
      return database.property.findFirst({
        where: { id, publishingState: 'published', availability: 'available' },
        select: detailSelect,
      });
    },

    findStaff(id: string, privateOwner: boolean) {
      return database.property.findUnique({
        where: { id },
        select: privateOwner ? internalSelect : staffSelect,
      });
    },

    findInternal(id: string, tx: Transaction = database) {
      return tx.property.findUnique({ where: { id }, select: internalSelect });
    },

    findPhotoReference(storageKey: string) {
      return database.propertyPhoto.findUnique({
        where: { storageKey },
        select: { id: true },
      });
    },

    create(data: Prisma.PropertyCreateInput, tx: Transaction) {
      return tx.property.create({ data, select: internalSelect });
    },

    update(id: string, data: Prisma.PropertyUpdateInput, tx: Transaction) {
      return tx.property.update({
        where: { id },
        data,
        select: internalSelect,
      });
    },

    remove(id: string, tx: Transaction) {
      return tx.property.delete({ where: { id }, select: { id: true } });
    },

    lock(id: string, tx: Transaction) {
      return tx.property.updateMany({
        where: { id },
        data: { updatedAt: new Date() },
      });
    },

    addPhoto(
      propertyId: string,
      data: {
        storageKey: string;
        width: number;
        height: number;
        position: number;
      },
      tx: Transaction,
    ) {
      return tx.propertyPhoto.create({ data: { ...data, propertyId } });
    },

    removePhoto(id: string, tx: Transaction) {
      return tx.propertyPhoto.delete({ where: { id } });
    },

    setPosition(id: string, position: number, tx: Transaction) {
      return tx.propertyPhoto.update({ where: { id }, data: { position } });
    },
  };
}
