import { describe, expect, it } from 'vitest';
import * as reporting from '../src/modules/reports/agent-performance/agent-performance.metrics.js';
import type { AttributionActivity } from '../src/modules/reports/agent-performance/agent-performance.metrics.js';

// Offsets in seconds from November 1, 09:00 Dubai time.
const instant = (seconds: number) =>
  new Date(Date.UTC(2026, 10, 1, 5) + seconds * 1000);
const day = 86_400;
let sequence = 0;
function event(
  time: number,
  type: string,
  values: Partial<AttributionActivity> = {},
): AttributionActivity {
  return {
    id: String(++sequence),
    leadId: 'L',
    type,
    createdAt: instant(time),
    actorId: null,
    previousStage: null,
    nextStage: null,
    previousAgentId: null,
    nextAgentId: null,
    previousAgentName: null,
    nextAgentName: null,
    ...values,
  };
}
const create = (time: number, owner: string | null) =>
  event(time, 'created', { nextAgentId: owner });
const assign = (time: number, from: string | null, to: string | null) =>
  event(time, to ? 'assigned' : 'unassigned', {
    previousAgentId: from,
    nextAgentId: to,
  });
const call = (time: number, actorId: string | null) =>
  event(time, 'call_logged', { actorId });
const stage = (
  time: number,
  previousStage: string,
  nextStage: string,
  actorId = 'manager',
) => event(time, 'stage_changed', { previousStage, nextStage, actorId });
const zero = {
  leadsHandled: 0,
  dealsClosed: 0,
  assignmentEpisodes: 0,
  completedFollowUps: 0,
  averageFirstFollowUpSeconds: null,
  awaitingFollowUp: 0,
  endedWithoutFollowUp: 0,
};
function report(
  activities: AttributionActivity[],
  ownerAfterHistory: string | null,
  options: {
    start?: number;
    end?: number;
    now?: number;
    selected?: string;
  } = {},
) {
  return reporting.calculateAgentPerformance({
    leads: [{ id: 'L', ownerAfterHistory }],
    activities,
    rangeStart: instant(options.start ?? 0),
    rangeEndExclusive: instant(options.end ?? 6 * day),
    generatedAt: instant(options.now ?? 8 * day),
    ...(options.selected === undefined
      ? {}
      : { selectedAgentId: options.selected }),
  });
}

describe('historical assignment attribution', () => {
  it('uses the historical witness before a later handover and the new owner after it', () => {
    const history = [create(0, 'A'), assign(5, 'A', 'B')];
    expect(report(history, 'A', { end: 5 }).metricsByAgent.get('A')).toEqual({
      ...zero,
      assignmentEpisodes: 1,
      awaitingFollowUp: 1,
    });
    expect(report(history, 'B', { end: 6 }).metricsByAgent.get('A')).toEqual({
      ...zero,
      assignmentEpisodes: 1,
      endedWithoutFollowUp: 1,
    });
  });

  it('credits a true zero response at assigned creation', () => {
    const result = report([call(0, 'A'), create(0, 'A')], 'A');
    expect(result.metricsByAgent.get('A')).toEqual({
      ...zero,
      leadsHandled: 1,
      assignmentEpisodes: 1,
      completedFollowUps: 1,
      averageFirstFollowUpSeconds: 0,
    });
    expect(result.coverage.hasLimitations).toBe(false);
  });
  it('recovers a tied handover chain after missing or inconsistent earlier ownership', () => {
    for (const prior of [[], [create(0, 'A'), call(1, 'A')]]) {
      const result = report(
        [...prior, assign(3, 'C', 'D'), assign(3, 'B', 'C'), call(5, 'D')],
        'D',
      );
      expect(result.metricsByAgent.get('D')).toEqual({
        ...zero,
        leadsHandled: 1,
        assignmentEpisodes: 1,
        completedFollowUps: 1,
        averageFirstFollowUpSeconds: 2,
      });
      expect(result.metricsByAgent.get('C')).toEqual({
        ...zero,
        assignmentEpisodes: 1,
        endedWithoutFollowUp: 1,
      });
      if (prior.length) {
        expect(result.metricsByAgent.get('A')).toEqual(zero);
        expect(result.coverage.excludedAssignmentEpisodeCount).toBe(1);
      } else expect(result.coverage.hasLimitations).toBe(false);
    }
  });
  it('recovers a provable final owner even when tied handovers allow different intermediate orders', () => {
    const tied = [
      assign(3, 'A', 'B'),
      assign(3, 'B', 'A'),
      assign(3, 'A', 'C'),
      assign(3, 'C', 'A'),
      assign(3, 'A', 'D'),
    ];
    for (const changes of [tied, [...tied].reverse()]) {
      const result = report(
        [create(0, 'A'), call(1, 'A'), ...changes, call(5, 'D')],
        'D',
      );
      expect(result.metricsByAgent.get('A')).toEqual({
        ...zero,
        leadsHandled: 1,
        assignmentEpisodes: 3,
        completedFollowUps: 1,
        averageFirstFollowUpSeconds: 1,
        endedWithoutFollowUp: 2,
      });
      expect(result.metricsByAgent.get('D')).toEqual({
        ...zero,
        leadsHandled: 1,
        assignmentEpisodes: 1,
        completedFollowUps: 1,
        averageFirstFollowUpSeconds: 2,
      });
      expect(result.coverage.hasLimitations).toBe(false);
    }
  });

  it('keeps prior results when a later duplicate creation corrupts the remaining history', () => {
    const result = report(
      [
        create(0, 'A'),
        call(1, 'A'),
        stage(2, 'new', 'won'),
        assign(3, 'A', 'B'),
        create(4, 'C'),
        call(5, 'C'),
      ],
      'C',
    );
    expect(result.metricsByAgent.get('A')?.dealsClosed).toBe(1);
    expect(result.metricsByAgent.get('A')?.completedFollowUps).toBe(1);
    expect(result.metricsByAgent.get('C')?.leadsHandled).toBe(0);
  });

  it('uses a missing assignment ID only as an agency-level omission', () => {
    const result = [
      event(0, 'created', { nextAgentName: 'Former staff' }),
      call(1, null),
      stage(2, 'new', 'won'),
    ];
    expect(report(result, null).coverage).toEqual({
      excludedActionCount: 1,
      excludedAssignmentEpisodeCount: 1,
      unattributedFirstWinCount: 1,
      hasLimitations: true,
    });
    expect(
      report(result, null, { selected: 'Former staff' }).coverage
        .hasLimitations,
    ).toBe(false);
  });
  it('credits the contract example to A and B and ignores subsequent wins', () => {
    const history = [
      create(0, 'A'),
      call(600, 'A'),
      call(800, 'A'),
      assign(day + 3600, 'A', 'B'),
      stage(day + 5400, 'new', 'contacted', 'B'),
      stage(2 * day, 'contacted', 'won'),
      stage(3 * day, 'won', 'new'),
      stage(4 * day, 'new', 'won'),
    ];
    const full = report(history, 'B');
    expect(full.metricsByAgent.get('A')).toEqual({
      ...zero,
      leadsHandled: 1,
      assignmentEpisodes: 1,
      completedFollowUps: 1,
      averageFirstFollowUpSeconds: 600,
    });
    expect(full.metricsByAgent.get('B')).toEqual({
      ...zero,
      leadsHandled: 1,
      dealsClosed: 1,
      assignmentEpisodes: 1,
      completedFollowUps: 1,
      averageFirstFollowUpSeconds: 1800,
    });
    expect(
      report(history, 'B', { start: 2 * day }).metricsByAgent.get('B'),
    ).toEqual({ ...zero, dealsClosed: 1 });
    expect(report(history, 'B', { start: 4 * day }).metricsByAgent.size).toBe(
      0,
    );
    expect(full.coverage.hasLimitations).toBe(false);
  });

  it('partitions repeated episodes, ignores no-ops and unrelated actions, and includes the generated instant', () => {
    const history = [
      create(0, null),
      assign(1, null, 'A'),
      assign(2, 'A', 'A'),
      call(3, 'manager'),
      event(4, 'note_added', { actorId: 'A' }),
      stage(5, 'contacted', 'lost', 'A'),
      assign(6, 'A', null),
      assign(7, null, 'A'),
      call(8, 'A'),
      assign(9, 'A', null),
      assign(10, null, 'A'),
      call(11, 'A'),
    ];
    const atTen = report(history, 'A', { now: 10 }).metricsByAgent.get('A');
    expect(atTen).toEqual({
      ...zero,
      leadsHandled: 1,
      assignmentEpisodes: 3,
      completedFollowUps: 1,
      averageFirstFollowUpSeconds: 1,
      awaitingFollowUp: 1,
      endedWithoutFollowUp: 1,
    });
    expect(
      report(history, 'A', { now: 11 }).metricsByAgent.get('A')
        ?.completedFollowUps,
    ).toBe(2);
    expect(report(history, 'A', { end: 11 }).metricsByAgent.get('A')).toEqual(
      atTen,
    );
  });

  it('preserves a valid zero and rounds the pooled elapsed duration only once', () => {
    const history = [
      create(0, 'A'),
      call(0.1, 'A'),
      assign(1, 'A', null),
      assign(2, null, 'A'),
      call(2.6, 'A'),
      call(2.6, 'A'),
    ];
    expect(report(history, 'A').metricsByAgent.get('A')).toEqual({
      ...zero,
      leadsHandled: 1,
      assignmentEpisodes: 2,
      completedFollowUps: 2,
      averageFirstFollowUpSeconds: 0,
    });
    expect(report([create(0, 'A')], 'A').metricsByAgent.get('A')).toEqual({
      ...zero,
      assignmentEpisodes: 1,
      awaitingFollowUp: 1,
    });
  });

  it('excludes tied ownership actions without choosing an order or crediting a re-win', () => {
    const tied = [assign(10, 'A', 'B'), call(10, 'B'), stage(10, 'new', 'won')];
    for (const group of [tied, [...tied].reverse()]) {
      const history = [
        create(0, 'A'),
        ...group,
        stage(11, 'won', 'new'),
        stage(12, 'new', 'won'),
      ];
      const all = report(history, 'B');
      expect(all.metricsByAgent.get('B')).toEqual(zero);
      expect(all.coverage).toEqual({
        excludedActionCount: 1,
        excludedAssignmentEpisodeCount: 1,
        unattributedFirstWinCount: 1,
        hasLimitations: true,
      });
      expect(report(history, 'B', { selected: 'A' }).coverage).toEqual({
        excludedActionCount: 0,
        excludedAssignmentEpisodeCount: 0,
        unattributedFirstWinCount: 1,
        hasLimitations: true,
      });
      expect(
        report(history, 'B', { selected: 'C' }).coverage.hasLimitations,
      ).toBe(false);
    }
  });

  it('recovers after an inconsistent interval, preserving earlier proven completed work', () => {
    const history = [
      create(0, 'A'),
      call(2, 'A'),
      assign(3, 'A', 'B'),
      call(4, 'B'),
      stage(5, 'new', 'won'),
      assign(6, null, 'C'),
      call(7, 'C'),
    ];
    const result = report(history, 'C');
    expect(result.metricsByAgent.get('A')?.averageFirstFollowUpSeconds).toBe(2);
    expect(result.metricsByAgent.get('B')).toEqual(zero);
    expect(result.metricsByAgent.get('C')?.averageFirstFollowUpSeconds).toBe(1);
    expect(result.coverage).toEqual({
      excludedActionCount: 1,
      excludedAssignmentEpisodeCount: 1,
      unattributedFirstWinCount: 1,
      hasLimitations: true,
    });
    expect(
      report(history.slice(0, 5), null, { selected: 'A' }).coverage
        .hasLimitations,
    ).toBe(false);
    expect(
      report(history.slice(0, 5), null, { selected: 'B' }).coverage,
    ).toEqual(result.coverage);
  });

  it('separates unknown first-follow-up times from later provable handled actions', () => {
    const history = [
      create(0, 'A'),
      call(5, null),
      call(7, 'A'),
      call(8, null),
    ];
    const all = report(history, 'A');
    expect(all.metricsByAgent.get('A')).toEqual({ ...zero, leadsHandled: 1 });
    expect(all.coverage.excludedActionCount).toBe(2);
    expect(all.coverage.excludedAssignmentEpisodeCount).toBe(1);
    expect(
      report(history, 'A', { selected: 'B' }).coverage.hasLimitations,
    ).toBe(false);
    expect(
      report(
        [create(0, 'A'), call(7, 'A'), call(7, null)],
        'A',
      ).metricsByAgent.get('A')?.averageFirstFollowUpSeconds,
    ).toBe(7);
  });

  it('counts only recorded, in-range omissions, respecting the scoped identity', () => {
    const history = [call(-1, 'A'), call(0, null), stage(2, 'new', 'won')];
    expect(report(history, null).coverage).toEqual({
      excludedActionCount: 1,
      excludedAssignmentEpisodeCount: 0,
      unattributedFirstWinCount: 1,
      hasLimitations: true,
    });
    expect(
      report(history, null, { selected: 'A' }).coverage.hasLimitations,
    ).toBe(false);
    expect(
      report([create(0, null), stage(2, 'new', 'won')], null).coverage
        .unattributedFirstWinCount,
    ).toBe(1);
    expect(
      report([create(0, null), stage(2, 'new', 'won')], null, { selected: 'A' })
        .coverage.hasLimitations,
    ).toBe(false);
  });
});
