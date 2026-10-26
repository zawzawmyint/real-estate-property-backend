import { Prisma } from '../../generated/prisma/client.js';
import type {
  Database,
  Transaction,
} from '../properties/properties.repository.js';
import { foldSearch } from '../properties/property-search.js';
import type { CandidateQuery, ListQuery } from './leads.schema.js';

export type Actor = {
  id: string;
  name: string;
  role: 'admin' | 'manager' | 'agent';
  sessionId: string;
};
const userSelect = {
  id: true,
  name: true,
  role: true,
  disabled: true,
  banned: true,
} as const;

export const leadSelect = {
  id: true,
  name: true,
  phone: true,
  email: true,
  purpose: true,
  budgetFils: true,
  source: true,
  stage: true,
  propertyId: true,
  propertyTitleSnapshot: true,
  propertyLocationSnapshot: true,
  assignedAgentId: true,
  assignedAgentNameSnapshot: true,
  originalMessage: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  assignedAgent: { select: userSelect },
  property: {
    select: {
      id: true,
      title: true,
      city: true,
      community: true,
      purpose: true,
      publishingState: true,
      availability: true,
    },
  },
} satisfies Prisma.LeadSelect;

export const activitySelect = {
  id: true,
  type: true,
  actorId: true,
  actorNameSnapshot: true,
  createdAt: true,
  note: { select: { id: true, kind: true, body: true } },
  previousStage: true,
  nextStage: true,
  previousAgentId: true,
  previousAgentName: true,
  nextAgentId: true,
  nextAgentName: true,
  changedFields: true,
} satisfies Prisma.LeadActivitySelect;

export type LeadRecord = Prisma.LeadGetPayload<{ select: typeof leadSelect }>;

export type ActivityRecord = Prisma.LeadActivityGetPayload<{
  select: typeof activitySelect;
}>;

export const phoneSearch = (value: string | null | undefined) =>
  (value ?? '').replace(/\D/g, '');

export const leadSearch = (value: {
  name: string;
  phone: string | null;
  email: string | null;
  propertyTitleSnapshot: string | null;
}) => ({
  searchName: foldSearch(value.name),
  searchPhone: phoneSearch(value.phone),
  searchEmail: foldSearch(value.email),
  searchPropertyTitle: foldSearch(value.propertyTitleSnapshot),
});

export function createLeadRepository(database: Database) {
  return {
    lock(id: string, tx: Transaction) {
      return tx.$executeRaw`UPDATE Lead SET version=version WHERE id=${id}`;
    },

    lockUser(id: string, tx: Transaction) {
      return tx.$executeRaw`UPDATE User SET id=id WHERE id=${id}`;
    },

    lockProperty(id: string, tx: Transaction) {
      return tx.$executeRaw`UPDATE Property SET id=id WHERE id=${id}`;
    },

    actor(actor: Actor, tx: Transaction) {
      return tx.session.findFirst({
        where: {
          id: actor.sessionId,
          userId: actor.id,
          expiresAt: { gt: new Date() },
        },
        select: {
          credentialVersion: true,
          user: { select: { ...userSelect, credentialVersion: true } },
        },
      });
    },

    find(id: string, actor: Actor | undefined, tx: Transaction = database) {
      return tx.lead.findFirst({
        where: {
          id,
          ...(actor?.role === 'agent' ? { assignedAgentId: actor.id } : {}),
        },
        select: leadSelect,
      });
    },

    property(id: string, tx: Transaction) {
      return tx.property.findUnique({
        where: { id },
        select: {
          id: true,
          title: true,
          city: true,
          community: true,
          purpose: true,
          publishingState: true,
          availability: true,
        },
      });
    },

    agent(id: string, tx: Transaction) {
      return tx.user.findUnique({ where: { id }, select: userSelect });
    },

    receipt(id: string, tx: Transaction) {
      return tx.leadSubmissionReceipt.findUnique({ where: { id } });
    },

    saveReceipt(
      data: Prisma.LeadSubmissionReceiptUncheckedCreateInput,
      tx: Transaction,
    ) {
      return tx.leadSubmissionReceipt.create({ data });
    },

    create(data: Prisma.LeadUncheckedCreateInput, tx: Transaction) {
      return tx.lead.create({ data, select: leadSelect });
    },

    update(
      id: string,
      version: number,
      actor: Actor,
      data: Prisma.LeadUncheckedUpdateManyInput,
      tx: Transaction,
    ) {
      return tx.lead.updateMany({
        where: {
          id,
          version,
          ...(actor.role === 'agent' ? { assignedAgentId: actor.id } : {}),
        },
        data: { ...data, version: { increment: 1 }, updatedAt: new Date() },
      });
    },

    event(data: Prisma.LeadActivityUncheckedCreateInput, tx: Transaction) {
      return tx.leadActivity.create({ data, select: activitySelect });
    },

    note(data: Prisma.LeadNoteUncheckedCreateInput, tx: Transaction) {
      return tx.leadNote.create({ data, select: { id: true } });
    },

    noteActivity(noteId: string, tx: Transaction) {
      return tx.leadActivity.findUnique({
        where: { noteId },
        select: activitySelect,
      });
    },

    async activity(id: string, page: number, tx: Transaction) {
      const where = { leadId: id };
      const items = await tx.leadActivity.findMany({
        where,
        select: activitySelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * 20,
        take: 20,
      });
      const total = await tx.leadActivity.count({ where });
      return { items, total, page, pageSize: 20 as const };
    },

    async list(query: ListQuery, actor: Actor, tx: Transaction) {
      const clauses: Prisma.Sql[] = [Prisma.sql`1=1`];
      const view =
        query.view ?? (actor.role === 'agent' ? 'mine' : 'unassigned');
      if (view === 'mine')
        clauses.push(Prisma.sql`assignedAgentId=${actor.id}`);
      if (view === 'unassigned')
        clauses.push(Prisma.sql`assignedAgentId IS NULL`);
      if (query.agentId)
        clauses.push(Prisma.sql`assignedAgentId=${query.agentId}`);
      if (query.stage) clauses.push(Prisma.sql`stage=${query.stage}`);
      if (query.source) clauses.push(Prisma.sql`source=${query.source}`);
      if (query.q) {
        const text = foldSearch(query.q),
          phone = phoneSearch(query.q);
        clauses.push(
          Prisma.sql`(instr(searchName,${text})>0 OR instr(searchEmail,${text})>0 OR instr(searchPropertyTitle,${text})>0 ${phone ? Prisma.sql`OR instr(searchPhone,${phone})>0` : Prisma.empty})`,
        );
      }
      const where = Prisma.join(clauses, ' AND '),
        order =
          query.sort === 'oldest'
            ? Prisma.sql`createdAt ASC,id ASC`
            : query.sort === 'updated'
              ? Prisma.sql`updatedAt DESC,id DESC`
              : Prisma.sql`createdAt DESC,id DESC`;
      const counts = await tx.$queryRaw<
        Array<{ total: bigint }>
      >`SELECT COUNT(*) AS total FROM Lead WHERE ${where}`;
      const rows = await tx.$queryRaw<
        Array<{ id: string }>
      >`SELECT id FROM Lead WHERE ${where} ORDER BY ${order} LIMIT 20 OFFSET ${(query.page - 1) * 20}`;
      const items = await tx.lead.findMany({
        where: { id: { in: rows.map((row) => row.id) } },
        select: leadSelect,
        take: 20,
      });
      const ordered = rows.map((row) =>
        items.find((item) => item.id === row.id)!,
      );
      const unassignedCount =
        actor.role === 'agent'
          ? null
          : await tx.lead.count({ where: { assignedAgentId: null } });
      return {
        items: ordered,
        total: Number(counts[0]!.total),
        page: query.page,
        pageSize: 20 as const,
        unassignedCount,
      };
    },

    async candidates(query: CandidateQuery, tx: Transaction) {
      const term = foldSearch(query.q ?? '');
      const predicate = Prisma.sql`role='agent' AND disabled=false AND (banned=false OR banned IS NULL) AND instr(searchName,${term})>0`;
      const counts = await tx.$queryRaw<
        Array<{ total: bigint }>
      >`SELECT COUNT(*) AS total FROM User WHERE ${predicate}`;
      const items = await tx.$queryRaw<
        Array<{ id: string; name: string }>
      >`SELECT id,name FROM User WHERE ${predicate} ORDER BY searchName ASC,id ASC LIMIT 20 OFFSET ${(query.page - 1) * 20}`;
      return {
        items: items.map((user) => ({
          id: user.id,
          name: user.name,
          available: true,
        })),
        total: Number(counts[0]!.total),
        page: query.page,
        pageSize: 20 as const,
      };
    },
  };
}
