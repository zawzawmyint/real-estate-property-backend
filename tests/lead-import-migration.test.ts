import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import { createDatabase } from '../src/infrastructure/database/client.js';

it('adds batch receipts to a populated database and passes disposable db:check without changing existing leads/history', async () => {
  const directory = await mkdtemp(
    join(tmpdir(), 'agency-lead-import-migrate-'),
  );
  const databaseUrl = `file:${join(directory, 'agency.db')}`;
  const database = await createDatabase(databaseUrl);
  const root = new URL('../prisma/migrations/', import.meta.url);
  const names = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  async function apply(name: string) {
    const sql = await readFile(new URL(`${name}/migration.sql`, root), 'utf8');
    for (const statement of sql
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean))
      await database.$executeRawUnsafe(statement);
  }
  try {
    const index = names.findIndex((name) => name.endsWith('_lead_import'));
    expect(index).toBeGreaterThan(0);
    for (const name of names.slice(0, index)) await apply(name);
    const lead = await database.lead.create({
      select: { id: true, name: true },
      data: {
        name: 'Existing',
        email: 'existing@example.test',
        searchName: 'existing',
        searchPhone: '',
        searchEmail: 'existing@example.test',
        searchPropertyTitle: '',
        purpose: 'sale',
        source: 'call',
        budgetFils: 1000000000000n,
      },
    });
    const activity = await database.leadActivity.create({
      data: { leadId: lead.id, type: 'created' },
    });
    const singleReceipt = await database.leadSubmissionReceipt.create({
      data: {
        id: 'single',
        operation: 'create',
        actorScope: 'historical-staff',
        payloadHash: 'hash',
        leadId: lead.id,
      },
    });
    for (const name of names.slice(index)) await apply(name);
    expect(
      await database.lead.findUniqueOrThrow({ where: { id: lead.id } }),
    ).toMatchObject(lead);
    expect(
      await database.leadActivity.findUniqueOrThrow({
        where: { id: activity.id },
      }),
    ).toEqual(activity);
    expect(
      await database.leadSubmissionReceipt.findUniqueOrThrow({
        where: { id: 'single' },
      }),
    ).toEqual(singleReceipt);
    expect(await database.leadImportReceipt.count()).toBe(0);
    await database.leadImportReceipt.create({
      data: {
        id: 'batch',
        actorId: 'historical-staff',
        contentDigest: 'digest',
        schemaVersion: 1,
        createdCount: 1,
        leadIdsJson: JSON.stringify([lead.id]),
      },
    });
    const receiptColumns = await database.$queryRawUnsafe<
      Array<{ name: string }>
    >('PRAGMA table_info(LeadImportReceipt)');
    expect(receiptColumns.map((column) => column.name)).toEqual([
      'id',
      'actorId',
      'contentDigest',
      'schemaVersion',
      'createdCount',
      'leadIdsJson',
      'createdAt',
    ]);
    expect(await database.$queryRawUnsafe('PRAGMA foreign_key_check')).toEqual(
      [],
    );
    const checked = spawnSync(
      process.execPath,
      [
        '--env-file-if-exists=.env',
        '--import',
        'tsx',
        'scripts/check-database.ts',
      ],
      {
        cwd: resolve('.'),
        env: {
          ...process.env,
          NODE_ENV: 'test',
          DATABASE_URL: databaseUrl,
          BETTER_AUTH_SECRET:
            'isolated-lead-import-database-check-secret-at-least-32',
        },
        encoding: 'utf8',
        timeout: 30000,
      },
    );
    expect(checked.status, checked.stderr).toBe(0);
    expect(checked.stdout).toContain(
      'SQLite connection, agency tables, property and lead search verified.',
    );
  } finally {
    await database.$disconnect();
    await rm(directory, { recursive: true, force: true });
  }
});
