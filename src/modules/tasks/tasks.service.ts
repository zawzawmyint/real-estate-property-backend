import { createHash } from 'node:crypto';
import { AppError } from '../../shared/errors/app-error.js';
import {
  serializedTransaction,
  type Database,
  type Transaction,
} from '../../infrastructure/database/transaction.js';
import { isStaffRole } from '../auth/auth.js';
import { createLeadRepository, type Actor } from '../leads/leads.repository.js';
import { eligibleAgent } from '../leads/leads.dto.js';
import { createTaskRepository } from './tasks.repository.js';
import { taskDto } from './tasks.dto.js';
import {
  parse,
  createSchema,
  updateSchema,
  statusSchema,
  type CreateInput,
  type UpdateInput,
  type StatusInput,
  type ListQuery,
} from './tasks.schema.js';
const missing = () => new AppError(404, 'NOT_FOUND', 'Task or lead not found');
const conflict = () =>
  new AppError(409, 'CONFLICT', 'Task or lead changed; refresh and review');
export function createTaskService(
  database: Database,
  clock: () => Date = () => new Date(),
) {
  const repository = createTaskRepository(database),
    leads = createLeadRepository(database);

  async function current(identity: Actor, tx: Transaction): Promise<Actor> {
    const session = await leads.actor(identity, tx),
      user = session?.user;
    if (
      !user ||
      user.disabled ||
      user.banned ||
      !isStaffRole(user.role) ||
      session.credentialVersion !== user.credentialVersion
    )
      throw new AppError(401, 'UNAUTHENTICATED', 'Staff sign-in required');
    return {
      id: user.id,
      name: user.name,
      role: user.role,
      sessionId: identity.sessionId,
    };
  }

  async function owned(id: string, actor: Actor, tx: Transaction) {
    const row = await repository.find(id, actor, tx);
    if (!row) throw missing();
    return row;
  }

  async function eligibility(
    id: string,
    version: number,
    actor: Actor,
    tx: Transaction,
  ) {
    const lead = await leads.find(id, actor, tx);
    if (!lead) throw missing();
    if (
      lead.version !== version ||
      ['won', 'lost'].includes(lead.stage) ||
      !eligibleAgent(lead.assignedAgent)
    )
      throw conflict();
  }

  function future(dueAt: Date, asOf: Date) {
    if (dueAt <= asOf)
      throw new AppError(
        400,
        'VALIDATION_ERROR',
        'New or changed due time must be in the future',
      );
  }

  async function persist(
    id: string,
    expected: number,
    actor: Actor,
    data: Parameters<typeof repository.update>[3],
    asOf: Date,
    tx: Transaction,
  ) {
    if ((await repository.update(id, expected, actor, data, tx)).count !== 1)
      throw conflict();
    return {
      task: taskDto(await owned(id, actor, tx), asOf),
      asOf: asOf.toISOString(),
    };
  }

  return {
    async list(query: ListQuery, identity: Actor) {
      return serializedTransaction(database, async (tx) => {
        const actor = await current(identity, tx),
          asOf = clock();
        if (query.leadId && !(await leads.find(query.leadId, actor, tx)))
          throw missing();
        const result = await repository.list(query, actor, asOf, tx);
        return {
          ...result,
          items: result.items.map((row) => taskDto(row, asOf)),
          asOf: asOf.toISOString(),
        };
      });
    },

    async detail(id: string, identity: Actor) {
      return serializedTransaction(database, async (tx) => {
        const actor = await current(identity, tx),
          asOf = clock();
        return {
          task: taskDto(await owned(id, actor, tx), asOf),
          asOf: asOf.toISOString(),
        };
      });
    },

    async create(raw: CreateInput, identity: Actor) {
      const input = parse(createSchema, raw),
        canonical = {
          leadId: input.leadId,
          expectedLeadVersion: input.expectedLeadVersion,
          title: input.title,
          notes: input.notes,
          dueAt: input.dueAt,
        },
        payloadHash = createHash('sha256')
          .update(JSON.stringify(canonical))
          .digest('hex');
      return serializedTransaction(database, async (tx) => {
        await repository.lockSubmission(input.submissionId, tx);
        const actor = await current(identity, tx),
          asOf = clock(),
          receipt = await repository.receipt(input.submissionId, tx);
        if (receipt) {
          const row = await owned(receipt.id, actor, tx);
          if (receipt.actorScope !== actor.id) throw conflict();
          if (receipt.payloadHash !== payloadHash)
            return { receiptConflict: true as const, existingTaskId: row.id };
          return {
            replay: true,
            task: taskDto(row, asOf),
            asOf: asOf.toISOString(),
          };
        }
        await eligibility(input.leadId, input.expectedLeadVersion, actor, tx);
        const dueAt = new Date(input.dueAt);
        future(dueAt, asOf);
        const row = await repository.create(
          {
            submissionId: input.submissionId,
            actorScope: actor.id,
            payloadHash,
            leadId: input.leadId,
            title: input.title,
            notes: input.notes,
            dueAt,
            createdById: actor.id,
          },
          tx,
        );
        return {
          replay: false,
          task: taskDto(row, asOf),
          asOf: asOf.toISOString(),
        };
      });
    },

    async update(id: string, raw: UpdateInput, identity: Actor) {
      const input = parse(updateSchema, raw);
      return serializedTransaction(database, async (tx) => {
        await repository.lock(id, tx);
        const actor = await current(identity, tx),
          row = await owned(id, actor, tx),
          asOf = clock();
        if (row.version !== input.expectedVersion || row.status !== 'open')
          throw conflict();
        await eligibility(row.leadId, input.expectedLeadVersion, actor, tx);
        const dueAt = new Date(input.dueAt);
        if (dueAt.getTime() !== row.dueAt.getTime()) future(dueAt, asOf);
        return persist(
          id,
          input.expectedVersion,
          actor,
          { title: input.title, notes: input.notes, dueAt },
          asOf,
          tx,
        );
      });
    },

    async status(id: string, raw: StatusInput, identity: Actor) {
      const input = parse(statusSchema, raw);
      return serializedTransaction(database, async (tx) => {
        await repository.lock(id, tx);
        const actor = await current(identity, tx),
          row = await owned(id, actor, tx),
          asOf = clock();
        if (row.version !== input.expectedVersion || row.status !== 'open')
          throw conflict();
        return persist(
          id,
          input.expectedVersion,
          actor,
          {
            status: input.status,
            ...(input.status === 'completed'
              ? { completedAt: asOf }
              : { cancelledAt: asOf }),
          },
          asOf,
          tx,
        );
      });
    },
  };
}
export type TaskService = ReturnType<typeof createTaskService>;
