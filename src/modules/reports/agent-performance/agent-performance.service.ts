import type { Database } from '../../../infrastructure/database/transaction.js';
import { AppError } from '../../../shared/errors/app-error.js';
import { requireCurrentStaff } from '../../auth/staff-actor.js';
import type { Actor } from '../../leads/leads.repository.js';
import {
  calculateAgentPerformance,
  emptyAgentMetrics,
} from './agent-performance.metrics.js';
import {
  currentAgents,
  historicalNames,
  identityLimit,
  reportHistory,
  reportTooLarge,
  usersById,
} from './agent-performance.repository.js';
import {
  performanceRange,
  type parsePerformanceQuery,
} from './agent-performance.schema.js';

type Identity = {
  id: string;
  name: string;
  availability: 'active' | 'inactive' | 'former';
};

function safeIdentity(
  user: Awaited<ReturnType<typeof currentAgents>>[number],
): Identity {
  return {
    id: user.id,
    name: user.name,
    availability:
      user.role === 'agent' && !user.disabled && !user.banned
        ? 'active'
        : 'inactive',
  };
}

// Ordinal UTF-16 code-unit comparison is stable across locales and hosts.
function compare(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function createAgentPerformanceService(
  database: Database,
  clock: () => Date = () => new Date(),
) {
  return {
    async report(
      identity: Actor,
      query: ReturnType<typeof parsePerformanceQuery>,
    ) {
      const generatedAt = clock();
      return database.$transaction(
        async (tx) => {
          const actor = await requireCurrentStaff(identity, tx);
          if (
            actor.role === 'agent' &&
            query.agentId !== undefined &&
            query.agentId !== actor.id
          )
            throw new AppError(403, 'FORBIDDEN', 'Access denied');
          const scope = actor.role === 'agent' ? 'mine' : 'agency';
          const selected = scope === 'mine' ? actor.id : query.agentId;
          const range = performanceRange(query, generatedAt);
          const live = await currentAgents(tx, selected);
          if (live.length > identityLimit) reportTooLarge();
          const identities = new Map<string, Identity>(
            live.map((u) => [u.id, safeIdentity(u)]),
          );
          if (selected !== undefined && !identities.has(selected)) {
            const [snapshot] = await historicalNames(tx, range, [selected]);
            if (!snapshot)
              throw new AppError(404, 'NOT_FOUND', 'Agent not found');
            identities.set(selected, {
              id: selected,
              name: snapshot.name ?? 'Former agent',
              availability: 'former',
            });
          }

          const history = await reportHistory(tx, range, selected);
          const { metricsByAgent, coverage } = calculateAgentPerformance({
            ...history,
            ...range,
            ...(selected === undefined ? {} : { selectedAgentId: selected }),
          });
          const extra = [...metricsByAgent.keys()].filter(
            (id) => !identities.has(id),
          );
          if (extra.length + identities.size > identityLimit) reportTooLarge();
          if (extra.length) {
            for (const user of await usersById(tx, extra))
              identities.set(user.id, safeIdentity(user));
            const missing = extra.filter((id) => !identities.has(id));
            if (missing.length) {
              const names = await historicalNames(tx, range, missing);
              for (const { id, name } of names)
                identities.set(id, {
                  id,
                  name: name ?? 'Former agent',
                  availability: 'former',
                });
            }
          }
          const agentOptions = [...identities.values()].sort(
            (a, b) => compare(a.name, b.name) || compare(a.id, b.id),
          );
          const { page, pageSize } = query,
            offset = (page - 1) * pageSize;
          const items = agentOptions
            .slice(offset, offset + pageSize)
            .map((agent) => ({
              agent,
              ...(metricsByAgent.get(agent.id) ?? emptyAgentMetrics()),
            }));
          return {
            generatedAt: generatedAt.toISOString(),
            timezone: 'Asia/Dubai',
            from: range.from,
            to: range.to,
            rangeStart: range.rangeStart.toISOString(),
            rangeEndExclusive: range.rangeEndExclusive.toISOString(),
            asOf: range.asOf.toISOString(),
            scope,
            page,
            pageSize,
            total: agentOptions.length,
            items,
            agentOptions,
            coverage,
          };
        },
        { timeout: 15_000 },
      );
    },
  };
}
