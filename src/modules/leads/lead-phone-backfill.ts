import type { PrismaClient } from '../../generated/prisma/client.js';
import { normalizeLeadPhone } from './lead-phone.js';

async function* leads(database: PrismaClient) {
  let cursor: string | undefined;
  while (true) {
    const page = await database.lead.findMany({
      where: cursor ? { id: { gt: cursor } } : {},
      orderBy: { id: 'asc' },
      take: 200,
      select: { id: true, phone: true, phoneCanonical: true },
    });
    if (!page.length) return;
    yield* page;
    cursor = page.at(-1)!.id;
  }
}
export async function backfillLeadPhoneCanonical(
  database: PrismaClient,
): Promise<void> {
  for await (const lead of leads(database)) {
    const expected = lead.phone ? normalizeLeadPhone(lead.phone) : null;
    if (expected !== lead.phoneCanonical)
      await database.$executeRaw`UPDATE Lead SET phoneCanonical=${expected} WHERE id=${lead.id} AND phone IS ${lead.phone}`;
  }
  await verifyLeadPhoneCanonical(database);
}
export async function verifyLeadPhoneCanonical(
  database: PrismaClient,
): Promise<void> {
  for await (const lead of leads(database))
    if (
      lead.phoneCanonical !==
      (lead.phone ? normalizeLeadPhone(lead.phone) : null)
    )
      throw new Error(
        'Lead phone identity data is inconsistent; stop writes and run bun run db:migrate',
      );
}
