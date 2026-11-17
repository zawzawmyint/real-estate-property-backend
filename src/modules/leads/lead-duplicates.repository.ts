import type { Transaction } from '../../infrastructure/database/transaction.js';
import type { Actor } from './leads.repository.js';

export function duplicateMatches(
  phones: string[],
  actor: Actor,
  tx: Transaction,
) {
  if (!phones.length) return Promise.resolve([]);
  return tx.lead.findMany({
    where: {
      phoneCanonical: { in: phones },
      ...(actor.role === 'agent' ? { assignedAgentId: actor.id } : {}),
    },
    select: {
      id: true,
      name: true,
      phone: true,
      phoneCanonical: true,
      stage: true,
      createdAt: true,
      assignedAgent: {
        select: {
          id: true,
          name: true,
          role: true,
          disabled: true,
          banned: true,
        },
      },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
}
export async function duplicateCounts(
  phones: string[],
  actor: Actor,
  tx: Transaction,
) {
  return tx.lead.groupBy({
    by: ['phoneCanonical'],
    where: {
      phoneCanonical: { in: phones },
      ...(actor.role === 'agent' ? { assignedAgentId: actor.id } : {}),
    },
    _count: { _all: true },
  });
}
export type DuplicateMatch = Awaited<
  ReturnType<typeof duplicateMatches>
>[number];
