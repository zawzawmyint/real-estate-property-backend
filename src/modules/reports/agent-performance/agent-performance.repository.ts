import { Prisma } from '../../../generated/prisma/client.js';
import type { Transaction } from '../../../infrastructure/database/transaction.js';
import { AppError } from '../../../shared/errors/app-error.js';
import type {
  AttributionActivity,
  AttributionLead,
} from './agent-performance.metrics.js';
import type { ReportRange } from './agent-performance.schema.js';

const sql = Prisma.sql;
const activityLimit = 100_000;
export const identityLimit = 2_000;

export function reportTooLarge(): never {
  throw new AppError(
    422,
    'REPORT_TOO_LARGE',
    'Narrow the dates or select one agent.',
  );
}

// Adapter ISO text, SQLite CURRENT_TIMESTAMP text, and legacy Unix milliseconds.
const timestamp = sql`CASE WHEN typeof(a.createdAt) IN ('integer','real') THEN CAST(a.createdAt AS INTEGER)
  ELSE CAST(round(unixepoch(a.createdAt, 'subsec') * 1000) AS INTEGER) END`;
const change = sql`(a.type IN ('created','unassigned') OR (a.type='assigned' AND (a.nextAgentId IS NULL OR a.nextAgentId IS NOT a.previousAgentId)))`;
const follow = sql`(a.type='call_logged' OR (a.type='stage_changed' AND a.previousStage='new' AND a.nextStage='contacted'))`;
const win = sql`(a.type='stage_changed' AND a.nextStage='won' AND a.previousStage IS NOT 'won')`;

// A tied cycle starts and ends at its incoming owner. Walk back through just
// those cycles until an independent handover supplies that witness.
function scopedSelection(id: string, start: number) {
  return sql`
    , changes AS MATERIALIZED (
      SELECT e.leadId,e.t,
        max(a.nextAgentId IS ${id}) AS enters,
        max(a.previousAgentId IS ${id} OR a.nextAgentId IS ${id}) AS touches,
        count(*) AS n, max(a.type='created') AS hasCreation,
        min(a.nextAgentId) AS destination,min(a.previousAgentId) AS predecessor,
        max((a.type='assigned' AND a.nextAgentId IS NULL) OR
            (a.nextAgentId IS NULL AND a.nextAgentName IS NOT NULL) OR
            (a.type='unassigned' AND a.nextAgentId IS NOT NULL)) AS unknownDestination
      FROM events e JOIN LeadActivity a ON a.rowid=e.r WHERE e.changes
      GROUP BY e.leadId,e.t
    ), spans AS MATERIALIZED (
      SELECT *, lag(t) OVER ordered AS priorT,lead(t) OVER ordered AS nextT,
        lead(predecessor) OVER ordered AS nextPredecessor,lead(n) OVER ordered AS nextN,
        lag(enters) OVER ordered AS priorEnters
      FROM changes WINDOW ordered AS (PARTITION BY leadId ORDER BY t)
    ), tiedEdges AS (
      SELECT e.leadId,e.t,a.previousAgentId,a.nextAgentId FROM spans s
      JOIN events e ON e.leadId=s.leadId AND e.t=s.t AND e.changes
      JOIN LeadActivity a ON a.rowid=e.r
      WHERE s.n>1 AND NOT s.hasCreation AND NOT s.unknownDestination
    ), degreeChanges(leadId,t,owner,delta) AS (
      SELECT leadId,t,previousAgentId,1 FROM tiedEdges UNION ALL
      SELECT leadId,t,nextAgentId,-1 FROM tiedEdges
    ), degrees AS (
      SELECT leadId,t,owner,sum(delta) AS net FROM degreeChanges GROUP BY leadId,t,owner
    ), cycles AS (
      SELECT leadId,t FROM degrees GROUP BY leadId,t HAVING max(abs(net))=0
    ), owned AS (
      SELECT e.*,max(CASE WHEN changes THEN t END) OVER
        (PARTITION BY leadId ORDER BY t RANGE UNBOUNDED PRECEDING) AS changeT
      FROM events e
    ), signals AS MATERIALIZED (
      SELECT o.r,o.leadId,s.t AS anchorT,s.priorT,s.nextT
      FROM owned o JOIN LeadActivity a ON a.rowid=o.r
      LEFT JOIN spans s ON s.leadId=o.leadId AND s.t=o.changeT
      LEFT JOIN firstWins w ON w.leadId=o.leadId
      WHERE o.t>=${start} AND (
        (o.changes AND a.nextAgentId=${id})
        OR ((o.follows OR (o.wins AND o.t=w.t)) AND (
          s.enters OR (s.t=o.t AND (s.touches OR s.priorEnters))
          OR (o.follows AND a.actorId=${id} AND (
            s.t IS NULL OR s.unknownDestination OR s.n>1 OR s.nextN>1
            OR s.destination IS NOT s.nextPredecessor OR s.nextT IS NULL OR s.t=o.t
          ))
        )))
    ), neededTimes(leadId,t) AS (
      SELECT leadId,anchorT FROM signals UNION SELECT leadId,priorT FROM signals
      UNION SELECT leadId,nextT FROM signals
      UNION SELECT s.leadId,s.priorT FROM neededTimes n
        JOIN cycles c ON c.leadId=n.leadId AND c.t=n.t
        JOIN spans s ON s.leadId=n.leadId AND s.t=n.t WHERE s.priorT IS NOT NULL
    ), selected(r) AS (
      SELECT r FROM signals
      UNION SELECT e.r FROM neededTimes n JOIN events e ON e.leadId=n.leadId AND e.t=n.t WHERE e.changes
      UNION SELECT e.r FROM events e JOIN LeadActivity a ON a.rowid=e.r
        JOIN (SELECT DISTINCT leadId FROM signals) c ON c.leadId=e.leadId WHERE a.type='created'
    )`;
}

function agencySelection(start: number) {
  return sql`
    , candidates AS (
      SELECT DISTINCT e.leadId FROM events e JOIN LeadActivity a ON a.rowid=e.r
      LEFT JOIN firstWins w ON w.leadId=e.leadId
      WHERE e.t>=${start} AND (e.follows OR (e.wins AND e.t=w.t) OR
        (e.changes AND (a.type='assigned' OR a.nextAgentId IS NOT NULL OR a.nextAgentName IS NOT NULL)))
    ), selected(r) AS (
      SELECT e.r FROM candidates c JOIN events e ON e.leadId=c.leadId
      LEFT JOIN firstWins w ON w.leadId=e.leadId
      WHERE e.changes OR (e.t>=${start} AND (e.follows OR (e.wins AND w.t=e.t)))
    )`;
}

export function activityQuery(range: ReportRange, id?: string) {
  const start = range.rangeStart.getTime();
  const allowedLeads =
    id === undefined
      ? Prisma.empty
      : sql`AND a.leadId IN (
    SELECT leadId FROM LeadActivity WHERE nextAgentId=${id} OR previousAgentId=${id} OR actorId=${id}
  )`;
  const allowedActors =
    id === undefined
      ? Prisma.empty
      : sql`AND (a.actorId=${id} OR a.actorId IS NULL)`;
  // Pack the bounded projection in SQLite to avoid transferring a million scalar
  // cells through Prisma. Overflow never materializes the attribution payload.
  return sql`WITH RECURSIVE events AS MATERIALIZED (
    SELECT a.rowid AS r,a.leadId,${timestamp} AS t,${change} AS changes,${follow} AS follows,${win} AS wins
    FROM LeadActivity a WHERE (${change} OR (${follow} ${allowedActors} AND ${timestamp}>=${start}) OR ${win})
    AND ${timestamp}<${range.rangeEndExclusive.getTime()} AND ${timestamp}<=${range.generatedAt.getTime()}
    ${allowedLeads}
  ), firstWins AS (SELECT leadId,min(t) AS t FROM events WHERE wins GROUP BY leadId)
  ${id === undefined ? agencySelection(start) : scopedSelection(id, start)}
  , capped AS MATERIALIZED (SELECT r FROM selected LIMIT ${activityLimit + 1})
  SELECT CASE WHEN (SELECT count(*) FROM capped)>${activityLimit} THEN NULL ELSE (
    SELECT json_group_array(json_array(a.id,a.leadId,${timestamp},a.type,a.actorId,a.previousAgentId,
      a.previousAgentName,a.nextAgentId,a.nextAgentName,a.previousStage,a.nextStage))
    FROM capped c CROSS JOIN LeadActivity a ON a.rowid=c.r
  ) END AS packed`;
}

type PackedActivity = [
  string,
  string,
  number,
  string,
  string | null,
  string | null,
  string | null,
  string | null,
  string | null,
  string | null,
  string | null,
];

export async function reportHistory(
  tx: Transaction,
  range: ReportRange,
  id?: string,
) {
  const [result] = await tx.$queryRaw<{ packed: string | null }[]>(
    activityQuery(range, id),
  );
  if (!result || result.packed === null) reportTooLarge();
  const rows = JSON.parse(result.packed) as PackedActivity[];
  const activities: AttributionActivity[] = rows.map(
    ([
      id,
      leadId,
      time,
      type,
      actorId,
      previousAgentId,
      previousAgentName,
      nextAgentId,
      nextAgentName,
      previousStage,
      nextStage,
    ]) => ({
      id,
      leadId,
      createdAt: new Date(time),
      type,
      actorId,
      previousAgentId,
      previousAgentName,
      nextAgentId,
      nextAgentName,
      previousStage,
      nextStage,
    }),
  );
  const ids = [...new Set(activities.map((e) => e.leadId))];
  const leads = ids.length ? await boundaryOwners(tx, range, ids) : [];
  return { activities, leads };
}

async function boundaryOwners(
  tx: Transaction,
  range: ReportRange,
  ids: string[],
): Promise<AttributionLead[]> {
  const historical = range.rangeEndExclusive <= range.generatedAt;
  const eligible = sql`SELECT value AS id FROM json_each(${JSON.stringify(ids)})`;
  const anchors = historical
    ? sql`, future AS MATERIALIZED (
    SELECT a.leadId,${timestamp} AS t,a.previousAgentId,a.previousAgentName,a.nextAgentId,a.nextAgentName,a.type FROM eligible e
    CROSS JOIN LeadActivity a ON a.leadId=e.id WHERE a.type IN ('assigned','unassigned') AND ${change}
    AND ${timestamp}>=${range.rangeEndExclusive.getTime()} AND ${timestamp}<=${range.generatedAt.getTime()}
  ), groups AS (
    SELECT leadId,t,min(previousAgentId) AS previousId,count(*) AS n,
      max(previousAgentId IS NULL AND previousAgentName IS NOT NULL) AS unknownPrevious,
      max((nextAgentId IS NULL AND (type='assigned' OR nextAgentName IS NOT NULL))
          OR (type='unassigned' AND nextAgentId IS NOT NULL)) AS unknownNext
    FROM future GROUP BY leadId,t
  ), tied AS (
    SELECT e.* FROM future e JOIN groups g USING(leadId,t)
    WHERE g.n>1 AND NOT g.unknownPrevious AND NOT g.unknownNext
  ), deltas(leadId,t,owner,delta) AS (
    SELECT leadId,t,previousAgentId,1 FROM tied UNION ALL SELECT leadId,t,nextAgentId,-1 FROM tied
  ), degrees AS (SELECT leadId,t,owner,sum(delta) AS net FROM deltas GROUP BY leadId,t,owner),
  shapes AS (
    SELECT leadId,t,max(CASE WHEN net=1 THEN owner END) AS departure,
      sum(abs(net)) AS imbalance,count(*) AS vertices
    FROM degrees GROUP BY leadId,t
  ), boundary AS (
    -- Balanced groups preserve the witness. The first other group must supply it.
    SELECT g.leadId,min(CASE WHEN s.imbalance IS NOT 0 THEN g.t END) AS anchorT
    FROM groups g LEFT JOIN shapes s USING(leadId,t) GROUP BY g.leadId
  ), anchors AS (
    SELECT b.*,CASE WHEN b.anchorT IS NULL THEN l.assignedAgentId
        WHEN g.n=1 THEN g.previousId ELSE s.departure END AS owner,
      CASE WHEN b.anchorT IS NULL THEN 0 WHEN g.n=1 THEN g.unknownPrevious
        ELSE s.imbalance IS NOT 2 END AS uncertain
    FROM boundary b JOIN Lead l ON l.id=b.leadId
    LEFT JOIN groups g ON g.leadId=b.leadId AND g.t=b.anchorT
    LEFT JOIN shapes s ON s.leadId=b.leadId AND s.t=b.anchorT
  ), required AS (
    SELECT s.*,a.owner FROM anchors a JOIN shapes s USING(leadId)
    WHERE NOT a.uncertain AND (a.anchorT IS NULL OR s.t<=a.anchorT)
  ), reachable(leadId,t,owner) AS (
    -- Every leading cycle (and a tied open anchor) must connect to that same owner.
    SELECT d.leadId,d.t,d.owner FROM required r JOIN degrees d USING(leadId,t) WHERE d.owner IS r.owner
    UNION
    SELECT r.leadId,r.t,CASE WHEN e.previousAgentId IS r.owner THEN e.nextAgentId ELSE e.previousAgentId END
    FROM reachable r JOIN tied e USING(leadId,t) WHERE e.previousAgentId IS r.owner OR e.nextAgentId IS r.owner
  ), connected AS (SELECT leadId,t,count(*) AS vertices FROM reachable GROUP BY leadId,t),
  witness AS (
    SELECT a.leadId,a.owner,a.uncertain OR EXISTS (
      SELECT 1 FROM required r LEFT JOIN connected c USING(leadId,t)
      WHERE r.leadId=a.leadId AND c.vertices IS NOT r.vertices
    ) AS uncertain FROM anchors a
  )`
    : Prisma.empty;
  const result = await tx.$queryRaw<
    { id: string; owner: string | null; uncertain: bigint }[]
  >(sql`
    WITH RECURSIVE eligible AS (${eligible}) ${anchors}
    SELECT l.id,${historical ? sql`CASE WHEN w.leadId IS NULL THEN l.assignedAgentId ELSE w.owner END AS owner, coalesce(w.uncertain,0) AS uncertain` : sql`l.assignedAgentId AS owner,0 AS uncertain`}
    FROM eligible e CROSS JOIN Lead l ON l.id=e.id ${historical ? sql`LEFT JOIN witness w ON w.leadId=l.id` : Prisma.empty}`);
  return result.map(({ id, owner, uncertain }) => ({
    id,
    ownerAfterHistory: Number(uncertain) ? undefined : owner,
  }));
}

const safeUser = {
  id: true,
  name: true,
  role: true,
  banned: true,
  disabled: true,
} as const;
export function currentAgents(tx: Transaction, id?: string) {
  return tx.user.findMany({
    where: id === undefined ? { role: 'agent' } : { id },
    select: safeUser,
    take: id === undefined ? identityLimit + 1 : 1,
  });
}

export function usersById(tx: Transaction, ids: string[]) {
  return tx.user.findMany({ where: { id: { in: ids } }, select: safeUser });
}

export function historicalNames(
  tx: Transaction,
  range: ReportRange,
  ids: string[],
) {
  return tx.$queryRaw<{ id: string; name: string | null }[]>(sql`
    WITH eligible AS (SELECT value AS id FROM json_each(${JSON.stringify(ids)})),
    snapshots AS (
      SELECT a.nextAgentId AS id,a.nextAgentName AS name,${timestamp} AS t FROM LeadActivity a
      WHERE a.type IN ('created','assigned','unassigned') AND a.nextAgentId IN (SELECT id FROM eligible)
      UNION ALL SELECT a.previousAgentId,a.previousAgentName,${timestamp} FROM LeadActivity a
      WHERE a.type IN ('assigned','unassigned') AND a.previousAgentId IN (SELECT id FROM eligible)
    ), known AS (
      SELECT DISTINCT id FROM snapshots WHERE t<=${range.generatedAt.getTime()}
    ), unanimous AS (
      SELECT id,t,min(name) AS name FROM snapshots
      WHERE t<${range.rangeEndExclusive.getTime()} AND t<=${range.generatedAt.getTime()} AND name IS NOT NULL AND name!=''
      GROUP BY id,t HAVING min(name)=max(name)
    ), ranked AS (
      SELECT id,name,row_number() OVER (PARTITION BY id ORDER BY t DESC) AS position FROM unanimous
    )
    SELECT k.id,r.name FROM known k LEFT JOIN ranked r ON r.id=k.id AND r.position=1`);
}
