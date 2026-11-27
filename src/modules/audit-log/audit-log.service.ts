import {
  serializedTransaction,
  type Database,
  type Transaction,
} from '../../infrastructure/database/transaction.js';
import { requireCurrentStaff } from '../auth/staff-actor.js';
import type { Actor } from '../leads/leads.repository.js';
import { AppError } from '../../shared/errors/app-error.js';
import { listEvents, listActors } from './audit-log.repository.js';
import type { ListQuery, ActorQuery } from './audit-log.schema.js';

export function createAuditLogService(database: Database) {
  function authorized<T>(
    identity: Actor,
    read: (tx: Transaction) => Promise<T>,
  ) {
    return serializedTransaction(database, async (tx) => {
      const actor = await requireCurrentStaff(identity, tx);

      if (actor.role !== 'admin' && actor.role !== 'manager')
        throw new AppError(403, 'FORBIDDEN', 'Access denied');

      return read(tx);
    });
  }

  return {
    // Resolve filters only after live transaction authorization, including parse errors.
    list: (query: () => ListQuery, identity: Actor) =>
      authorized(identity, (tx) => listEvents(tx, query())),

    actors: (query: () => ActorQuery, identity: Actor) =>
      authorized(identity, (tx) => listActors(tx, query())),
  };
}
