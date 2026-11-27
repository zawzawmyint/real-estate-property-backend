import type { Transaction } from '../../infrastructure/database/transaction.js';
import {
  changesFor,
  type RecordChange,
  type Summary,
  type Identity,
  type ImportGroup,
} from './audit-log.changes.js';
import { insertEvent } from './audit-log.repository.js';

function label(input: RecordChange | Summary) {
  if (input.entityType === 'import')
    return input.import.kind + ' import ' + input.entityId;
  if (input.entityType === 'property') {
    const title =
      input.label ??
      (input.after as { title?: string } | undefined)?.title ??
      (input.before as { title?: string } | undefined)?.title;
    if (title) return Array.from(title).slice(0, 160).join('');
  }
  return (
    input.entityType[0]!.toUpperCase() +
    input.entityType.slice(1) +
    ' ' +
    input.entityId
  );
}

export async function appendAuditEvent(
  tx: Transaction,
  input: RecordChange | Summary,
): Promise<void> {
  if (!input.action.startsWith(input.entityType + '.'))
    throw new Error('Invalid audit target');

  const changes = input.entityType === 'import' ? [] : changesFor(input);
  if (
    !changes.length &&
    input.entityType !== 'import' &&
    !input.action.endsWith('.created') &&
    !input.action.endsWith('.deleted')
  )
    return;

  const actor = input.actor;
  if (!actor && input.entityType !== 'import' && !input.source)
    throw new Error('Missing audit source');

  await insertEvent(tx, {
    occurredAt: new Date(),
    actorKind: actor ? 'staff' : (input as RecordChange).source!,
    actorId: actor?.id ?? null,
    actorName: actor?.name ?? null,
    actorRole: actor?.role ?? null,
    entityType: input.entityType,
    entityId: input.entityId,
    entityLabel: label(input),
    action: input.action,
    changesJson: JSON.stringify(changes),
    importId: input.import?.id ?? null,
    importKind: input.import?.kind ?? null,
    createdCount:
      input.entityType === 'import' ? input.import.createdCount : null,
  });
}

export function recordAuditChange(tx: Transaction, input: RecordChange) {
  return appendAuditEvent(tx, input);
}

export function appendImportCompleted(
  tx: Transaction,
  input: ImportGroup & { actor: Identity; createdCount: number },
) {
  return appendAuditEvent(tx, {
    entityType: 'import',
    entityId: input.id,
    action: 'import.completed',
    actor: input.actor,
    import: {
      id: input.id,
      kind: input.kind,
      createdCount: input.createdCount,
    },
  });
}
