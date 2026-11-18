import { Prisma } from '../../generated/prisma/client.js';
import type {
  Database,
  Transaction,
} from '../../infrastructure/database/transaction.js';
import { normalizeSearchText } from '../../shared/search/normalize-search-text.js';
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
  phoneCanonical: true,
  email: true,
  purpose: true,
  budgetFils: true,
  source: true,
  stage: true,
  temperature: true,
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
  previousTemperature: true,
  nextTemperature: true,
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
  searchName: normalizeSearchText(value.name),
  searchPhone: phoneSearch(value.phone),
  searchEmail: normalizeSearchText(value.email),
  searchPropertyTitle: normalizeSearchText(value.propertyTitleSnapshot),
});

function leadPredicate(query: Omit<ListQuery, 'page'>, actor: Actor) {
  const clauses: Prisma.Sql[] = [Prisma.sql`1=1`];
  const view = query.view ?? (actor.role === 'agent' ? 'mine' : 'unassigned');
  if (view === 'mine') clauses.push(Prisma.sql`assignedAgentId=${actor.id}`);
  if (view === 'unassigned') clauses.push(Prisma.sql`assignedAgentId IS NULL`);
  if (query.duplicates)
    clauses.push(
      Prisma.sql`phoneCanonical IS NOT NULL AND EXISTS (SELECT 1 FROM Lead duplicate WHERE duplicate.phoneCanonical=Lead.phoneCanonical AND duplicate.id<>Lead.id ${actor.role === 'agent' ? Prisma.sql`AND duplicate.assignedAgentId=${actor.id}` : Prisma.empty})`,
    );
  if (query.agentId) clauses.push(Prisma.sql`assignedAgentId=${query.agentId}`);
  if (query.stage) clauses.push(Prisma.sql`stage=${query.stage}`);
  if (query.temperature)
    clauses.push(Prisma.sql`temperature=${query.temperature}`);
  if (query.source) clauses.push(Prisma.sql`source=${query.source}`);
  if (query.q) {
    const text = normalizeSearchText(query.q),
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
  return { where, order };
}

export function createLeadRepository(database: Database) {
  return {
    lockSubmission(id: string, tx: Transaction) {
      // Acquire SQLite's write reservation before reading a possibly absent receipt.
      return tx.$executeRaw`UPDATE LeadSubmissionReceipt SET id=id WHERE id=${id}`;
    },

    lock(id: string, tx: Transaction) {
      return tx.$executeRaw`UPDATE Lead SET version=version WHERE id=${id}`;
    },

    lockUser(id: string, tx: Transaction) {
      return tx.$executeRaw`UPDATE User SET id=id WHERE id=${id}`;
    },

    lockProperty(id: string, tx: Transaction) {
      return tx.$executeRaw`UPDATE Property SET id=id WHERE id=${id}`;
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

    activeManagers(tx: Transaction) {
      return tx.user.findMany({
        where: {
          role: { in: ['admin', 'manager'] },
          disabled: false,
          OR: [{ banned: false }, { banned: null }],
        },
        select: { id: true },
      });
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

    async exportRows(
      query: Omit<ListQuery, 'page'>,
      actor: Actor,
      tx: Transaction,
    ) {
      const { where, order } = leadPredicate(query, actor);
      return tx.$queryRaw<
        Array<{
          lead_id: string;
          name: string;
          phone: string | null;
          email: string | null;
          purpose: string;
          budget_aed: bigint | null;
          source: string;
          stage: string;
          assigned_agent_id: string | null;
          assigned_agent_name: string | null;
          property_id: string | null;
          property_title: string | null;
          property_location: string | null;
          created_at_utc: Date | number | string;
          updated_at_utc: Date | number | string;
        }>
      >`
 SELECT l.id AS lead_id,l.name,l.phone,l.email,l.purpose,l.budgetFils AS budget_aed,l.source,l.stage,
 u.id AS assigned_agent_id,COALESCE(u.name,CASE WHEN l.assignedAgentId IS NULL THEN l.assignedAgentNameSnapshot END) AS assigned_agent_name,
 l.propertyId AS property_id,l.propertyTitleSnapshot AS property_title,l.propertyLocationSnapshot AS property_location,l.createdAt AS created_at_utc,l.updatedAt AS updated_at_utc
 FROM (SELECT id,name,phone,email,purpose,budgetFils,source,stage,assignedAgentId,assignedAgentNameSnapshot,propertyId,propertyTitleSnapshot,propertyLocationSnapshot,createdAt,updatedAt FROM Lead WHERE ${where} ORDER BY ${order} LIMIT 5001) l
 LEFT JOIN User u ON u.id=l.assignedAgentId
 ORDER BY ${query.sort === 'oldest' ? Prisma.sql`l.createdAt ASC,l.id ASC` : query.sort === 'updated' ? Prisma.sql`l.updatedAt DESC,l.id DESC` : Prisma.sql`l.createdAt DESC,l.id DESC`}`;
    },

    async list(query: ListQuery, actor: Actor, tx: Transaction) {
      const { where, order } = leadPredicate(query, actor);
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
      const term = normalizeSearchText(query.q ?? '');
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
