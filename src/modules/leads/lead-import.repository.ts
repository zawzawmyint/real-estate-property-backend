import type { Transaction } from '../../infrastructure/database/transaction.js';
import type { Actor } from './leads.repository.js';
import { leadSearch } from './leads.repository.js';
import type { ImportLead } from './lead-import.schema.js';

export const leadImportRepository = {
  lock(id: string, tx: Transaction) {
    return tx.$executeRaw`UPDATE LeadImportReceipt SET id=id WHERE id=${id}`;
  },
  receipt(id: string, tx: Transaction) {
    return tx.leadImportReceipt.findUnique({ where: { id } });
  },
  create(row: ImportLead, actor: Actor, tx: Transaction) {
    const data = {
      name: row.name,
      phone: row.phone ?? null,
      email: row.email ?? null,
      purpose: row.purpose,
      source: row.source,
      budgetFils: row.budgetFils == null ? null : BigInt(row.budgetFils),
      stage: 'new',
      version: 1,
      createdById: actor.id,
      assignedAgentId: null,
      assignedAgentNameSnapshot: null,
      propertyId: null,
      propertyTitleSnapshot: null,
      propertyLocationSnapshot: null,
      originalMessage: null,
    };
    return tx.lead.create({
      data: { ...data, ...leadSearch(data) },
      select: { id: true },
    });
  },
  activity(leadId: string, actor: Actor, tx: Transaction) {
    return tx.leadActivity.create({
      data: {
        leadId,
        actorId: actor.id,
        actorNameSnapshot: actor.name,
        type: 'created',
      },
      select: { id: true },
    });
  },
  saveReceipt(
    input: {
      id: string;
      actorId: string;
      contentDigest: string;
      leadIds: string[];
    },
    tx: Transaction,
  ) {
    return tx.leadImportReceipt.create({
      data: {
        id: input.id,
        actorId: input.actorId,
        contentDigest: input.contentDigest,
        schemaVersion: 1,
        createdCount: input.leadIds.length,
        leadIdsJson: JSON.stringify(input.leadIds),
      },
    });
  },
};
