import type { EmailNotification } from '../../generated/prisma/client.js';
import type { Transaction } from '../../infrastructure/database/transaction.js';
import { taskReminderWindowMs } from '../tasks/tasks.rules.js';
import type { EmailGroups } from './email.config.js';
import { day, emailViewingChanged, type EmailPayload } from './email.types.js';

const sameAddress = (current: string | null, snapshot: string) =>
  current !== null && current.trim().toLowerCase() === snapshot.toLowerCase();

export async function suppressionReason(
  tx: Transaction,
  row: EmailNotification,
  payload: EmailPayload,
  groups: EmailGroups | undefined,
  now: number,
) {
  // Legacy v1 is an immutable acknowledgement of the accepted enquiry and drains even with production switched off.
  if (row.kind === 'WEBSITE_ENQUIRY_RECEIVED') return null;
  const isCustomer = row.kind.startsWith('CUSTOMER_VIEWING_');
  if (isCustomer ? !groups?.customerViewingEnabled : !groups?.staffEnabled)
    return 'EMAIL_GROUP_DISABLED';
  if (!row.leadId || !row.expiresAt) return 'EMAIL_CONTEXT_CHANGED';
  const lead = await tx.lead.findUnique({
    where: { id: row.leadId },
    select: { email: true, assignedAgentId: true, source: true },
  });
  if (!lead) return 'EMAIL_CONTEXT_CHANGED';

  if (isCustomer) {
    if (!sameAddress(lead.email, payload.to)) return 'EMAIL_RECIPIENT_CHANGED';
  } else {
    if (!row.recipientUserId) return 'EMAIL_RECIPIENT_CHANGED';
    const staff = await tx.user.findUnique({
      where: { id: row.recipientUserId },
      select: { email: true, role: true, disabled: true, banned: true },
    });
    if (
      !staff ||
      staff.disabled ||
      staff.banned ||
      !sameAddress(staff.email, payload.to)
    )
      return 'EMAIL_RECIPIENT_CHANGED';
    if (
      !('crmUrl' in payload) ||
      new URL(payload.crmUrl).pathname !==
        '/crm/leads/' + encodeURIComponent(row.leadId)
    )
      return 'EMAIL_CONTEXT_CHANGED';

    if (row.kind === 'STAFF_WEBSITE_ENQUIRY_RECEIVED') {
      return ['admin', 'manager'].includes(staff.role) &&
        !lead.assignedAgentId &&
        lead.source === 'website'
        ? null
        : 'EMAIL_CONTEXT_CHANGED';
    }
    if (staff.role !== 'agent' || lead.assignedAgentId !== row.recipientUserId)
      return 'EMAIL_ASSIGNMENT_CHANGED';
    if (row.kind === 'LEAD_ASSIGNED') return null;
    if (row.kind === 'TASK_DUE_SOON') {
      if (!row.taskId || !('dueAt' in payload)) return 'EMAIL_TASK_CHANGED';
      const task = await tx.task.findUnique({
        where: { id: row.taskId },
        select: { leadId: true, status: true, dueAt: true },
      });
      return task?.leadId === row.leadId &&
        task.status === 'open' &&
        task.dueAt.toISOString() === payload.dueAt &&
        now < task.dueAt.getTime() &&
        task.dueAt.getTime() <= now + taskReminderWindowMs
        ? null
        : 'EMAIL_TASK_CHANGED';
    }
  }

  if (!row.viewingId || !('startsAt' in payload)) return emailViewingChanged;
  const viewing = await tx.viewing.findUnique({
    where: { id: row.viewingId },
    select: {
      leadId: true,
      status: true,
      startsAt: true,
      endsAt: true,
      createdAt: true,
    },
  });
  const cancellation = row.kind.endsWith('_CANCELLED');
  if (
    !viewing ||
    viewing.leadId !== row.leadId ||
    viewing.status !== (cancellation ? 'cancelled' : 'scheduled') ||
    (!cancellation && now >= viewing.startsAt.getTime()) ||
    viewing.startsAt.getTime() !== row.scheduledStartsAt?.getTime() ||
    viewing.endsAt.getTime() !== row.scheduledEndsAt?.getTime() ||
    viewing.startsAt.toISOString() !== payload.startsAt ||
    viewing.endsAt.toISOString() !== payload.endsAt
  )
    return emailViewingChanged;
  if (row.kind !== 'CUSTOMER_VIEWING_REMINDER') return null;

  const cutoff = groups?.customerViewingActivatedAt;
  if (
    !cutoff ||
    viewing.createdAt < cutoff ||
    now < viewing.startsAt.getTime() - day ||
    now >= viewing.startsAt.getTime()
  )
    return emailViewingChanged;

  const prior = await tx.emailNotification.findFirst({
    where: {
      kind: row.kind,
      viewingId: row.viewingId,
      sourceVersion: row.sourceVersion,
      scheduledStartsAt: row.scheduledStartsAt,
      scheduledEndsAt: row.scheduledEndsAt,
      id: { notIn: row.replayOfId ? [row.id, row.replayOfId] : [row.id] },
      status: { in: ['SENDING', 'UNCERTAIN', 'SUBMITTED'] },
    },
    select: { id: true },
  });
  return prior ? 'EMAIL_REMINDER_ALREADY_SENT' : null;
}
