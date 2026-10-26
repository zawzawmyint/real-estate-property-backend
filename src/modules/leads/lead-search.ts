import type { PrismaClient, Prisma } from '../../generated/prisma/client.js';
import { foldSearch } from '../properties/property-search.js';
import { leadSearch } from './leads.repository.js';
async function* users(tx: Pick<Prisma.TransactionClient, 'user'>) {
  let cursor: string | undefined;
  while (true) {
    const page = await tx.user.findMany({
      where: cursor ? { id: { gt: cursor } } : {},
      orderBy: { id: 'asc' },
      take: 200,
      select: { id: true, name: true, searchName: true },
    });
    if (!page.length) return;
    yield* page;
    cursor = page.at(-1)!.id;
  }
}
async function* leads(tx: Pick<Prisma.TransactionClient, 'lead'>) {
  let cursor: string | undefined;
  while (true) {
    const page = await tx.lead.findMany({
      where: cursor ? { id: { gt: cursor } } : {},
      orderBy: { id: 'asc' },
      take: 200,
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        propertyTitleSnapshot: true,
        searchName: true,
        searchPhone: true,
        searchEmail: true,
        searchPropertyTitle: true,
      },
    });
    if (!page.length) return;
    yield* page;
    cursor = page.at(-1)!.id;
  }
}
export async function verifyLeadSearch(database: PrismaClient) {
  for await (const user of users(database))
    if (user.searchName !== foldSearch(user.name))
      throw new Error(
        'Staff search data is inconsistent; stop writes and run bun run db:migrate',
      );
  for await (const lead of leads(database)) {
    const expected = leadSearch(lead);
    if (
      Object.entries(expected).some(
        ([key, value]) => lead[key as keyof typeof expected] !== value,
      )
    )
      throw new Error(
        'Lead search data is inconsistent; stop writes and run bun run db:migrate',
      );
  }
}
export async function backfillLeadSearch(database: PrismaClient) {
  await database.$transaction(
    async (tx) => {
      for await (const user of users(tx))
        if (user.searchName !== foldSearch(user.name))
          await tx.$executeRaw`UPDATE User SET searchName=${foldSearch(user.name)} WHERE id=${user.id}`;
      for await (const lead of leads(tx)) {
        const fields = leadSearch(lead);
        if (
          Object.entries(fields).some(
            ([key, value]) => lead[key as keyof typeof fields] !== value,
          )
        )
          await tx.$executeRaw`UPDATE Lead SET searchName=${fields.searchName},searchPhone=${fields.searchPhone},searchEmail=${fields.searchEmail},searchPropertyTitle=${fields.searchPropertyTitle} WHERE id=${lead.id}`;
      }
    },
    { timeout: 120000 },
  );
}
