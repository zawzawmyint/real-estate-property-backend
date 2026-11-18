import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createDatabase } from '../src/infrastructure/database/client.js';
const testEnvironment = {
  ...process.env,
  NODE_ENV: 'test',
  BETTER_AUTH_SECRET: 'isolated-temperature-test-secret-at-least-32-characters',
};

it('migrates historical leads without rewriting versions, timestamps, history or receipts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agency-temperature-'));
  const databaseUrl = `file:${join(directory, 'agency.db')}`;
  const db = await createDatabase(databaseUrl);
  const root = new URL('../prisma/migrations/', import.meta.url);
  const names = (await readdir(root)).filter((name) => /^\d/.test(name)).sort();
  const target = names.findIndex((name) => name.endsWith('_lead_temperature'));
  try {
    expect(target).toBeGreaterThan(0);
    const apply = async (name: string) => {
      const sql = await readFile(
        new URL(`${name}/migration.sql`, root),
        'utf8',
      );
      for (const statement of sql
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean))
        await db.$executeRawUnsafe(statement);
    };
    for (const name of names.slice(0, target)) await apply(name);
    await db.$executeRawUnsafe(
      `INSERT INTO Lead (id,name,searchName,searchPhone,searchEmail,searchPropertyTitle,purpose,source,stage,version,createdAt,updatedAt) VALUES ('historical','Historical','historical','','','','sale','call','won',7,123456789,123456789)`,
    );
    await db.$executeRawUnsafe(
      `INSERT INTO LeadActivity (id,leadId,type,createdAt) VALUES ('activity','historical','created',123456789)`,
    );
    await db.$executeRawUnsafe(
      `INSERT INTO LeadSubmissionReceipt (id,operation,actorScope,payloadHash,leadId,createdAt) VALUES ('receipt','create','staff','hash','historical',123456789)`,
    );
    const before =
      await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
        'SELECT * FROM Lead',
      );
    const receipts = await db.$queryRawUnsafe(
      'SELECT * FROM LeadSubmissionReceipt',
    );
    for (const name of names.slice(target)) await apply(name);
    expect(await db.$queryRawUnsafe('SELECT * FROM Lead')).toEqual([
      { ...before[0], temperature: 'unassessed' },
    ]);
    expect(
      await db.$queryRawUnsafe('SELECT * FROM LeadSubmissionReceipt'),
    ).toEqual(receipts);
    expect(
      await db.leadActivity.findUniqueOrThrow({ where: { id: 'activity' } }),
    ).toMatchObject({ previousTemperature: null, nextTemperature: null });
    const plan = await db.$queryRawUnsafe<Array<{ detail: string }>>(
      `EXPLAIN QUERY PLAN SELECT id FROM Lead WHERE temperature='hot' ORDER BY createdAt,id`,
    );
    expect(plan.map((row) => row.detail).join(' ')).toContain(
      'Lead_temperature_createdAt_id_idx',
    );
    expect(await db.$queryRawUnsafe('PRAGMA foreign_key_check')).toEqual([]);
    // Real migration command is exercised twice on a fresh disposable DB.
    const freshUrl = `file:${join(directory, 'fresh.db')}`;
    for (let i = 0; i < 2; i++) {
      const result = spawnSync(
        process.execPath,
        ['--import', 'tsx', 'scripts/migrate-database.ts'],
        {
          env: { ...testEnvironment, DATABASE_URL: freshUrl },
          encoding: 'utf8',
          timeout: 30000,
        },
      );
      expect(result.status, result.stdout + result.stderr).toBe(0);
    }
    const check = spawnSync(
      process.execPath,
      ['--import', 'tsx', 'scripts/check-database.ts'],
      {
        env: { ...testEnvironment, DATABASE_URL: freshUrl },
        encoding: 'utf8',
        timeout: 30000,
      },
    );
    expect(check.status, check.stdout + check.stderr).toBe(0);
  } finally {
    await db.$disconnect();
    await rm(directory, { recursive: true, force: true });
  }
}, 60000);
