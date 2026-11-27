import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
import { createDatabase } from '../src/infrastructure/database/client.js';
import { auditLogDto } from '../src/modules/audit-log/audit-log.dto.js';
import { listEvents } from '../src/modules/audit-log/audit-log.repository.js';

it('activates once on a populated database without backfill and uses indexes on large bounded pages', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agency-audit-migration-'));
  const db = await createDatabase('file:' + join(directory, 'audit.db'));
  try {
    const root = new URL('../prisma/migrations/', import.meta.url);
    const names = (await readdir(root)).filter((n) => /^\d/.test(n)).sort();
    const target = names.findIndex((n) => n.endsWith('_record_audit_log'));
    expect(target).toBeGreaterThan(0);
    async function apply(name: string) {
      const sql = await readFile(
        new URL(name + '/migration.sql', root),
        'utf8',
      );
      for (const statement of sql
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean))
        await db.$executeRawUnsafe(statement);
    }
    for (const name of names.slice(0, target)) await apply(name);
    await db.property.create({
      data: { id: 'historical', title: 'Existing property', purpose: 'sale' },
    });
    const before = await db.property.findMany();
    await apply(names[target]!);
    expect(await db.property.findMany()).toEqual(before);
    expect(await db.recordAuditEvent.count()).toBe(0);
    expect(await db.recordAuditCoverage.findMany()).toEqual([
      { id: 1, coverageVersion: 1, startedAt: expect.any(Date) },
    ]);
    await db.$executeRaw`WITH RECURSIVE seq(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM seq WHERE i<10000)
 INSERT INTO RecordAuditEvent (id,occurredAt,actorKind,actorId,entityType,entityId,entityLabel,action,changesJson,importId)
 SELECT printf('%08x-0000-4000-8000-000000000000',i),'2026-01-15T00:00:00.000Z','staff','old','property','historical','Existing property','property.created','[]','batch' FROM seq`;
    const page = auditLogDto(
      await db.$transaction((tx) =>
        listEvents(tx, {
          from: new Date('2026-01-01T00:00Z'),
          to: new Date('2026-02-01T00:00Z'),
          page: 99,
          pageSize: 100,
        }),
      ),
    );
    expect(page.total).toBe(10000);
    expect(page.items).toHaveLength(100);
    expect(page.items[0]?.entity.available).toBe(true);
    for (const [predicate, index] of [
      ['', 'occurredAt_id'],
      [
        "AND entityType='property' AND entityId='historical'",
        'entityType_entityId_occurredAt_id',
      ],
      ["AND actorId='old'", 'actorId_occurredAt_id'],
      ["AND action='property.created'", 'action_occurredAt_id'],
      ["AND importId='batch'", 'importId_occurredAt_id'],
    ]) {
      const plan = await db.$queryRawUnsafe<{ detail: string }[]>(
        "EXPLAIN QUERY PLAN SELECT id FROM RecordAuditEvent WHERE occurredAt>='2026-01-01' AND occurredAt<'2026-02-01' " +
          predicate +
          ' ORDER BY occurredAt DESC,id DESC LIMIT 100 OFFSET 9800',
      );
      expect(plan.map((row) => row.detail).join(' ')).toContain(
        'RecordAuditEvent_' + index + '_idx',
      );
    }
  } finally {
    await db.$disconnect();
    await rm(directory, { recursive: true, force: true });
  }
});
