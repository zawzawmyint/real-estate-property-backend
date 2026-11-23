import { randomUUID } from 'node:crypto';
import {
  serializedTransaction,
  type Database,
  type Transaction,
} from '../../infrastructure/database/transaction.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { EmailCrypto } from './email.crypto.js';
import { suppressionReason } from './email.eligibility.js';
import type { EmailGroups } from './email.config.js';
import { day, terminalStates } from './email.types.js';

// Different better-sqlite3 clients on one event loop can synchronously block each other's commit.
let localEmailWriter: Promise<void> = Promise.resolve();
const unfinished = ['PENDING', 'ENQUEUED'];
const unexpired = (now: number): Prisma.EmailNotificationWhereInput => ({
  OR: [{ expiresAt: null }, { expiresAt: { gt: new Date(now) } }],
});
const metadata = {
  id: true,
  kind: true,
  status: true,
  createdAt: true,
  nextAttemptAt: true,
  expiresAt: true,
  submittedAt: true,
  terminalAt: true,
  sendAttempts: true,
  dispatchAttempts: true,
  lastErrorCode: true,
  replayOfId: true,
} as const;

export function createEmailRepository(
  database: Database,
  crypto: EmailCrypto,
  groups?: EmailGroups,
) {
  // Reserve SQLite's writer before reading the eligibility snapshot. Do not hold this transaction over SMTP.
  async function locked<T>(action: (tx: Transaction) => Promise<T>) {
    const result = localEmailWriter.then(() =>
      serializedTransaction(database, async (tx) => {
        await tx.$executeRaw`UPDATE "EmailNotification" SET "status"="status" WHERE 0`;
        return action(tx);
      }),
    );
    localEmailWriter = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
  const get = (id: string) =>
    database.emailNotification.findUnique({ where: { id } });
  const sending = (id: string, token: string, now: number) => ({
    id,
    status: 'SENDING',
    leaseToken: token,
    leaseUntil: { gt: new Date(now) },
  });
  async function finish(
    id: string,
    token: string,
    status: 'SUBMITTED' | 'FAILED' | 'UNCERTAIN',
    now: number,
    errorCode?: string,
    messageId?: string,
  ) {
    const result = await database.emailNotification.updateMany({
      where: sending(id, token, now),
      data: {
        status,
        terminalAt: new Date(now),
        leaseToken: null,
        leaseUntil: null,
        ...(status === 'SUBMITTED' ? { submittedAt: new Date(now) } : {}),
        lastErrorCode: errorCode ?? null,
        providerMessageId: messageId?.slice(0, 500) ?? null,
      },
    });
    return result.count === 1;
  }
  return {
    get,
    finish,
    inspect: (id: string) =>
      database.emailNotification.findUnique({
        where: { id },
        select: metadata,
      }),
    async hasMissingKeys(keyIds: string[]) {
      return Boolean(
        await database.emailNotification.findFirst({
          where: {
            status: { in: [...unfinished, 'SENDING'] },
            OR: [{ payloadKeyId: null }, { payloadKeyId: { notIn: keyIds } }],
          },
          select: { id: true },
        }),
      );
    },
    due(now: number, keyIds: string[]) {
      return database.emailNotification.findMany({
        where: {
          status: { in: unfinished },
          nextAttemptAt: { lte: new Date(now) },
          payloadKeyId: { in: keyIds },
          AND: [
            unexpired(now),
            {
              OR: [
                { leaseUntil: null },
                { leaseUntil: { lte: new Date(now) } },
              ],
            },
          ],
        },
        orderBy: [
          { nextAttemptAt: 'asc' },
          { createdAt: 'asc' },
          { id: 'asc' },
        ],
        take: 50,
      });
    },
    async claimDispatch(id: string, now: number, token: string) {
      const result = await database.emailNotification.updateMany({
        where: {
          id,
          status: { in: unfinished },
          nextAttemptAt: { lte: new Date(now) },
          AND: [
            unexpired(now),
            {
              OR: [
                { leaseUntil: null },
                { leaseUntil: { lte: new Date(now) } },
              ],
            },
          ],
        },
        data: {
          leaseToken: token,
          leaseUntil: new Date(now + 30_000),
          dispatchAttempts: { increment: 1 },
        },
      });
      return result.count ? get(id) : null;
    },
    async markEnqueued(id: string, token: string, now: number) {
      return (
        (
          await database.emailNotification.updateMany({
            where: {
              id,
              leaseToken: token,
              status: { in: unfinished },
              leaseUntil: { gt: new Date(now) },
            },
            data: {
              status: 'ENQUEUED',
              enqueuedAt: new Date(now),
              leaseToken: null,
              leaseUntil: null,
            },
          })
        ).count === 1
      );
    },
    async releaseDispatch(id: string, token: string, now: number) {
      await database.emailNotification.updateMany({
        where: { id, leaseToken: token, status: { in: unfinished } },
        data: {
          status: 'PENDING',
          nextAttemptAt: new Date(now + 5000),
          leaseUntil: null,
          leaseToken: null,
          lastErrorCode: 'REDIS_PUBLISH_FAILED',
        },
      });
    },
    async claimSend(
      id: string,
      clock: number | (() => number),
      token: string,
      keyIds?: string[],
    ) {
      return locked(async (tx) => {
        const now = typeof clock === 'function' ? clock() : clock;
        const row = await tx.emailNotification.findFirst({
          where: {
            id,
            status: { in: unfinished },
            nextAttemptAt: { lte: new Date(now) },
            sendAttempts: { lt: 4 },
            ...(keyIds ? { payloadKeyId: { in: keyIds } } : {}),
            ...unexpired(now),
          },
        });
        if (!row) return null;
        let payload;
        try {
          payload = crypto.open(row);
        } catch (error) {
          if (
            error instanceof Error &&
            error.message === 'EMAIL_PAYLOAD_KEY_UNAVAILABLE'
          )
            return null;
          await tx.emailNotification.update({
            where: { id },
            data: {
              status: 'FAILED',
              terminalAt: new Date(now),
              lastErrorCode: 'EMAIL_PAYLOAD_INVALID',
              leaseUntil: null,
              leaseToken: null,
            },
          });
          return null;
        }
        const reason = await suppressionReason(tx, row, payload, groups, now);
        if (reason) {
          await tx.emailNotification.update({
            where: { id },
            data: {
              status: 'SUPPRESSED',
              lastErrorCode: reason,
              terminalAt: new Date(now),
              leaseToken: null,
              leaseUntil: null,
            },
          });
          return null;
        }
        await tx.emailNotification.update({
          where: { id },
          data: {
            status: 'SENDING',
            leaseToken: token,
            leaseUntil: new Date(now + 60_000),
            sendAttempts: { increment: 1 },
          },
        });
        return {
          kind: row.kind,
          templateVersion: row.templateVersion,
          payload,
        };
      });
    },
    async retry(id: string, token: string, now: number, code: string) {
      const row = await get(id);
      if (!row || row.status !== 'SENDING' || row.leaseToken !== token) return;
      if (row.sendAttempts >= 4) {
        await finish(id, token, 'FAILED', now, code);
        return;
      }
      const delay =
        [60_000, 300_000, 1_800_000][row.sendAttempts - 1] ?? 1_800_000;
      const next = Math.min(now + delay, row.expiresAt?.getTime() ?? Infinity);
      await database.emailNotification.updateMany({
        where: sending(id, token, now),
        data: {
          status: 'PENDING',
          nextAttemptAt: new Date(next),
          leaseToken: null,
          leaseUntil: null,
          lastErrorCode: code,
        },
      });
    },
    async maintain(now: number) {
      const batch = async (
        where: Prisma.EmailNotificationWhereInput,
        data: Prisma.EmailNotificationUpdateManyMutationInput,
      ) => {
        const rows = await database.emailNotification.findMany({
          where,
          select: { id: true },
          orderBy: { id: 'asc' },
          take: 100,
        });
        if (rows.length)
          await database.emailNotification.updateMany({
            where: { AND: [where, { id: { in: rows.map((row) => row.id) } }] },
            data,
          });
      };
      await batch(
        { status: 'SENDING', leaseUntil: { lte: new Date(now) } },
        {
          status: 'UNCERTAIN',
          terminalAt: new Date(now),
          leaseToken: null,
          leaseUntil: null,
          lastErrorCode: 'SEND_LEASE_EXPIRED',
        },
      );
      await batch(
        { status: { in: unfinished }, expiresAt: { lte: new Date(now) } },
        {
          status: 'EXPIRED',
          terminalAt: new Date(now),
          leaseToken: null,
          leaseUntil: null,
          lastErrorCode: 'EMAIL_EXPIRED',
        },
      );
      const disabledKinds = [
        ...(!groups?.staffEnabled
          ? [
              'LEAD_ASSIGNED',
              'STAFF_WEBSITE_ENQUIRY_RECEIVED',
              'TASK_DUE_SOON',
              'STAFF_VIEWING_RESCHEDULED',
              'STAFF_VIEWING_CANCELLED',
            ]
          : []),
        ...(!groups?.customerViewingEnabled
          ? [
              'CUSTOMER_VIEWING_CONFIRMED',
              'CUSTOMER_VIEWING_RESCHEDULED',
              'CUSTOMER_VIEWING_CANCELLED',
              'CUSTOMER_VIEWING_REMINDER',
            ]
          : []),
      ];
      if (disabledKinds.length) {
        await batch(
          { status: { in: unfinished }, kind: { in: disabledKinds } },
          {
            status: 'SUPPRESSED',
            terminalAt: new Date(now),
            leaseToken: null,
            leaseUntil: null,
            lastErrorCode: 'EMAIL_GROUP_DISABLED',
          },
        );
      }
      await batch(
        {
          status: { in: terminalStates },
          terminalAt: { lte: new Date(now - 7 * day) },
          payloadCiphertext: { not: null },
        },
        {
          payloadCiphertext: null,
          payloadIv: null,
          payloadTag: null,
          payloadKeyId: null,
        },
      );
      const old = {
        status: { in: terminalStates },
        terminalAt: { lte: new Date(now - 90 * day) },
      };
      const rows = await database.emailNotification.findMany({
        where: old,
        select: { id: true },
        orderBy: { terminalAt: 'asc' },
        take: 100,
      });
      if (rows.length)
        await database.emailNotification.deleteMany({
          where: { ...old, id: { in: rows.map((row) => row.id) } },
        });
    },
    async replay(
      id: string,
      apply: boolean,
      acknowledge: boolean,
      now: number,
    ) {
      if (apply && !acknowledge) throw new Error('EMAIL_REPLAY_ACK_REQUIRED');
      if (!apply)
        return {
          ...(await database.emailNotification.findUnique({
            where: { id },
            select: metadata,
          })),
          applied: false,
          notificationId: undefined as string | undefined,
        };
      return locked(async (tx) => {
        const existing = await tx.emailNotification.findUnique({
          where: { replayOfId: id },
          select: { id: true, status: true },
        });
        if (existing)
          return {
            notificationId: existing.id,
            status: existing.status,
            applied: true,
          };

        const row = await tx.emailNotification.findUnique({ where: { id } });
        if (
          !row ||
          !['FAILED', 'UNCERTAIN'].includes(row.status) ||
          !row.payloadCiphertext ||
          (row.expiresAt && row.expiresAt.getTime() <= now)
        )
          throw new Error('EMAIL_REPLAY_UNAVAILABLE');
        const payload = crypto.open(row);
        if (await suppressionReason(tx, row, payload, groups, now))
          throw new Error('EMAIL_REPLAY_UNAVAILABLE');
        const childId = randomUUID();
        const child = await tx.emailNotification.create({
          data: {
            id: childId,
            dedupeKey: 'replay:' + id,
            replayOfId: id,
            kind: row.kind,
            templateVersion: row.templateVersion,
            leadId: row.leadId,
            recipientUserId: row.recipientUserId,
            taskId: row.taskId,
            viewingId: row.viewingId,
            sourceVersion: row.sourceVersion,
            scheduledStartsAt: row.scheduledStartsAt,
            scheduledEndsAt: row.scheduledEndsAt,
            expiresAt: row.expiresAt,
            createdAt: new Date(now),
            nextAttemptAt: new Date(now),
            ...crypto.seal(childId, row.kind, row.templateVersion, payload),
          },
          select: { id: true, status: true },
        });
        return {
          notificationId: child.id,
          status: child.status,
          applied: true,
        };
      });
    },
  };
}
export type EmailRepository = ReturnType<typeof createEmailRepository>;
