import type { Prisma } from '../../generated/prisma/client.js';
import type {
  Database,
  Transaction,
} from '../../infrastructure/database/transaction.js';
import type { Actor } from '../leads/leads.repository.js';
import type { ListQuery } from './tasks.schema.js';
export const taskSelect = {
  id: true,
  leadId: true,
  title: true,
  notes: true,
  dueAt: true,
  status: true,
  version: true,
  completedAt: true,
  cancelledAt: true,
  createdAt: true,
  updatedAt: true,
  lead: {
    select: {
      id: true,
      name: true,
      assignedAgent: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.TaskSelect;
export type TaskRecord = Prisma.TaskGetPayload<{ select: typeof taskSelect }>;
const scope = (actor: Actor): Prisma.TaskWhereInput =>
  actor.role === 'agent' ? { lead: { assignedAgentId: actor.id } } : {};
export function createTaskRepository(database: Database) {
  return {
    lock(id: string, tx: Transaction) {
      return tx.$executeRaw`UPDATE Task SET version=version WHERE id=${id}`;
    },
    lockSubmission(id: string, tx: Transaction) {
      return tx.$executeRaw`UPDATE Task SET version=version WHERE submissionId=${id}`;
    },
    find(id: string, actor: Actor, tx: Transaction = database) {
      return tx.task.findFirst({
        where: { id, ...scope(actor) },
        select: taskSelect,
      });
    },
    receipt(submissionId: string, tx: Transaction) {
      return tx.task.findUnique({
        where: { submissionId },
        select: { id: true, actorScope: true, payloadHash: true },
      });
    },
    create(data: Prisma.TaskUncheckedCreateInput, tx: Transaction) {
      return tx.task.create({
        data: {
          submissionId: data.submissionId,
          actorScope: data.actorScope,
          payloadHash: data.payloadHash,
          leadId: data.leadId,
          title: data.title,
          notes: data.notes ?? null,
          dueAt: data.dueAt,
          createdById: data.createdById ?? null,
        },
        select: taskSelect,
      });
    },
    update(
      id: string,
      version: number,
      actor: Actor,
      data: {
        title?: string;
        notes?: string | null;
        dueAt?: Date;
        status?: string;
        completedAt?: Date;
        cancelledAt?: Date;
      },
      tx: Transaction,
    ) {
      return tx.task.updateMany({
        where: { id, version, status: 'open', ...scope(actor) },
        data: {
          ...(data.title !== undefined ? { title: data.title } : {}),
          ...(data.notes !== undefined ? { notes: data.notes } : {}),
          ...(data.dueAt !== undefined ? { dueAt: data.dueAt } : {}),
          ...(data.status !== undefined ? { status: data.status } : {}),
          ...(data.completedAt !== undefined
            ? { completedAt: data.completedAt }
            : {}),
          ...(data.cancelledAt !== undefined
            ? { cancelledAt: data.cancelledAt }
            : {}),
          version: { increment: 1 },
        },
      });
    },
    async list(query: ListQuery, actor: Actor, asOf: Date, tx: Transaction) {
      const dubaiDay = new Date(
        Math.floor((asOf.getTime() + 4 * 3600000) / 86400000) * 86400000 -
          4 * 3600000,
      );
      const dueAt =
        query.due === 'overdue'
          ? { lt: asOf }
          : query.due === 'upcoming'
            ? { gte: asOf }
            : query.due === 'today'
              ? { gte: dubaiDay, lt: new Date(dubaiDay.getTime() + 86400000) }
              : undefined;
      const where: Prisma.TaskWhereInput = {
        ...scope(actor),
        ...(query.leadId ? { leadId: query.leadId } : {}),
        ...(query.status !== 'all' ? { status: query.status } : {}),
        ...(dueAt ? { dueAt } : {}),
      };
      const items = await tx.task.findMany({
        where,
        select: taskSelect,
        orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      });
      const total = await tx.task.count({ where });
      return { items, total, page: query.page, pageSize: query.pageSize };
    },
  };
}
