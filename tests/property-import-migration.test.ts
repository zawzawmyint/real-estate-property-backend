import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createDatabase } from '../src/infrastructure/database/client.js';

it('adds durable import receipts to a populated database without changing properties', async () => {
  const directory = await mkdtemp(
    join(tmpdir(), 'agency-property-import-migrate-'),
  );
  const database = await createDatabase(`file:${join(directory, 'agency.db')}`);
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
    const index = names.findIndex((name) => name.endsWith('_property_import'));
    expect(index).toBeGreaterThan(0);
    for (const name of names.slice(0, index)) await apply(name);
    const property = await database.property.create({
      data: {
        title: 'Existing populated property',
        purpose: 'sale',
        ownerName: 'Private owner',
      },
    });
    for (const name of names.slice(index)) await apply(name);
    expect(
      await database.property.findUniqueOrThrow({ where: { id: property.id } }),
    ).toEqual(property);
    expect(await database.propertyImportReceipt.count()).toBe(0);
    await database.propertyImportReceipt.create({
      data: {
        id: 'receipt',
        actorId: 'historical-staff',
        contentDigest: 'digest',
        schemaVersion: 1,
        createdCount: 1,
        propertyIdsJson: JSON.stringify([property.id]),
      },
    });
    await database.property.delete({ where: { id: property.id } });
    expect(await database.propertyImportReceipt.count()).toBe(1);
    expect(await database.$queryRawUnsafe('PRAGMA foreign_key_check')).toEqual(
      [],
    );
  } finally {
    await database.$disconnect();
    await rm(directory, { recursive: true, force: true });
  }
});
