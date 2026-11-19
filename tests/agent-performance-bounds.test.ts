import { expect, it } from 'vitest';
import request from 'supertest';
import { cpus } from 'node:os';
import { Prisma, PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { leadFixture } from './lead-fixture.js';
import { createApp } from '../src/app.js';
import { createStaffAuth } from '../src/modules/auth/auth.js';
import { activityQuery } from '../src/modules/reports/agent-performance/agent-performance.repository.js';
import {
  parsePerformanceQuery,
  performanceRange,
} from '../src/modules/reports/agent-performance/agent-performance.schema.js';

const query = '?from=2024-01-01&to=2024-01-01';
const path = '/api/v1/staff/reports/agent-performance';

it('serves the exact activity and identity caps, detects overflow and recovers by date and authorized identity', async () => {
  const fixture = await leadFixture();
  const { database, env, cookies, ids } = fixture;
  const measured = new PrismaClient({
    adapter: new PrismaBetterSqlite3({ url: env.DATABASE_URL }),
    log: [{ level: 'query', emit: 'event' }],
  });
  const statements: string[] = [];
  measured.$on('query', (event) => {
    statements.push(event.query);
  });
  const app = createApp(env, createStaffAuth(env, measured), measured);
  const read = (q: string, role = 'manager') =>
    request(app)
      .get(path + q)
      .set('Cookie', cookies[role]!);
  const agent = ids.agent!,
    other = ids.other!;
  const start = Date.parse('2024-01-01T00:00:00Z');
  try {
    // Each timeline has an assigned creation, six owner calls, handover, one
    // call by the second owner, and a manager-recorded first Won.
    await database.$executeRaw`WITH RECURSIVE seq(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM seq WHERE n<10000)
      INSERT INTO Lead(id,name,searchName,searchPhone,searchEmail,searchPropertyTitle,purpose,source,assignedAgentId,updatedAt)
      SELECT 'bench-'||n,'Fixture','','','','','sale','walk_in',CASE WHEN n%2=0 THEN ${agent} ELSE ${other} END,CURRENT_TIMESTAMP FROM seq`;
    await database.$executeRaw`WITH RECURSIVE seq(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM seq WHERE n<10000),
      steps(k) AS (VALUES(0),(1),(2),(3),(4),(5),(6),(7),(8),(9)),
      leads AS (SELECT n,CASE WHEN n%2=0 THEN ${other} ELSE ${agent} END AS old,CASE WHEN n%2=0 THEN ${agent} ELSE ${other} END AS new FROM seq)
      INSERT INTO LeadActivity(id,leadId,type,createdAt,previousAgentId,nextAgentId,actorId,previousStage,nextStage)
      SELECT 'ev-'||n||'-'||k,'bench-'||n,CASE k WHEN 0 THEN 'created' WHEN 7 THEN 'assigned' WHEN 9 THEN 'stage_changed' ELSE 'call_logged' END,
      ${start}+k*1000,CASE WHEN k=7 THEN old END,CASE k WHEN 0 THEN old WHEN 7 THEN new END,
      CASE WHEN k BETWEEN 1 AND 6 THEN old WHEN k=8 THEN new WHEN k=9 THEN ${ids.manager!} END,
      CASE WHEN k=9 THEN 'contacted' END,CASE WHEN k=9 THEN 'won' END FROM leads CROSS JOIN steps`;
    expect(await database.leadActivity.count()).toBe(100000);
    for (const role of ['manager', 'agent']) {
      expect((await read(query, role)).status).toBe(200);
      statements.length = 0;
      const began = performance.now();
      const result = await read(query, role);
      const elapsed = Math.round(performance.now() - began);
      expect(result.status, JSON.stringify(result.body.error)).toBe(200);
      expect(result.body.items).toHaveLength(role === 'manager' ? 2 : 1);
      expect(result.body.items[0]).toMatchObject({
        leadsHandled: 10000,
        dealsClosed: 5000,
        assignmentEpisodes: 10000,
        completedFollowUps: 10000,
        averageFirstFollowUpSeconds: 1,
      });
      expect(result.body.coverage.hasLimitations).toBe(false);
      if (process.env.REPORT_BENCHMARK) {
        const plan = await database.$queryRaw<{ detail: string }[]>(
          Prisma.sql`EXPLAIN QUERY PLAN ${activityQuery(performanceRange(parsePerformanceQuery('/' + query), new Date()), role === 'agent' ? agent : undefined)}`,
        );
        console.info(
          JSON.stringify({
            role,
            elapsed,
            sqlStatements: statements.length,
            node: process.version,
            cpu: cpus()[0]?.model,
            plan: plan.map((p) => p.detail),
          }),
        );
      }
    }
    await database.$executeRaw`INSERT INTO LeadActivity(id,leadId,type,createdAt,actorId) VALUES ('extra','bench-1','call_logged',${start + 11000},${other})`;
    const oversized = await read(query);
    expect(oversized.status).toBe(422);
    expect(oversized.body.error.code).toBe('REPORT_TOO_LARGE');
    expect((await read('?from=2024-01-02&to=2024-01-02')).status).toBe(200);
    expect((await read(query, 'agent')).status).toBe(200);
    // Heavy unrelated work occurs after the selected agent's closed episode.
    await database.$executeRaw`WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<100001)
      INSERT INTO LeadActivity(id,leadId,type,createdAt,actorId) SELECT 'other-'||i,'bench-1','call_logged',${start + 12000}+i,${other} FROM n`;
    const historicalSelf = await read(query, 'agent');
    expect(historicalSelf.status).toBe(200);
    expect(historicalSelf.body.items[0].leadsHandled).toBe(10000);
    await database.$executeRaw`WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<1998)
      INSERT INTO User(id,name,email,role,updatedAt) SELECT 'option-'||i,'Equal display name','fixture-'||i||'@invalid.test','agent',CURRENT_TIMESTAMP FROM n`;
    const empty = '?from=2024-01-02&to=2024-01-02';
    const cap = await read(empty);
    expect(cap.body.total).toBe(2000);
    expect(cap.body.agentOptions).toHaveLength(2000);
    const ordered = cap.body.agentOptions
      .filter((a: { name: string }) => a.name === 'Equal display name')
      .map((a: { id: string }) => a.id);
    expect(ordered).toEqual([...ordered].sort());
    await database.user.create({
      data: {
        id: 'last',
        name: 'Last',
        email: 'last@invalid.test',
        role: 'agent',
      },
    });
    expect((await read(empty)).status).toBe(422);
    expect((await read(empty + '&agentId=' + agent)).body.total).toBe(1);
    expect((await read(empty, 'agent')).body.total).toBe(1);
  } finally {
    await measured.$disconnect();
    await fixture.close();
  }
}, 120000);
