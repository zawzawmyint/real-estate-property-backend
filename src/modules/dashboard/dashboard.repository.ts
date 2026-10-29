import type { Prisma } from '../../generated/prisma/client.js';
import type { Transaction } from '../../infrastructure/database/transaction.js';
export function createDashboardRepository() {
  return {
    async aggregate(
      tx: Transaction,
      where: Prisma.LeadWhereInput,
      weekStart: Date,
      weekEndExclusive: Date,
    ) {
      const totalLeads = await tx.lead.count({ where });
      const newLeadsThisWeek = await tx.lead.count({
        where: {
          AND: [where, { createdAt: { gte: weekStart, lt: weekEndExclusive } }],
        },
      });
      const bySource = await tx.lead.groupBy({
        by: ['source'],
        where,
        _count: { _all: true },
      });
      const byStage = await tx.lead.groupBy({
        by: ['stage'],
        where,
        _count: { _all: true },
      });
      return { totalLeads, newLeadsThisWeek, bySource, byStage };
    },
  };
}
