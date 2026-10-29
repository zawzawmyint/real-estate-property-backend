import type { Database } from '../../infrastructure/database/transaction.js';
import type { Actor } from '../leads/leads.repository.js';
import { createDashboardRepository } from './dashboard.repository.js';
import { sources, stages, type DashboardSummary } from './dashboard.dto.js';
export function createDashboardService(
  database: Database,
  clock: () => Date = () => new Date(),
) {
  const repository = createDashboardRepository();
  return {
    async summary(actor: Actor): Promise<DashboardSummary> {
      const generatedAt = clock();
      // Dubai is UTC+4 year round. Shift to local date before finding Monday.
      const local = new Date(generatedAt.getTime() + 4 * 3600000);
      const monday = new Date(
        Date.UTC(
          local.getUTCFullYear(),
          local.getUTCMonth(),
          local.getUTCDate() - ((local.getUTCDay() + 6) % 7),
        ),
      );
      const weekStart = new Date(monday.getTime() - 4 * 3600000);
      const weekEndExclusive = new Date(weekStart.getTime() + 7 * 86400000);
      const scope = actor.role === 'agent' ? 'mine' : 'agency';
      const where = {
        createdAt: { lte: generatedAt },
        ...(scope === 'mine' ? { assignedAgentId: actor.id } : {}),
      };
      // All four bounded aggregates use one SQLite read snapshot; no write lock is needed.
      const result = await database.$transaction((tx) =>
        repository.aggregate(tx, where, weekStart, weekEndExclusive),
      );
      const wonLeads =
        result.byStage.find((row) => row.stage === 'won')?._count._all ?? 0;
      return {
        generatedAt: generatedAt.toISOString(),
        scope,
        timezone: 'Asia/Dubai',
        weekStart: weekStart.toISOString(),
        weekEndExclusive: weekEndExclusive.toISOString(),
        totalLeads: result.totalLeads,
        newLeadsThisWeek: result.newLeadsThisWeek,
        wonLeads,
        conversionRatePercent:
          result.totalLeads === 0
            ? null
            : Math.round((wonLeads / result.totalLeads) * 1000) / 10,
        leadsBySource: sources.map((source) => ({
          source,
          count:
            result.bySource.find((row) => row.source === source)?._count._all ??
            0,
        })),
        pipelineByStage: stages.map((stage) => ({
          stage,
          count:
            result.byStage.find((row) => row.stage === stage)?._count._all ?? 0,
        })),
      };
    },
  };
}
export type DashboardService = ReturnType<typeof createDashboardService>;
