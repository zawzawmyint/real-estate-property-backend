import type { ViewingRecord } from './viewings.repository.js';
export function viewingDto(row: ViewingRecord) {
  return {
    id: row.id,
    lead: { id: row.lead.id, name: row.lead.name },
    property: {
      id: row.property.id,
      title: row.property.title || row.propertyTitleSnapshot,
      location:
        [row.property.community, row.property.city]
          .filter(Boolean)
          .join(', ') || row.propertyLocationSnapshot,
      bookable:
        row.property.publishingState === 'published' &&
        row.property.availability === 'available',
    },

    assignedAgent: row.lead.assignedAgent
      ? { id: row.lead.assignedAgent.id, name: row.lead.assignedAgent.name }
      : null,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    status: row.status,
    feedback: row.feedback,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
