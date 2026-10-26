import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';

export const foldSearch = (value: string | null) =>
  (value ?? '').normalize('NFC').toLowerCase();

export function propertySearchFields(input: {
  title?: string | undefined;
  city?: string | null | undefined;
  community?: string | null | undefined;
}) {
  return {
    ...(input.title !== undefined
      ? { searchTitle: foldSearch(input.title) }
      : {}),
    ...(input.city !== undefined ? { searchCity: foldSearch(input.city) } : {}),
    ...(input.community !== undefined
      ? { searchCommunity: foldSearch(input.community) }
      : {}),
  };
}

async function* searchRows(
  database: Pick<Prisma.TransactionClient, 'property'>,
) {
  let cursor: string | undefined;

  while (true) {
    const rows = await database.property.findMany({
      orderBy: { id: 'asc' },
      ...(cursor ? { where: { id: { gt: cursor } } } : {}),
      take: 200,
      select: {
        id: true,
        title: true,
        city: true,
        community: true,
        searchTitle: true,
        searchCity: true,
        searchCommunity: true,
      },
    });
    if (!rows.length) break;

    yield* rows;
    cursor = rows.at(-1)!.id;
  }
}

export async function verifyPropertySearch(database: PrismaClient) {
  for await (const row of searchRows(database)) {
    const fields = propertySearchFields(row);
    if (
      row.searchTitle !== fields.searchTitle ||
      row.searchCity !== fields.searchCity ||
      row.searchCommunity !== fields.searchCommunity
    )
      throw new Error(
        'Property search data is inconsistent; stop writes and run bun run db:migrate',
      );
  }
}

/** Run with application writes stopped after schema migrations; safe to rerun. */
export async function backfillPropertySearch(database: PrismaClient) {
  await database.$transaction(
    async (tx) => {
      for await (const row of searchRows(tx)) {
        const fields = propertySearchFields(row);
        if (
          row.searchTitle !== fields.searchTitle ||
          row.searchCity !== fields.searchCity ||
          row.searchCommunity !== fields.searchCommunity
        ) {
          // Raw UPDATE preserves the property's business updatedAt timestamp.
          await tx.$executeRaw`UPDATE Property SET searchTitle = ${fields.searchTitle!},
            searchCity = ${fields.searchCity!}, searchCommunity = ${fields.searchCommunity!}
            WHERE id = ${row.id}`;
        }
      }
    },
    { timeout: 120_000 },
  );
}
