import { z } from 'zod';
import type { Actor } from '../leads/leads.repository.js';

const propertyFields = [
  'title',
  'type',
  'purpose',
  'priceFils',
  'city',
  'community',
  'bedrooms',
  'bathrooms',
  'areaHundredths',
  'publishingState',
  'availability',
  'featured',
  'isDemo',
  'ownerName',
  'ownerPhone',
  'description',
];
const leadFields = [
  'name',
  'phone',
  'email',
  'originalMessage',
  'purpose',
  'budgetFils',
  'source',
  'propertyId',
  'assignedAgentId',
  'stage',
  'temperature',
  'propertyTitleSnapshot',
  'propertyLocationSnapshot',
  'assignedAgentNameSnapshot',
];
const viewingFields = [
  'leadId',
  'propertyId',
  'startsAt',
  'endsAt',
  'status',
  'feedback',
];
const taskFields = ['leadId', 'dueAt', 'status', 'title', 'notes'];
const sensitive = new Set([
  'ownerName',
  'ownerPhone',
  'description',
  'name',
  'phone',
  'email',
  'originalMessage',
  'propertyTitleSnapshot',
  'propertyLocationSnapshot',
  'assignedAgentNameSnapshot',
  'feedback',
  'notes',
  'body',
]);
const fieldsByAction = {
  'property.created': propertyFields,
  'property.updated': propertyFields,
  'property.deleted': propertyFields,
  'property.photo_added': ['photoIds'],
  'property.photo_removed': ['photoIds'],
  'property.photos_reordered': ['photoIds'],
  'lead.created': leadFields,
  'lead.updated': leadFields,
  'lead.assigned': ['assignedAgentId', 'assignedAgentNameSnapshot'],
  'lead.stage_changed': ['stage'],
  'lead.temperature_changed': ['temperature'],
  'lead.note_added': ['body'],
  'lead.call_logged': ['body'],
  'viewing.created': viewingFields,
  'viewing.rescheduled': ['startsAt', 'endsAt'],
  'viewing.cancelled': ['status'],
  'viewing.completed': ['status', 'feedback'],
  'task.created': taskFields,
  'task.updated': ['dueAt', 'title', 'notes'],
  'task.completed': ['status'],
  'task.cancelled': ['status'],
  'import.completed': [],
};
export type AuditAction = keyof typeof fieldsByAction;
export const actions = Object.keys(fieldsByAction) as AuditAction[];
export type Identity = Pick<Actor, 'id' | 'name' | 'role'>;
export type ImportGroup = { id: string; kind: 'property' | 'lead' };
export type RecordChange = {
  actor: Identity | null;
  source?: 'website' | 'system';
  entityType: 'property' | 'lead' | 'viewing' | 'task';
  entityId: string;
  label?: string;
  action: Exclude<AuditAction, 'import.completed'>;
  before?: object;
  after?: object;
  import?: ImportGroup;
};
export type Summary = {
  actor: Identity;
  entityType: 'import';
  entityId: string;
  action: 'import.completed';
  import: ImportGroup & { createdCount: number };
};

const uuid = z.uuid();
const scalar = z.union([
  z.null(),
  z.boolean(),
  z.number(),
  z.string(),
  z.array(uuid),
]);
const valueChange = z.strictObject({
  field: z.string(),
  redacted: z.literal(false),
  before: scalar,
  after: scalar,
});
const marker = z.strictObject({ field: z.string(), redacted: z.literal(true) });

type Change = z.infer<typeof marker> | z.infer<typeof valueChange>;

function isSensitive(field: string, action: AuditAction) {
  return (
    sensitive.has(field) || (field === 'title' && action.startsWith('task.'))
  );
}

function value(field: string, raw: unknown) {
  if (raw == null) return null;
  if (field === 'priceFils' || field === 'budgetFils')
    return z.string().regex(/^\d+$/).parse(String(raw));
  if (['dueAt', 'startsAt', 'endsAt'].includes(field))
    return new Date(z.union([z.date(), z.string()]).parse(raw)).toISOString();
  if (field === 'photoIds') return z.array(uuid).parse(raw);
  if (['bedrooms', 'bathrooms', 'areaHundredths'].includes(field))
    return z.number().int().parse(raw);
  if (['featured', 'isDemo'].includes(field)) return z.boolean().parse(raw);
  return z.string().parse(raw);
}

export function decodeChanges(action: string, json: string): Change[] {
  if (!Object.hasOwn(fieldsByAction, action))
    throw new Error('Unsupported audit action');

  const key = action as AuditAction;
  return z
    .array(z.union([marker, valueChange]))
    .parse(JSON.parse(json))
    .map((change) => {
      if (
        !(fieldsByAction[key] as readonly string[]).includes(change.field) ||
        isSensitive(change.field, key) !== change.redacted
      )
        throw new Error('Invalid audit change');
      if (change.redacted) return change;
      return {
        ...change,
        before: value(change.field, change.before),
        after: value(change.field, change.after),
      };
    });
}

export function changesFor(input: RecordChange): Change[] {
  const before = (input.before ?? {}) as Record<string, unknown>,
    after = (input.after ?? {}) as Record<string, unknown>;

  const changes: Change[] = [];
  for (const field of fieldsByAction[input.action]) {
    if (field === 'body') {
      changes.push({ field, redacted: true });
      continue;
    }
    const previous = before[field] ?? null,
      next = after[field] ?? null;
    if (isSensitive(field, input.action)) {
      if (previous !== next) changes.push({ field, redacted: true });
    } else {
      const a = value(field, previous),
        b = value(field, next);
      if (JSON.stringify(a) !== JSON.stringify(b))
        changes.push({ field, redacted: false, before: a, after: b });
    }
  }

  return changes;
}
