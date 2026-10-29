import type { TaskRecord } from './tasks.repository.js';
export function taskDto(row: TaskRecord, asOf: Date) {
  return {
    id: row.id,
    lead: { id: row.lead.id, name: row.lead.name },
    assignedAgent: row.lead.assignedAgent
      ? { id: row.lead.assignedAgent.id, name: row.lead.assignedAgent.name }
      : null,
    title: row.title,
    notes: row.notes,
    dueAt: row.dueAt.toISOString(),
    status: row.status,
    isOverdue: row.status === 'open' && row.dueAt < asOf,
    completedAt: row.completedAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
export type TaskDto = ReturnType<typeof taskDto>;
