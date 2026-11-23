import {
  type EnquiryEmailProducer,
  type LeadStaffEmailProducer,
  suppressReassignedEmails,
  suppressCustomerContactEmails,
} from './leads.emails.js';
import { duplicateReview, guardDuplicate } from './lead-duplicates.service.js';
import { duplicateCounts } from './lead-duplicates.repository.js';
import { requireLeadPhone } from './lead-phone.js';
import { serializeExport, decimalHundredths } from '../../shared/csv/export.js';
import type { ExportQuery } from './leads.schema.js';
import { createHash } from 'node:crypto';
import { AppError } from '../../shared/errors/app-error.js';
import { requireCurrentStaff } from '../auth/staff-actor.js';
import {
  serializedTransaction,
  type Database,
  type Transaction,
} from '../../infrastructure/database/transaction.js';
import type { PropertyMatchQuery } from '../properties/properties.schema.js';
import type { PropertyService } from '../properties/properties.service.js';
import { createNotificationService } from '../notifications/notifications.service.js';
import { activityDto, eligibleAgent, leadDto } from './leads.dto.js';
import {
  createLeadRepository,
  leadSearch,
  type Actor,
  type LeadRecord,
} from './leads.repository.js';
import type {
  AgencyInquiryInput,
  CandidateQuery,
  CreateInput,
  InquiryInput,
  ListQuery,
  NoteInput,
  PatchInput,
  TemperatureInput,
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

export type ListPropertyMatches = PropertyService['listPropertyMatches'];

export function createLeadService(
  database: Database,
  notifications = createNotificationService(database),
  recordEmail?: EnquiryEmailProducer,
  recordStaffEmail?: LeadStaffEmailProducer,
) {
  const repository = createLeadRepository(database);

  async function owned(id: string, actor: Actor, tx: Transaction) {
    const lead = await repository.find(id, actor, tx);
    if (!lead) throw missing();
    return lead;
  }

  async function dto(
    lead: LeadRecord,
    actor: Actor,
    tx: Transaction,
    detail = true,
  ) {
    const counts = lead.phoneCanonical
      ? await duplicateCounts([lead.phoneCanonical], actor, tx)
      : [];
    return leadDto(
      lead,
      detail,
      Math.max(0, (counts[0]?._count._all ?? 1) - 1),
    );
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

  async function persistPublicInquiry(
    data: Omit<
      Parameters<typeof repository.create>[0],
      keyof ReturnType<typeof leadSearch>
    > &
      Parameters<typeof leadSearch>[0],
    submissionId: string,
    operation: 'inquiry' | 'agency_inquiry',
    payloadHash: string,
    tx: Transaction,
    recipientIds: (string | null)[],
  ) {
    const lead = await repository.create(
      {
        ...data,
        phoneCanonical: requireLeadPhone(data.phone),
        ...leadSearch(data),
      },
      tx,
    );
    if (recordEmail && lead.email) {
      await recordEmail(tx, {
        leadId: lead.id,
        to: lead.email,
        name: lead.name,
        property:
          lead.propertyId && lead.propertyTitleSnapshot
            ? { id: lead.propertyId, title: lead.propertyTitleSnapshot }
            : null,
      });
    }
    await event(lead.id, 'created', null, {}, tx);
    await repository.saveReceipt(
      {
        id: submissionId,
        operation,
        actorScope: 'public',
        payloadHash,
        leadId: lead.id,
      },
      tx,
    );
    for (const { id } of await repository.activeManagers(tx)) {
      await recordStaffEmail?.(tx, 'STAFF_WEBSITE_ENQUIRY_RECEIVED', lead, id);
      recipientIds.push(
        await notifications.createNotification(
          {
            recipientId: id,
            type: 'website_inquiry_received',
            leadId: lead.id,
            occurrenceKey: `website_inquiry_received:${lead.id}`,
          },
          tx,
        ),
      );
    }
    return { replay: false };
  }

  async function notifyAssignment(
    lead: LeadRecord,
    recipientId: string,
    tx: Transaction,
  ) {
    await recordStaffEmail?.(tx, 'LEAD_ASSIGNED', lead, recipientId);
    return notifications.createNotification(
      {
        recipientId,
        type: 'lead_assigned',
        leadId: lead.id,
        occurrenceKey: `lead_assigned:${lead.id}:${lead.version}`,
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
    async duplicateCheck(
      input: { phone: string; excludeLeadId?: string | undefined },
      identity: Actor,
    ) {
      return serializedTransaction(database, async (tx) => {
        const actor = await requireCurrentStaff(identity, tx);
        if (input.excludeLeadId) await owned(input.excludeLeadId, actor, tx);
        return duplicateReview(
          requireLeadPhone(input.phone)!,
          actor,
          input.excludeLeadId ?? null,
          tx,
        );
      });
    },
    async exportCsv(query: ExportQuery, identity: Actor): Promise<string> {
      const rows = await serializedTransaction(database, async (tx) => {
        const actor = await requireCurrentStaff(identity, tx);
        const view =
          query.view ?? (actor.role === 'agent' ? 'mine' : 'unassigned');
        if (
          actor.role === 'agent' &&
          (view !== 'mine' ||
            (query.agentId !== undefined && query.agentId !== actor.id))
        )
          throw forbidden();
        if (query.agentId && actor.role !== 'agent' && view !== 'all')
          throw invalid();
        return repository.exportRows({ ...query, view }, actor, tx);
      });
      return serializeExport(
        [
          'lead_id',
          'name',
          'phone',
          'email',
          'purpose',
          'budget_aed',
          'source',
          'stage',
          'assigned_agent_id',
          'assigned_agent_name',
          'property_id',
          'property_title',
          'property_location',
          'created_at_utc',
          'updated_at_utc',
        ],
        rows.map((row) => ({
          ...row,
          budget_aed: decimalHundredths(row.budget_aed),
          created_at_utc: new Date(row.created_at_utc).toISOString(),
          updated_at_utc: new Date(row.updated_at_utc).toISOString(),
        })),
      );
    },

    async list(query: ListQuery, identity: Actor) {
      return serializedTransaction(database, async (tx) => {
        const actor = await requireCurrentStaff(identity, tx),
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
        const counts = await duplicateCounts(
          [
            ...new Set(
              result.items.flatMap((lead) =>
                lead.phoneCanonical ? [lead.phoneCanonical] : [],
              ),
            ),
          ],
          actor,
          tx,
        );
        const byPhone = new Map(
          counts.map((row) => [row.phoneCanonical, row._count._all]),
        );
        return {
          ...result,
          items: result.items.map((lead) =>
            leadDto(
              lead,
              false,
              lead.phoneCanonical
                ? Math.max(0, (byPhone.get(lead.phoneCanonical) ?? 1) - 1)
                : 0,
            ),
          ),
        };
      });
    },

    async detail(id: string, identity: Actor) {
      return serializedTransaction(database, async (tx) => {
        const actor = await requireCurrentStaff(identity, tx);
        return dto(await owned(id, actor, tx), actor, tx);
      });
    },

    async activity(id: string, page: number, identity: Actor) {
      return serializedTransaction(database, async (tx) => {
        await owned(id, await requireCurrentStaff(identity, tx), tx);
        const result = await repository.activity(id, page, tx);
        return { ...result, items: result.items.map(activityDto) };
      });
    },

    async propertyMatches(
      id: string,
      query: PropertyMatchQuery,
      identity: Actor,
      listPropertyMatches: ListPropertyMatches,
    ) {
      return serializedTransaction(database, async (tx) => {
        await owned(id, await requireCurrentStaff(identity, tx), tx);

        return listPropertyMatches(query, tx);
      });
    },

    async candidates(query: CandidateQuery, identity: Actor) {
      return serializedTransaction(database, async (tx) => {
        if ((await requireCurrentStaff(identity, tx)).role === 'agent')
          throw forbidden();
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
      return notifications.transactionWithChanges(async (tx, recipientIds) => {
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

        return persistPublicInquiry(
          data,
          input.submissionId,
          'inquiry',
          payloadHash,
          tx,
          recipientIds,
        );
      });
    },

    async agencyInquiry(input: AgencyInquiryInput) {
      const canonical = {
          purpose: input.purpose,
          name: input.name,
          phone: input.phone ?? null,
          email: input.email ?? null,
          message: input.message,
        },
        payloadHash = hash(canonical);

      return notifications.transactionWithChanges(async (tx, recipientIds) => {
        await repository.lockSubmission(input.submissionId, tx);
        const replay = await receipt(
          input.submissionId,
          'agency_inquiry',
          'public',
          payloadHash,
          tx,
        );
        if (replay) return { replay: true };

        const data = {
          name: input.name,
          phone: input.phone ?? null,
          email: input.email ?? null,
          purpose: input.purpose,
          originalMessage: input.message,
          source: 'website',
          stage: 'new',
          budgetFils: null,
          assignedAgentId: null,
          assignedAgentNameSnapshot: null,
          createdById: null,
          propertyId: null,
          propertyTitleSnapshot: null,
          propertyLocationSnapshot: null,
        };
        return persistPublicInquiry(
          data,
          input.submissionId,
          'agency_inquiry',
          payloadHash,
          tx,
          recipientIds,
        );
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
      return notifications.transactionWithChanges(async (tx, recipientIds) => {
        await repository.lockUser(identity.id, tx);
        const actor = await requireCurrentStaff(identity, tx);
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
            lead: await dto(await owned(replay.leadId, actor, tx), actor, tx),
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
        const phoneCanonical = requireLeadPhone(input.phone);
        await guardDuplicate(
          phoneCanonical,
          actor,
          null,
          input.duplicateAcknowledgement,
          tx,
        );
        const data = {
          phoneCanonical,
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
        if (assigned && actor.role !== 'agent')
          recipientIds.push(await notifyAssignment(lead, assigned.id, tx));
        return { replay: false, lead: await dto(lead, actor, tx) };
      });
    },

    async patch(id: string, input: PatchInput, identity: Actor) {
      return serializedTransaction(database, async (tx) => {
        await repository.lock(id, tx);
        const actor = await requireCurrentStaff(identity, tx),
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
        const phoneCanonical =
          merged.phone === before.phone
            ? before.phoneCanonical
            : requireLeadPhone(merged.phone);
        if (phoneCanonical !== before.phoneCanonical)
          await guardDuplicate(
            phoneCanonical,
            actor,
            id,
            input.duplicateAcknowledgement,
            tx,
          );
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
        if (!changedFields.length) return dto(before, actor, tx);
        const data = {
          name: merged.name,
          phone: merged.phone,
          phoneCanonical,
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
        if (merged.email !== before.email)
          await suppressCustomerContactEmails(tx, id, new Date());
        await event(
          id,
          'details_updated',
          actor,
          { changedFields: JSON.stringify(changedFields) },
          tx,
        );
        return dto(lead, actor, tx);
      });
    },

    async assignment(
      id: string,
      input: { expectedVersion: number; assignedAgentId: string | null },
      identity: Actor,
    ) {
      return notifications.transactionWithChanges(async (tx, recipientIds) => {
        await repository.lock(id, tx);
        const actor = await requireCurrentStaff(identity, tx);
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
          return dto(before, actor, tx);
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
        await suppressReassignedEmails(
          tx,
          id,
          before.assignedAgentId,
          new Date(),
        );
        if (before.assignedAgentId) {
          recipientIds.push(
            ...(await notifications.retireNotifications(
              {
                leadId: id,
                recipientId: before.assignedAgentId,
                types: [
                  'lead_assigned',
                  'viewing_rescheduled',
                  'viewing_cancelled',
                  'task_due_soon',
                ],
              },
              tx,
            )),
          );
        }
        if (target) {
          recipientIds.push(
            ...(await notifications.retireNotifications(
              { leadId: id, types: ['website_inquiry_received'] },
              tx,
            )),
          );
          recipientIds.push(await notifyAssignment(lead, target.id, tx));
        }
        return dto(lead, actor, tx);
      });
    },

    async stage(
      id: string,
      input: { expectedVersion: number; stage: string },
      identity: Actor,
    ) {
      return serializedTransaction(database, async (tx) => {
        await repository.lock(id, tx);
        const actor = await requireCurrentStaff(identity, tx),
          before = await owned(id, actor, tx);
        version(before, input.expectedVersion);
        if (input.stage === before.stage) return dto(before, actor, tx);
        const lead = await update(before, actor, { stage: input.stage }, tx);
        await event(
          id,
          'stage_changed',
          actor,
          { previousStage: before.stage, nextStage: input.stage },
          tx,
        );
        return dto(lead, actor, tx);
      });
    },

    async temperature(id: string, input: TemperatureInput, identity: Actor) {
      return serializedTransaction(database, async (tx) => {
        await repository.lock(id, tx);
        const actor = await requireCurrentStaff(identity, tx);
        const before = await owned(id, actor, tx);
        version(before, input.expectedVersion);
        if (input.temperature === before.temperature)
          return dto(before, actor, tx);
        const lead = await update(
          before,
          actor,
          { temperature: input.temperature },
          tx,
        );
        await event(
          id,
          'temperature_changed',
          actor,
          {
            previousTemperature: before.temperature,
            nextTemperature: input.temperature,
          },
          tx,
        );
        return dto(lead, actor, tx);
      });
    },

    async note(id: string, input: NoteInput, identity: Actor) {
      return serializedTransaction(database, async (tx) => {
        await repository.lock(id, tx);
        const actor = await requireCurrentStaff(identity, tx),
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
