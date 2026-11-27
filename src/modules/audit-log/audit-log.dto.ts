import type { listEvents } from './audit-log.repository.js';
import { decodeChanges } from './audit-log.changes.js';

export function auditLogDto(result: Awaited<ReturnType<typeof listEvents>>) {
  return {
    items: result.rows.map((row) => ({
      id: row.id,
      schemaVersion: row.schemaVersion,
      occurredAt: row.occurredAt.toISOString(),
      actor: {
        kind: row.actorKind,
        id: row.actorId,
        name: row.actorName,
        role: row.actorRole,
      },
      entity: {
        type: row.entityType,
        id: row.entityId,
        label: row.entityLabel,
        available: result.available.has(row.entityType + ':' + row.entityId),
      },
      action: row.action,
      changes: decodeChanges(row.action, row.changesJson),
      import: row.importId
        ? {
            id: row.importId,
            kind: row.importKind,
            createdCount: row.createdCount,
          }
        : null,
    })),
    page: result.page,
    pageSize: result.pageSize,
    total: result.total,
    coverage: {
      startedAt: result.coverage.startedAt.toISOString(),
      version: result.coverage.coverageVersion,
      historicalBackfill: false,
    },
  };
}
