import { Prisma } from '../../generated/prisma/client.js';
import type { Transaction } from '../../infrastructure/database/transaction.js';
import type { ListQuery, ActorQuery } from './audit-log.schema.js';

export async function listEvents(tx: Transaction, q: ListQuery) {
  const where: Prisma.RecordAuditEventWhereInput = {
    occurredAt: { gte: q.from, lt: q.to },
  };
  for (const key of [
    'actorId',
    'actorKind',
    'entityType',
    'entityId',
    'action',
    'importId',
  ] as const)
    if (q[key] !== undefined) where[key] = q[key];

  const total = await tx.recordAuditEvent.count({ where });
  const skip = (q.page - 1) * q.pageSize;
  const rows =
    skip >= total
      ? []
      : await tx.recordAuditEvent.findMany({
          select: {
            id: true,
            schemaVersion: true,
            occurredAt: true,
            actorKind: true,
            actorId: true,
            actorName: true,
            actorRole: true,
            entityType: true,
            entityId: true,
            entityLabel: true,
            action: true,
            changesJson: true,
            importId: true,
            importKind: true,
            createdCount: true,
          },
          where,
          orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
          skip,
          take: q.pageSize,
        });

  const available = new Set<string>();
  for (const type of ['property', 'lead', 'viewing', 'task'] as const) {
    const ids = rows
      .filter((row) => row.entityType === type)
      .map((row) => row.entityId);
    if (!ids.length) continue;
    const query = { where: { id: { in: ids } }, select: { id: true } } as const;
    const found =
      type === 'property'
        ? await tx.property.findMany(query)
        : type === 'lead'
          ? await tx.lead.findMany(query)
          : type === 'viewing'
            ? await tx.viewing.findMany(query)
            : await tx.task.findMany(query);
    for (const { id } of found) available.add(type + ':' + id);
  }

  const coverage = await tx.recordAuditCoverage.findUniqueOrThrow({
    where: { id: 1 },
    select: { startedAt: true, coverageVersion: true },
  });

  return {
    rows,
    available,
    page: q.page,
    pageSize: q.pageSize,
    total,
    coverage,
  };
}

export async function listActors(tx: Transaction, q: ActorQuery) {
  const latest = Prisma.sql`WITH ranked AS (
 SELECT actorId AS id,actorName AS name,actorRole AS role,
 ROW_NUMBER() OVER(PARTITION BY actorId ORDER BY occurredAt DESC,id DESC) AS ordinal
 FROM RecordAuditEvent WHERE actorKind='staff'
 )`;
  const filter = Prisma.sql`WHERE ordinal=1 AND instr(lower(name),lower(${q.q ?? ''}))>0`;

  const [count] = await tx.$queryRaw<{ n: bigint }[]>(
    Prisma.sql`${latest} SELECT COUNT(*) AS n FROM ranked ${filter}`,
  );
  const total = Number(count!.n),
    offset = (q.page - 1) * q.pageSize;
  const items =
    offset >= total
      ? []
      : await tx.$queryRaw<{ id: string; name: string; role: string }[]>(
          Prisma.sql`${latest} SELECT id,name,role FROM ranked ${filter} ORDER BY name,id LIMIT ${q.pageSize} OFFSET ${offset}`,
        );

  return { items, page: q.page, pageSize: q.pageSize, total };
}

export async function insertEvent(
  tx: Transaction,
  data: Prisma.RecordAuditEventCreateInput,
) {
  await tx.recordAuditEvent.create({ data, select: { id: true } });
}
