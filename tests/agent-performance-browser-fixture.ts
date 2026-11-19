import type { authFixture } from './auth-fixture.js';
import type { Prisma } from '../src/generated/prisma/client.js';
import { leadSearch } from '../src/modules/leads/leads.repository.js';

type Activity = Omit<
  Prisma.LeadActivityCreateManyInput,
  'leadId' | 'createdAt'
> & { at: string };

export async function seedAgentPerformanceBrowserFixture(
  { database, operator }: Awaited<ReturnType<typeof authFixture>>,
  password: string,
) {
  for (const project of ['desktop', 'mobile']) {
    const staff = async (label: string, role: 'manager' | 'agent') =>
      operator.create({
        name: `Report ${project} ${label}`,
        email: `e2e-agent-performance-${project}-${label}@example.com`,
        role,
        password,
      });
    const manager = await staff('manager', 'manager');
    const agent = await staff('agent', 'agent');
    const inactive = await staff('inactive', 'agent');
    await staff('role', 'manager');
    const former = {
      id: `report-former-${project}`,
      name: `Report ${project} Former Agent With An Exceptionally Long Name-WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW`,
    };

    async function history(
      label: string,
      owner: { id: string; name: string } | null,
      stage: string,
      events: [Activity, ...Activity[]],
    ) {
      const details = {
        name: `Private reporting fixture ${project} ${label}`,
        phone: null,
        email: null,
        propertyTitleSnapshot: null,
      };
      const lead = await database.lead.create({
        data: {
          ...details,
          ...leadSearch(details),
          stage,
          purpose: 'sale',
          source: 'call',
          assignedAgentId: owner?.id ?? null,
          assignedAgentNameSnapshot: owner?.name ?? null,
          createdAt: new Date(events[0].at),
        },
      });
      await database.leadActivity.createMany({
        data: events.map(({ at, ...event }) => ({
          ...event,
          leadId: lead.id,
          createdAt: new Date(at),
        })),
      });
    }

    const created = (owner?: { id: string; name: string }): Activity => ({
      type: 'created',
      at: '2025-11-01T05:00:00.000Z',
      nextStage: 'new',
      actorId: manager.id,
      nextAgentId: owner?.id ?? null,
      nextAgentName: owner?.name ?? null,
    });
    const call = (at: string): Activity => ({
      type: 'call_logged',
      at,
      actorId: agent.id,
    });
    const stage = (
      at: string,
      previousStage: string,
      nextStage: string,
      actorId = manager.id,
    ): Activity => ({
      type: 'stage_changed',
      at,
      previousStage,
      nextStage,
      actorId,
    });

    await history('handover', inactive, 'won', [
      created(agent),
      call('2025-11-01T05:10:00.000Z'),
      {
        type: 'assigned',
        at: '2025-11-02T06:00:00.000Z',
        actorId: manager.id,
        previousAgentId: agent.id,
        previousAgentName: agent.name,
        nextAgentId: inactive.id,
        nextAgentName: inactive.name,
      },
      stage('2025-11-02T06:30:00.000Z', 'new', 'contacted', inactive.id),
      stage('2025-11-03T05:00:00.000Z', 'contacted', 'won'),
      stage('2025-11-04T05:00:00.000Z', 'won', 'contacted'),
      stage('2025-11-05T05:00:00.000Z', 'contacted', 'won'),
    ]);
    await history('rounded to zero', agent, 'new', [
      { ...created(agent), at: '2025-11-02T05:00:00.000Z' },
      call('2025-11-02T05:00:00.200Z'),
    ]);
    await history('awaiting', agent, 'new', [
      { ...created(agent), at: '2025-11-03T06:00:00.000Z' },
    ]);
    await history('former', null, 'new', [
      created(former),
      {
        type: 'unassigned',
        at: '2025-11-02T05:00:00.000Z',
        actorId: manager.id,
        previousAgentId: former.id,
        previousAgentName: former.name,
      },
    ]);
    await history('unattributed win', null, 'won', [
      created(),
      stage('2025-11-05T06:00:00.000Z', 'new', 'won'),
    ]);
    await operator.deactivate(
      `e2e-agent-performance-${project}-inactive@example.com`,
    );
  }
}
