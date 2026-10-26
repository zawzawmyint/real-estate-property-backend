import { createHash } from 'node:crypto';
import { AppError } from '../../shared/errors/app-error.js';
import { isStaffRole } from '../auth/auth.js';
import {
  propertyTransaction,
  type Database,
  type Transaction,
} from '../properties/properties.repository.js';
import { activityDto, eligibleAgent, leadDto } from './leads.dto.js';
import {
  createLeadRepository,
  leadSearch,
  type Actor,
  type LeadRecord,
} from './leads.repository.js';
import type {
  CandidateQuery,
  CreateInput,
  InquiryInput,
  ListQuery,
  NoteInput,
  PatchInput,
} from './leads.schema.js';
const missing = () => new AppError(404, 'NOT_FOUND', 'Lead not found');
const conflict = () =>
  new AppError(
    409,
    'CONFLICT',
    'Lead changed or submission conflicts; refresh and review',
  );
const forbidden = () => new AppError(403, 'FORBIDDEN', 'Access denied');
const invalid = () =>
  new AppError(400, 'VALIDATION_ERROR', 'Invalid lead input');
const hash = (payload: unknown) =>
  createHash('sha256').update(JSON.stringify(payload)).digest('hex');

export function createLeadService(database: Database) {
  const repository = createLeadRepository(database);

  async function current(actor: Actor, tx: Transaction): Promise<Actor> {
    const session = await repository.actor(actor, tx),
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
      sessionId: actor.sessionId,
    };
  }

  async function owned(id: string, actor: Actor, tx: Transaction) {
    const lead = await repository.find(id, actor, tx);
    if (!lead) throw missing();
    return lead;
  }

  function version(lead: LeadRecord, expected: number) {
    if (lead.version !== expected) throw conflict();
  }

  async function eligible(id: string, tx: Transaction) {
    const user = await repository.agent(id, tx);
    if (!eligibleAgent(user))
      throw new AppError(409, 'CONFLICT', 'Selected agent is unavailable');
    return user!;
  }

  async function propertyFields(
    id: string | null,
    purpose: string,
    tx: Transaction,
    publicOnly = false,
  ) {
    if (id === null)
      return {
        propertyId: null,
        propertyTitleSnapshot: null,
        propertyLocationSnapshot: null,
      };
    const property = await repository.property(id, tx);
    if (
      !property ||
      property.availability !== 'available' ||
      !(publicOnly
        ? property.publishingState === 'published'
        : ['draft', 'published'].includes(property.publishingState))
    ) {
      if (publicOnly)
        throw new AppError(404, 'NOT_FOUND', 'Property not found');
      throw new AppError(409, 'CONFLICT', 'Selected property is unavailable');
    }
    if (property.purpose !== purpose) throw invalid();
    return {
      propertyId: id,
      propertyTitleSnapshot: property.title,
      propertyLocationSnapshot:
        [property.community, property.city].filter(Boolean).join(', ') || null,
    };
  }

  async function receipt(
    id: string,
    operation: string,
    actorScope: string,
    payloadHash: string,
    tx: Transaction,
  ) {
    const found = await repository.receipt(id, tx);
    if (
      found &&
      (found.operation !== operation ||
        found.actorScope !== actorScope ||
        found.payloadHash !== payloadHash)
    )
      throw conflict();
    return found;
  }

  async function event(
    leadId: string,
    type: string,
    actor: Actor | null,
    extra: Partial<Parameters<typeof repository.event>[0]>,
    tx: Transaction,
  ) {
    return repository.event(
      {
        leadId,
        type,
        actorId: actor?.id ?? null,
        actorNameSnapshot: actor?.name ?? null,
        ...extra,
      },
      tx,
    );
  }

  async function update(
    lead: LeadRecord,
    actor: Actor,
    data: Parameters<typeof repository.update>[3],
    tx: Transaction,
  ) {
    if (
      (await repository.update(lead.id, lead.version, actor, data, tx))
        .count !== 1
    )
      throw conflict();
    return await owned(lead.id, actor, tx);
  }
  return {
    async list(query: ListQuery, identity: Actor) {
      return propertyTransaction(database, async (tx) => {
        const actor = await current(identity, tx),
          view = query.view ?? (actor.role === 'agent' ? 'mine' : 'unassigned');
        if (
          actor.role === 'agent' &&
          (view !== 'mine' ||
            (query.agentId !== undefined && query.agentId !== actor.id))
        )
          throw forbidden();
        if (query.agentId && actor.role !== 'agent' && view !== 'all')
          throw invalid();
        const result = await repository.list({ ...query, view }, actor, tx);
        return { ...result, items: result.items.map((lead) => leadDto(lead)) };
      });
    },

    async detail(id: string, identity: Actor) {
      return propertyTransaction(database, async (tx) =>
        leadDto(await owned(id, await current(identity, tx), tx), true),
      );
    },

    async activity(id: string, page: number, identity: Actor) {
      return propertyTransaction(database, async (tx) => {
        await owned(id, await current(identity, tx), tx);
        const result = await repository.activity(id, page, tx);
        return { ...result, items: result.items.map(activityDto) };
      });
    },

    async candidates(query: CandidateQuery, identity: Actor) {
      return propertyTransaction(database, async (tx) => {
        if ((await current(identity, tx)).role === 'agent') throw forbidden();
        return repository.candidates(query, tx);
      });
    },

    async inquiry(propertyId: string, input: InquiryInput) {
      const canonical = {
          propertyId,
          name: input.name,
          phone: input.phone ?? null,
          email: input.email ?? null,
          message: input.message ?? null,
        },
        payloadHash = hash(canonical);
      return propertyTransaction(database, async (tx) => {
        await repository.lockProperty(propertyId, tx);
        const replay = await receipt(
          input.submissionId,
          'inquiry',
          'public',
          payloadHash,
          tx,
        );
        if (replay) return { replay: true };
        const property = await repository.property(propertyId, tx);
        if (!property)
          throw new AppError(404, 'NOT_FOUND', 'Property not found');
        const context = await propertyFields(
          propertyId,
          property.purpose,
          tx,
          true,
        );
        const data = {
          name: input.name,
          phone: input.phone ?? null,
          email: input.email ?? null,
          purpose: property.purpose,
          budgetFils: null,
          source: 'website',
          stage: 'new',
          assignedAgentId: null,
          assignedAgentNameSnapshot: null,
          createdById: null,
          originalMessage: input.message ?? null,
          ...context,
        };
        const lead = await repository.create(
          { ...data, ...leadSearch(data) },
          tx,
        );
        await event(lead.id, 'created', null, {}, tx);
        await repository.saveReceipt(
          {
            id: input.submissionId,
            operation: 'inquiry',
            actorScope: 'public',
            payloadHash,
            leadId: lead.id,
          },
          tx,
        );
        return { replay: false };
      });
    },

    async create(input: CreateInput, identity: Actor) {
      const canonical = {
          name: input.name,
          phone: input.phone ?? null,
          email: input.email ?? null,
          purpose: input.purpose,
          source: input.source,
          budgetFils: input.budgetFils ?? null,
          propertyId: input.propertyId ?? null,
          assignedAgentId: input.assignedAgentId ?? null,
        },
        payloadHash = hash(canonical);
      return propertyTransaction(database, async (tx) => {
        await repository.lockUser(identity.id, tx);
        const actor = await current(identity, tx);
        const replay = await receipt(
          input.submissionId,
          'create',
          actor.id,
          payloadHash,
          tx,
        );
        if (replay)
          return {
            replay: true,
            lead: leadDto(await owned(replay.leadId, actor, tx), true),
          };
        if (
          actor.role === 'agent' &&
          input.assignedAgentId !== undefined &&
          input.assignedAgentId !== actor.id
        )
          throw forbidden();
        const assignedId =
            actor.role === 'agent' ? actor.id : (input.assignedAgentId ?? null),
          assigned = assignedId ? await eligible(assignedId, tx) : null;
        const context = await propertyFields(
          input.propertyId ?? null,
          input.purpose,
          tx,
        );
        const data = {
          name: input.name,
          phone: input.phone ?? null,
          email: input.email ?? null,
          purpose: input.purpose,
          source: input.source,
          budgetFils:
            input.budgetFils == null ? null : BigInt(input.budgetFils),
          assignedAgentId: assigned?.id ?? null,
          assignedAgentNameSnapshot: assigned?.name ?? null,
          createdById: actor.id,
          stage: 'new',
          originalMessage: null,
          ...context,
        };
        const lead = await repository.create(
          { ...data, ...leadSearch(data) },
          tx,
        );
        await event(
          lead.id,
          'created',
          actor,
          {
            nextAgentId: assigned?.id ?? null,
            nextAgentName: assigned?.name ?? null,
          },
          tx,
        );
        await repository.saveReceipt(
          {
            id: input.submissionId,
            operation: 'create',
            actorScope: actor.id,
            payloadHash,
            leadId: lead.id,
          },
          tx,
        );
        return { replay: false, lead: leadDto(lead, true) };
      });
    },

    async patch(id: string, input: PatchInput, identity: Actor) {
      return propertyTransaction(database, async (tx) => {
        await repository.lock(id, tx);
        const actor = await current(identity, tx),
          before = await owned(id, actor, tx);
        version(before, input.expectedVersion);
        const merged = {
          name: input.name ?? before.name,
          phone: input.phone === undefined ? before.phone : input.phone,
          email: input.email === undefined ? before.email : input.email,
          purpose: input.purpose ?? before.purpose,
          budgetFils:
            input.budgetFils === undefined
              ? before.budgetFils
              : input.budgetFils === null
                ? null
                : BigInt(input.budgetFils),
          propertyId:
            input.propertyId === undefined
              ? before.propertyId
              : input.propertyId,
        };
        if (!merged.phone && !merged.email) throw invalid();
        let context = {
          propertyId: before.propertyId,
          propertyTitleSnapshot: before.propertyTitleSnapshot,
          propertyLocationSnapshot: before.propertyLocationSnapshot,
        };
        if (
          input.propertyId !== undefined &&
          (input.propertyId !== before.propertyId ||
            (input.propertyId === null &&
              before.propertyTitleSnapshot !== null))
        )
          context = await propertyFields(input.propertyId, merged.purpose, tx);
        else if (merged.propertyId && merged.purpose !== before.purpose) {
          const property = await repository.property(merged.propertyId, tx);
          if (property && property.purpose !== merged.purpose) throw invalid();
        }
        const changedFields = (
          [
            'name',
            'phone',
            'email',
            'purpose',
            'budgetFils',
            'propertyId',
          ] as const
        ).filter((field) => merged[field] !== before[field]);
        if (
          input.propertyId === null &&
          before.propertyTitleSnapshot !== null &&
          !changedFields.includes('propertyId')
        )
          changedFields.push('propertyId');
        if (!changedFields.length) return leadDto(before, true);
        const data = {
          name: merged.name,
          phone: merged.phone,
          email: merged.email,
          purpose: merged.purpose,
          budgetFils: merged.budgetFils,
          ...context,
        };
        const lead = await update(
          before,
          actor,
          { ...data, ...leadSearch(data) },
          tx,
        );
        await event(
          id,
          'details_updated',
          actor,
          { changedFields: JSON.stringify(changedFields) },
          tx,
        );
        return leadDto(lead, true);
      });
    },

    async assignment(
      id: string,
      input: { expectedVersion: number; assignedAgentId: string | null },
      identity: Actor,
    ) {
      return propertyTransaction(database, async (tx) => {
        await repository.lock(id, tx);
        const actor = await current(identity, tx);
        if (actor.role === 'agent') throw forbidden();
        const before = await owned(id, actor, tx);
        version(before, input.expectedVersion);
        const target = input.assignedAgentId
          ? await eligible(input.assignedAgentId, tx)
          : null;
        if (
          input.assignedAgentId === before.assignedAgentId &&
          !(
            input.assignedAgentId === null &&
            before.assignedAgentNameSnapshot !== null
          )
        )
          return leadDto(before, true);
        const lead = await update(
          before,
          actor,
          {
            assignedAgentId: target?.id ?? null,
            assignedAgentNameSnapshot: target?.name ?? null,
          },
          tx,
        );
        await event(
          id,
          target ? 'assigned' : 'unassigned',
          actor,
          {
            previousAgentId: before.assignedAgentId,
            previousAgentName: before.assignedAgentNameSnapshot,
            nextAgentId: target?.id ?? null,
            nextAgentName: target?.name ?? null,
          },
          tx,
        );
        return leadDto(lead, true);
      });
    },

    async stage(
      id: string,
      input: { expectedVersion: number; stage: string },
      identity: Actor,
    ) {
      return propertyTransaction(database, async (tx) => {
        await repository.lock(id, tx);
        const actor = await current(identity, tx),
          before = await owned(id, actor, tx);
        version(before, input.expectedVersion);
        if (input.stage === before.stage) return leadDto(before, true);
        const lead = await update(before, actor, { stage: input.stage }, tx);
        await event(
          id,
          'stage_changed',
          actor,
          { previousStage: before.stage, nextStage: input.stage },
          tx,
        );
        return leadDto(lead, true);
      });
    },

    async note(id: string, input: NoteInput, identity: Actor) {
      return propertyTransaction(database, async (tx) => {
        await repository.lock(id, tx);
        const actor = await current(identity, tx),
          before = await owned(id, actor, tx),
          payloadHash = hash({
            leadId: id,
            kind: input.kind,
            body: input.body,
          });
        const replay = await receipt(
          input.submissionId,
          'note',
          actor.id,
          payloadHash,
          tx,
        );
        if (replay) {
          const activity = await repository.noteActivity(replay.noteId!, tx);
          if (!activity) throw conflict();
          return {
            replay: true,
            note: activityDto(activity),
            leadVersion: before.version,
          };
        }
        version(before, input.expectedVersion);
        const lead = await update(before, actor, {}, tx);
        const note = await repository.note(
          {
            leadId: id,
            authorId: actor.id,
            authorNameSnapshot: actor.name,
            kind: input.kind,
            body: input.body,
          },
          tx,
        );
        const activity = await event(
          id,
          input.kind === 'call' ? 'call_logged' : 'note_added',
          actor,
          { noteId: note.id },
          tx,
        );
        await repository.saveReceipt(
          {
            id: input.submissionId,
            operation: 'note',
            actorScope: actor.id,
            payloadHash,
            leadId: id,
            noteId: note.id,
          },
          tx,
        );
        return {
          replay: false,
          note: activityDto(activity),
          leadVersion: lead.version,
        };
      });
    },
  };
}
export type LeadService = ReturnType<typeof createLeadService>;
