import type { ActivityRecord, LeadRecord } from './leads.repository.js';

export const eligibleAgent = (
  user: { role: string; disabled: boolean; banned: boolean | null } | null,
) => Boolean(user && user.role === 'agent' && !user.disabled && !user.banned);

export function leadDto(lead: LeadRecord, detail = false) {
  return {
    id: lead.id,
    name: lead.name,
    phone: lead.phone,
    email: lead.email,
    purpose: lead.purpose as 'sale' | 'rent',
    budgetFils: lead.budgetFils === null ? null : Number(lead.budgetFils),
    source: lead.source as 'website' | 'call' | 'walk_in',
    stage: lead.stage as
      'new' | 'contacted' | 'viewing_scheduled' | 'offer' | 'won' | 'lost',
    assignedAgent: lead.assignedAgent
      ? {
          id: lead.assignedAgent.id,
          name: lead.assignedAgent.name,
          available: eligibleAgent(lead.assignedAgent),
        }
      : null,
    previousAgentName:
      lead.assignedAgentId === null ? lead.assignedAgentNameSnapshot : null,
    property: lead.propertyTitleSnapshot
      ? {
          id: lead.propertyId,
          title: lead.propertyTitleSnapshot,
          location: lead.propertyLocationSnapshot,
          available: Boolean(
            lead.property &&
            ['draft', 'published'].includes(lead.property.publishingState) &&
            lead.property.availability === 'available' &&
            lead.property.purpose === lead.purpose,
          ),
        }
      : null,
    createdAt: lead.createdAt.toISOString(),
    updatedAt: lead.updatedAt.toISOString(),
    version: lead.version,
    ...(detail ? { originalMessage: lead.originalMessage } : {}),
  };
}
export function activityDto(event: ActivityRecord) {
  const assignment =
    event.type === 'assigned' ||
    event.type === 'unassigned' ||
    (event.type === 'created' && event.nextAgentId !== null);
  return {
    id: event.id,
    type: event.type as
      | 'created'
      | 'assigned'
      | 'unassigned'
      | 'stage_changed'
      | 'details_updated'
      | 'note_added'
      | 'call_logged',
    actor:
      event.actorId || event.actorNameSnapshot
        ? { id: event.actorId, name: event.actorNameSnapshot ?? 'Former staff' }
        : null,
    createdAt: event.createdAt.toISOString(),
    note: event.note,
    assignment: assignment
      ? {
          from:
            event.previousAgentId || event.previousAgentName
              ? {
                  id: event.previousAgentId,
                  name: event.previousAgentName ?? 'Former staff',
                }
              : null,
          to:
            event.nextAgentId || event.nextAgentName
              ? {
                  id: event.nextAgentId,
                  name: event.nextAgentName ?? 'Former staff',
                }
              : null,
        }
      : null,
    stageChange:
      event.previousStage && event.nextStage
        ? { from: event.previousStage, to: event.nextStage }
        : null,
    changedFields: JSON.parse(event.changedFields) as string[],
  };
}
