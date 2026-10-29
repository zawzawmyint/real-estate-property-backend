import type { Prisma } from '../../generated/prisma/client.js';
import type {
  Database,
  Transaction,
} from '../../infrastructure/database/transaction.js';
import type { Actor } from '../leads/leads.repository.js';
import type { ListQuery } from './viewings.schema.js';
export const viewingSelect = {
  id: true,
  leadId: true,
  propertyId: true,
  startsAt: true,
  endsAt: true,
  status: true,
  feedback: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  propertyTitleSnapshot: true,
  propertyLocationSnapshot: true,
  lead: {
    select: {
      id: true,
      name: true,
      assignedAgentId: true,
      assignedAgent: { select: { id: true, name: true } },
    },
  },
  property: {
    select: {
      id: true,
      title: true,
      city: true,
      community: true,
      publishingState: true,
      availability: true,
    },
  },
} satisfies Prisma.ViewingSelect;
export type ViewingRecord = Prisma.ViewingGetPayload<{
  select: typeof viewingSelect;
}>;
const scope = (actor: Actor): Prisma.ViewingWhereInput =>
  actor.role === 'agent' ? { lead: { assignedAgentId: actor.id } } : {};

export function createViewingRepository(database: Database) {
  return {
    lock(id: string, tx: Transaction) {
      return tx.$executeRaw`UPDATE Viewing SET version=version WHERE id=${id}`;
    },

    lockSubmission(id: string, tx: Transaction) {
      return tx.$executeRaw`UPDATE Viewing SET version=version WHERE submissionId=${id}`;
    },

    find(id: string, actor: Actor, tx: Transaction = database) {
      return tx.viewing.findFirst({
        where: { id, ...scope(actor) },
        select: viewingSelect,
      });
    },

    receipt(submissionId: string, tx: Transaction) {
      return tx.viewing.findUnique({
        where: { submissionId },
        select: { id: true, actorScope: true, payloadHash: true },
      });
    },

    create(data: Prisma.ViewingUncheckedCreateInput, tx: Transaction) {
      return tx.viewing.create({
        data: {
          submissionId: data.submissionId,
          actorScope: data.actorScope,
          payloadHash: data.payloadHash,
          leadId: data.leadId,
          propertyId: data.propertyId,
          startsAt: data.startsAt,
          endsAt: data.endsAt,
          createdById: data.createdById ?? null,
          propertyTitleSnapshot: data.propertyTitleSnapshot,
          propertyLocationSnapshot: data.propertyLocationSnapshot ?? null,
        },

        select: viewingSelect,
      });
    },

    update(
      id: string,
      version: number,
      actor: Actor,
      data: {
        startsAt?: Date;
        endsAt?: Date;
        status?: string;
        feedback?: string;
      },

      tx: Transaction,
    ) {
      return tx.viewing.updateMany({
        where: { id, version, status: 'scheduled', ...scope(actor) },
        data: {
          ...(data.startsAt !== undefined ? { startsAt: data.startsAt } : {}),
          ...(data.endsAt !== undefined ? { endsAt: data.endsAt } : {}),
          ...(data.status !== undefined ? { status: data.status } : {}),
          ...(data.feedback !== undefined ? { feedback: data.feedback } : {}),
          version: { increment: 1 },
        },
      });
    },

    async list(query: ListQuery, actor: Actor, tx: Transaction) {
      const where: Prisma.ViewingWhereInput = {
        ...scope(actor),
        startsAt: { gte: new Date(query.from), lt: new Date(query.to) },
        ...(query.leadId ? { leadId: query.leadId } : {}),
        ...(query.status ? { status: query.status } : {}),
      };
      const items = await tx.viewing.findMany({
        where,
        select: viewingSelect,
        orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      });
      const total = await tx.viewing.count({ where });
      return { items, total, page: query.page, pageSize: query.pageSize };
    },
  };
}
