import { createHash } from 'node:crypto';
import { AppError } from '../../shared/errors/app-error.js';
import {
  serializedTransaction,
  type Database,
  type Transaction,
} from '../../infrastructure/database/transaction.js';
import { requireCurrentStaff } from '../auth/staff-actor.js';
import { createLeadRepository, type Actor } from '../leads/leads.repository.js';
import { eligibleAgent } from '../leads/leads.dto.js';
import { createNotificationService } from '../notifications/notifications.service.js';
import {
  createViewingRepository,
  type ViewingRecord,
} from './viewings.repository.js';
import { viewingDto } from './viewings.dto.js';
import type {
  CreateInput,
  RescheduleInput,
  StatusInput,
  ListQuery,
} from './viewings.schema.js';
const missing = () =>
  new AppError(404, 'NOT_FOUND', 'Viewing or lead not found');
const conflict = () =>
  new AppError(409, 'CONFLICT', 'Viewing or lead changed; refresh and review');
export function createViewingService(
  database: Database,
  clock: () => Date = () => new Date(),
  notifications = createNotificationService(database),
) {
  const repository = createViewingRepository(database),
    leads = createLeadRepository(database);
  async function owned(id: string, actor: Actor, tx: Transaction) {
    const row = await repository.find(id, actor, tx);
    if (!row) throw missing();
    return row;
  }

  function times(input: { startsAt: string; endsAt: string }) {
    const startsAt = new Date(input.startsAt),
      endsAt = new Date(input.endsAt),
      duration = endsAt.getTime() - startsAt.getTime();
    if (
      !Number.isFinite(duration) ||
      duration < 15 * 60000 ||
      duration > 240 * 60000 ||
      startsAt <= clock()
    )
      throw new AppError(
        400,
        'VALIDATION_ERROR',
        'Viewing must start in the future and last 15–240 minutes',
      );
    return { startsAt, endsAt };
  }

  async function eligibility(
    leadId: string,
    propertyId: string,
    expected: number,
    actor: Actor,
    tx: Transaction,
  ) {
    const lead = await leads.find(leadId, actor, tx);
    if (!lead) throw missing();
    if (lead.version !== expected) throw conflict();
    if (
      ['won', 'lost'].includes(lead.stage) ||
      !eligibleAgent(lead.assignedAgent)
    )
      throw conflict();
    const property = await leads.property(propertyId, tx);
    if (
      !property ||
      property.publishingState !== 'published' ||
      property.availability !== 'available'
    )
      throw conflict();
    return property;
  }

  async function persist(
    id: string,
    expected: number,
    actor: Actor,
    data: Parameters<typeof repository.update>[3],
    tx: Transaction,
  ) {
    if ((await repository.update(id, expected, actor, data, tx)).count !== 1)
      throw conflict();
    return owned(id, actor, tx);
  }

  function notifyAssignee(
    viewing: ViewingRecord,
    actor: Actor,
    type: 'viewing_rescheduled' | 'viewing_cancelled',
    tx: Transaction,
  ) {
    const recipientId = viewing.lead.assignedAgentId;
    if (!recipientId || recipientId === actor.id) return null;

    return notifications.createNotification(
      {
        recipientId,
        type,
        leadId: viewing.leadId,
        viewingId: viewing.id,
        occurrenceKey: `${type}:${viewing.id}:${viewing.version}`,
      },
      tx,
    );
  }

  return {
    async list(query: ListQuery, identity: Actor) {
      return serializedTransaction(database, async (tx) => {
        const actor = await requireCurrentStaff(identity, tx);
        if (query.leadId && !(await leads.find(query.leadId, actor, tx)))
          throw missing();
        const result = await repository.list(query, actor, tx);
        return { ...result, items: result.items.map(viewingDto) };
      });
    },

    async detail(id: string, identity: Actor) {
      return serializedTransaction(database, async (tx) =>
        viewingDto(
          await owned(id, await requireCurrentStaff(identity, tx), tx),
        ),
      );
    },

    async create(input: CreateInput, identity: Actor) {
      const canonical = {
          leadId: input.leadId,
          propertyId: input.propertyId,
          startsAt: new Date(input.startsAt).toISOString(),
          endsAt: new Date(input.endsAt).toISOString(),
          expectedLeadVersion: input.expectedLeadVersion,
        },
        payloadHash = createHash('sha256')
          .update(JSON.stringify(canonical))
          .digest('hex');
      return serializedTransaction(database, async (tx) => {
        await repository.lockSubmission(input.submissionId, tx);
        const actor = await requireCurrentStaff(identity, tx),
          receipt = await repository.receipt(input.submissionId, tx);
        if (receipt) {
          const row = await owned(receipt.id, actor, tx);
          if (receipt.actorScope !== actor.id) throw conflict();
          if (receipt.payloadHash !== payloadHash)
            return {
              receiptConflict: true as const,
              existingViewingId: row.id,
            };
          return { replay: true, viewing: viewingDto(row) };
        }
        const property = await eligibility(
            input.leadId,
            input.propertyId,
            input.expectedLeadVersion,
            actor,
            tx,
          ),
          dates = times(input);
        const row = await repository.create(
          {
            submissionId: input.submissionId,
            actorScope: actor.id,
            payloadHash,
            leadId: input.leadId,
            propertyId: input.propertyId,
            ...dates,
            createdById: actor.id,
            propertyTitleSnapshot: property.title,
            propertyLocationSnapshot:
              [property.community, property.city].filter(Boolean).join(', ') ||
              null,
          },

          tx,
        );
        return { replay: false, viewing: viewingDto(row) };
      });
    },

    async reschedule(id: string, input: RescheduleInput, identity: Actor) {
      return notifications.transactionWithChanges(async (tx, recipientIds) => {
        await repository.lock(id, tx);
        const actor = await requireCurrentStaff(identity, tx),
          row = await owned(id, actor, tx);
        if (row.version !== input.expectedVersion || row.status !== 'scheduled')
          throw conflict();
        await eligibility(
          row.leadId,
          row.propertyId,
          input.expectedLeadVersion,
          actor,
          tx,
        );
        const dates = times(input);
        const viewing = await persist(
          id,
          input.expectedVersion,
          actor,
          dates,
          tx,
        );
        if (
          dates.startsAt.getTime() !== row.startsAt.getTime() ||
          dates.endsAt.getTime() !== row.endsAt.getTime()
        )
          recipientIds.push(
            await notifyAssignee(viewing, actor, 'viewing_rescheduled', tx),
          );
        return viewingDto(viewing);
      });
    },

    async status(id: string, input: StatusInput, identity: Actor) {
      return notifications.transactionWithChanges(async (tx, recipientIds) => {
        await repository.lock(id, tx);
        const actor = await requireCurrentStaff(identity, tx),
          row = await owned(id, actor, tx);
        if (row.version !== input.expectedVersion || row.status !== 'scheduled')
          throw conflict();
        if (input.status === 'completed' && row.startsAt > clock())
          throw conflict();
        const viewing = await persist(
          id,
          input.expectedVersion,
          actor,
          {
            status: input.status,
            ...(input.status === 'completed'
              ? { feedback: input.feedback }
              : {}),
          },

          tx,
        );
        if (input.status === 'cancelled')
          recipientIds.push(
            await notifyAssignee(viewing, actor, 'viewing_cancelled', tx),
          );
        return viewingDto(viewing);
      });
    },
  };
}

export type ViewingService = ReturnType<typeof createViewingService>;
