import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import { createDatabase } from '../src/infrastructure/database/client.js';
import { createStaffAuth } from '../src/modules/auth/auth.js';
import { createApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import request from 'supertest';
import { backfillPropertySearch } from '../src/modules/properties/property-search.js';
import { backfillLeadSearch } from '../src/modules/leads/lead-search.js';

it('deploys auth migrations into a missing nested SQLite file and can be rerun', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agency-migrate-test-'));
  const databaseUrl = `file:${join(directory, 'nested', 'agency.db').replaceAll('\\', '/')}`;
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_URL: databaseUrl,
    APP_ORIGIN: 'http://localhost:3100',
    BETTER_AUTH_URL: 'http://localhost:3100/api/v1/auth',
    BETTER_AUTH_SECRET: 'isolated-migration-test-secret-at-least-32-characters',
  };

  try {
    const run = () =>
      spawnSync(
        process.execPath,
        ['--import', 'tsx', 'scripts/migrate-database.ts'],
        {
          cwd: resolve('.'),
          env,
          encoding: 'utf8',
          timeout: 30_000,
          stdio: 'pipe',
        },
      );
    const first = run();

    expect(first.status).toBe(0);
    expect(first.stdout).toContain(
      'All migrations have been successfully applied.',
    );

    const second = run();

    expect(second.status).toBe(0);
    expect(second.stdout).toContain('No pending migrations to apply.');

    const database = await createDatabase(databaseUrl);

    try {
      const tables = await database.$queryRawUnsafe<Array<{ name: string }>>(
        "SELECT name FROM sqlite_master WHERE type = 'table'",
      );

      expect(tables.map((table) => table.name)).toEqual(
        expect.arrayContaining([
          'User',
          'Session',
          'Account',
          'Property',
          'PropertyPhoto',
          'Lead',
          'LeadNote',
          'LeadActivity',
          'LeadSubmissionReceipt',
          'Viewing',
          'Task',
        ]),
      );
    } finally {
      await database.$disconnect();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 60_000);

it('upgrades an existing auth database without losing credentials and persists properties across reconnect', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agency-property-upgrade-'));
  const env = parseEnv({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: `file:${join(directory, 'agency.db')}`,
    STORAGE_ROOT: join(directory, 'media'),
    BETTER_AUTH_SECRET: 'migration-test-secret-for-existing-auth-12345',
  });
  const database = await createDatabase(env.DATABASE_URL);
  const migrationRoot = new URL('../prisma/migrations/', import.meta.url);
  const names = (await readdir(migrationRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  async function apply(name: string) {
    const sql = await readFile(
      new URL(`${name}/migration.sql`, migrationRoot),
      'utf8',
    );

    for (const statement of sql
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean))
      await database.$executeRawUnsafe(statement);
  }

  try {
    const propertyMigrationIndex = names.findIndex((name) =>
      name.endsWith('_properties'),
    );
    for (const name of names.slice(0, propertyMigrationIndex))
      await apply(name);

    const auth = createStaffAuth(env, database);

    // Write a genuine pre-upgrade credential using the installed native hash
    // primitive. The current generated Prisma User model includes new columns
    // and intentionally cannot operate against this older schema yet.
    const password = await (
      await auth.$context
    ).password.hash('Existing-password-123!');
    await database.$executeRaw`INSERT INTO User
      (id,name,email,emailVerified,role,disabled,createdAt,updatedAt)
      VALUES ('legacy-admin','Éxisting Admin','existing@example.test',false,'admin',false,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`;
    await database.$executeRaw`INSERT INTO Account
      (id,accountId,providerId,userId,password,createdAt,updatedAt)
      VALUES ('legacy-credential','legacy-admin','credential','legacy-admin',${password},CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`;

    await apply(names[propertyMigrationIndex]!);
    await database.$executeRaw`INSERT INTO Property (id, title, purpose, city, community, updatedAt)
      VALUES ('legacy-search', 'Étage %_', 'sale', 'MÜNCHEN', 'Canal_', '2026-01-01T00:00:00.000Z')`;
    for (const name of names.slice(propertyMigrationIndex + 1))
      await apply(name);
    await backfillPropertySearch(database);
    await backfillPropertySearch(database);
    await backfillLeadSearch(database);
    await backfillLeadSearch(database);
    expect(
      (await database.user.findUniqueOrThrow({ where: { id: 'legacy-admin' } }))
        .searchName,
    ).toBe('éxisting admin');
    const legacy = await database.property.findUniqueOrThrow({
      where: { id: 'legacy-search' },
    });
    expect(legacy).toMatchObject({
      searchTitle: 'étage %_',
      searchCity: 'münchen',
      searchCommunity: 'canal_',
    });
    expect(legacy.updatedAt.toISOString()).toBe('2026-01-01T00:00:00.000Z');

    const app = createApp(env, auth, database);
    const login = await request(app)
      .post('/api/v1/auth/sign-in/email')
      .set('Origin', env.APP_ORIGIN)
      .send({
        email: 'existing@example.test',
        password: 'Existing-password-123!',
        rememberMe: true,
      });

    expect(login.status).toBe(200);

    const cookie = (
      login.headers['set-cookie'] as unknown as string[]
    )[0]!.split(';')[0]!;
    const property = await request(app)
      .post('/api/v1/staff/properties')
      .set('Origin', env.APP_ORIGIN)
      .set('Cookie', cookie)
      .send({
        title: 'Persistent',
        purpose: 'sale',
        priceFils: 1_000_000_000_000,
        areaSqft: '1000000',
      });

    expect(property.status, JSON.stringify(property.body)).toBe(201);
    expect(property.body.areaSqft).toBe('1000000.00');
    await database.$disconnect();

    const reopened = await createDatabase(env.DATABASE_URL);

    try {
      expect(await reopened.user.count()).toBe(1);
      expect(await reopened.viewing.count()).toBe(0);
      expect(await reopened.task.count()).toBe(0);

      const saved = await reopened.property.findUniqueOrThrow({
        where: { id: property.body.id },
      });

      expect(saved.priceFils).toBe(1_000_000_000_000n);
      expect(saved.areaHundredths).toBe(100_000_000);

      const session = await request(
        createApp(env, createStaffAuth(env, reopened), reopened),
      )
        .get('/api/v1/auth/get-session')
        .set('Cookie', cookie);

      expect(session.body.user.email).toBe('existing@example.test');
    } finally {
      await reopened.$disconnect();
    }
  } finally {
    await database.$disconnect();
    await rm(directory, { recursive: true, force: true });
  }
});
it('adds tasks to populated lead/viewing data without changing history and enforces task relations', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agency-task-upgrade-'));
  const database = await createDatabase(`file:${join(directory, 'agency.db')}`);
  const root = new URL('../prisma/migrations/', import.meta.url);
  const names = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  async function apply(name: string) {
    for (const statement of (
      await readFile(new URL(`${name}/migration.sql`, root), 'utf8')
    )
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean))
      await database.$executeRawUnsafe(statement);
  }
  try {
    const index = names.findIndex((name) => name.endsWith('_follow_up_tasks'));
    expect(index).toBeGreaterThan(0);
    for (const name of names.slice(0, index)) await apply(name);
    const user = await database.user.create({
      data: {
        id: 'task-creator',
        name: 'Creator',
        email: 'creator@task-upgrade.test',
      },
    });
    const property = await database.property.create({
      data: { title: 'Existing property', purpose: 'sale' },
    });
    const lead = await database.lead.create({
      data: {
        name: 'Existing lead',
        purpose: 'sale',
        source: 'walk_in',
        searchName: 'existing lead',
        searchPhone: '',
        searchEmail: '',
        searchPropertyTitle: '',
        assignedAgentId: user.id,
      },
    });
    const viewing = await database.viewing.create({
      data: {
        submissionId: 'legacy-viewing',
        actorScope: user.id,
        payloadHash: 'legacy',
        leadId: lead.id,
        propertyId: property.id,
        propertyTitleSnapshot: property.title,
        startsAt: new Date('2027-01-01T00:00:00Z'),
        endsAt: new Date('2027-01-01T01:00:00Z'),
      },
    });
    for (const name of names.slice(index)) await apply(name);
    expect(await database.task.count()).toBe(0);
    expect(
      await database.lead.findUniqueOrThrow({ where: { id: lead.id } }),
    ).toEqual(lead);
    expect(
      await database.viewing.findUniqueOrThrow({ where: { id: viewing.id } }),
    ).toEqual(viewing);
    const task = await database.task.create({
      data: {
        submissionId: 'migration-task',
        actorScope: user.id,
        payloadHash: 'hash',
        leadId: lead.id,
        title: 'Follow up',
        dueAt: new Date('2030-01-01T00:00:00Z'),
        createdById: user.id,
      },
    });
    await expect(
      database.lead.delete({ where: { id: lead.id } }),
    ).rejects.toThrow();
    await database.user.delete({ where: { id: user.id } });
    expect(
      await database.task.findUniqueOrThrow({ where: { id: task.id } }),
    ).toMatchObject({
      createdById: null,
      actorScope: user.id,
      leadId: lead.id,
    });
    expect(await database.$queryRawUnsafe('PRAGMA foreign_key_check')).toEqual(
      [],
    );
  } finally {
    await database.$disconnect();
    await rm(directory, { recursive: true, force: true });
  }
});
