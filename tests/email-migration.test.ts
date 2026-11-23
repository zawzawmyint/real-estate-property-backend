import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createDatabase } from '../src/infrastructure/database/client.js';

it('adds an empty outbox, then extends a populated ledger without changing legacy intent or business history', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agency-email-migration-'));
  const db = await createDatabase(`file:${join(directory, 'test.db')}`);
  try {
    const root = new URL('../prisma/migrations/', import.meta.url);
    const names = (await readdir(root))
      .filter((name) => /^\d/.test(name))
      .sort();
    const target = names.findIndex((name) =>
      name.endsWith('_email_notifications'),
    );
    expect(target).toBeGreaterThan(0);
    const apply = async (name: string) => {
      for (const statement of (
        await readFile(new URL(`${name}/migration.sql`, root), 'utf8')
      )
        .split(';')
        .map((part) => part.trim())
        .filter(Boolean))
        await db.$executeRawUnsafe(statement);
    };
    for (const name of names.slice(0, target)) await apply(name);
    await db.$executeRaw`INSERT INTO Lead (id,name,searchName,searchPhone,searchEmail,searchPropertyTitle,purpose,source,stage,version,createdAt,updatedAt) VALUES ('historical','Historical','historical','','','','sale','call','won',7,123456789,123456789)`;
    await db.$executeRaw`INSERT INTO LeadActivity (id,leadId,type,createdAt) VALUES ('activity','historical','created',123456789)`;
    await db.$executeRaw`INSERT INTO LeadSubmissionReceipt (id,operation,actorScope,payloadHash,leadId,createdAt) VALUES ('receipt','create','staff','hash','historical',123456789)`;
    const before = await db.$queryRaw`SELECT * FROM Lead`;
    const history = await db.$queryRaw`SELECT * FROM LeadActivity`;
    const receipts = await db.$queryRaw`SELECT * FROM LeadSubmissionReceipt`;
    await apply(names[target]!);
    expect(await db.emailNotification.count()).toBe(0);
    await db.$executeRaw`INSERT INTO "EmailNotification" (id,dedupeKey,kind,templateVersion,leadId,status,nextAttemptAt,expiresAt,payloadCiphertext,payloadIv,payloadTag,payloadKeyId,sendAttempts)
      VALUES ('legacy','WEBSITE_ENQUIRY_RECEIVED:historical','WEBSITE_ENQUIRY_RECEIVED',1,'historical','UNCERTAIN',123456789,234567891,'sealed','iv','tag','key',1)`;
    const legacy = await db.$queryRaw<
      Record<string, unknown>[]
    >`SELECT * FROM EmailNotification`;
    for (const name of names.slice(target + 1)) await apply(name);
    expect(await db.$queryRaw`SELECT * FROM EmailNotification`).toEqual([
      {
        ...legacy[0],
        recipientUserId: null,
        taskId: null,
        viewingId: null,
        sourceVersion: null,
        scheduledStartsAt: null,
        scheduledEndsAt: null,
      },
    ]);
    expect(await db.$queryRaw`SELECT * FROM Lead`).toEqual(before);
    expect(await db.$queryRaw`SELECT * FROM LeadActivity`).toEqual(history);
    expect(await db.$queryRaw`SELECT * FROM LeadSubmissionReceipt`).toEqual(
      receipts,
    );
    expect(await db.emailNotification.count()).toBe(1);
  } finally {
    await db.$disconnect();
    await rm(directory, { recursive: true, force: true });
  }
});
