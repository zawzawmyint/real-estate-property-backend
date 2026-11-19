/** The owner immediately after the supplied history. For a historical cutoff use
 * the next assignment's previous ID, or the live owner when no transition follows.
 * Undefined means the repository could not establish a unique boundary witness. */
export interface AttributionLead {
  id: string;
  ownerAfterHistory: string | null | undefined;
}

export interface AttributionActivity {
  id: string;
  leadId: string;
  createdAt: Date;
  type: string;
  actorId: string | null;
  previousAgentId: string | null;
  previousAgentName: string | null;
  nextAgentId: string | null;
  nextAgentName: string | null;
  previousStage: string | null;
  nextStage: string | null;
}

export function emptyAgentMetrics() {
  return {
    leadsHandled: 0,
    dealsClosed: 0,
    assignmentEpisodes: 0,
    completedFollowUps: 0,
    averageFirstFollowUpSeconds: null as number | null,
    awaitingFollowUp: 0,
    endedWithoutFollowUp: 0,
  };
}
export type AgentMetrics = ReturnType<typeof emptyAgentMetrics>;

interface MetricsInput {
  leads: readonly AttributionLead[];
  activities: readonly AttributionActivity[];
  rangeStart: Date;
  rangeEndExclusive: Date;
  generatedAt: Date;
  selectedAgentId?: string;
}

type Owner = string | null | undefined;

interface Interval {
  owner: Owner;
  start: number;
  ended: boolean;
  proven: boolean;
  first: number;
  possibleFirst: number;
}

function interval(owner: Owner, start: number): Interval {
  return {
    owner,
    start,
    ended: false,
    proven: owner !== undefined,
    first: Infinity,
    possibleFirst: Infinity,
  };
}

function isAssignment(e: AttributionActivity) {
  if (e.type === 'created' || e.type === 'unassigned') return true;
  return (
    e.type === 'assigned' &&
    !(e.nextAgentId && e.nextAgentId === e.previousAgentId)
  );
}

function previousOwner(e: AttributionActivity): Owner {
  return e.previousAgentId ?? (e.previousAgentName ? undefined : null);
}

function nextOwner(e: AttributionActivity): Owner {
  if (e.type === 'unassigned')
    return e.nextAgentId || e.nextAgentName ? undefined : null;
  return (
    e.nextAgentId ??
    (e.type === 'assigned' || e.nextAgentName ? undefined : null)
  );
}

/** Verify that all same-instant handovers can form one chain. Every feasible
 * chain has the same end owner (arrivals minus departures). The intermediate
 * order is immaterial: each interim episode has zero duration. Actions at the
 * instant are evaluated against the entire set of possible owners. */
function orderChanges(changes: AttributionActivity[], preceding: Owner) {
  if (changes.length === 1) return changes;
  const creation = changes.filter((e) => e.type === 'created');
  if (creation.length > 1) return undefined;
  const byPrevious = new Map<Owner, AttributionActivity[]>();
  const departures = new Map<Owner, number>();
  for (const e of changes) {
    if (e.type === 'created') continue;
    const owner = previousOwner(e);
    const destination = nextOwner(e);
    if (owner === undefined || destination === undefined) return undefined;
    departures.set(owner, (departures.get(owner) ?? 0) + 1);
    departures.set(destination, (departures.get(destination) ?? 0) - 1);
    const outgoing = byPrevious.get(owner);
    if (outgoing) outgoing.push(e);
    else byPrevious.set(owner, [e]);
  }
  let start = creation[0] ? nextOwner(creation[0]) : preceding;
  if (!creation.length) {
    // An open chain proves its own starting owner even across a gap.
    // A closed chain still needs the preceding owner as its witness.
    for (const [owner, net] of departures) {
      if (net === 1) {
        start = owner;
        break;
      }
    }
  }
  const path: AttributionActivity[] = [];
  const backwards: AttributionActivity[] = [];
  let owner = start;
  while (true) {
    const next = byPrevious.get(owner)?.pop();
    if (next) {
      path.push(next);
      owner = nextOwner(next);
    } else {
      const finished = path.pop();
      if (!finished) break;
      backwards.push(finished);
      owner = previousOwner(finished);
    }
  }
  if (backwards.length + creation.length !== changes.length) return undefined;
  const ordered = backwards.reverse();
  owner = start;
  for (const change of ordered) {
    if (previousOwner(change) !== owner) return undefined;
    owner = nextOwner(change);
  }
  return creation.concat(ordered);
}

interface InstantGroup {
  time: number;
  events: AttributionActivity[];
  active: Interval;
  before?: Interval;
  ownersAtTransition?: Set<Owner>;
  hasCreation: boolean;
}

function reconstruct(history: AttributionActivity[], anchor: Owner) {
  let active = interval(undefined, -Infinity);
  const episodes: Interval[] = [];
  const groups: InstantGroup[] = [];
  let hasCreation = false;
  history.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  let i = 0;
  while (i < history.length) {
    const time = history[i]!.createdAt.getTime();
    const events: AttributionActivity[] = [];
    do {
      events.push(history[i++]!);
    } while (i < history.length && history[i]!.createdAt.getTime() === time);
    const changes = events.filter(isAssignment);
    const group: InstantGroup = { time, events, active, hasCreation };
    if (changes.length) {
      const ordered = orderChanges(changes, active.owner);
      const first = ordered?.[0];
      const created = first?.type === 'created';
      const validCreation = created && groups.length === 0;
      if (groups.length === 0) hasCreation = validCreation;
      else if (changes.some((e) => e.type === 'created')) hasCreation = false;
      group.hasCreation = hasCreation;

      if (!validCreation) group.before = active;
      if (!first || created || previousOwner(first) !== active.owner)
        active.proven = false;
      active.ended = true;
      const owners = new Set<Owner>();
      for (const e of ordered ?? changes) {
        if (e.type !== 'created') owners.add(previousOwner(e));
        const to = nextOwner(e);
        owners.add(to);
        const episode = interval(to, time);
        episode.ended = true;
        if (!ordered || (created && !validCreation)) episode.proven = false;
        if (to !== null) episodes.push(episode);
        active = episode;
      }
      if (!ordered) active = interval(undefined, time);
      active.ended = false;
      group.active = active;
      group.ownersAtTransition = owners;
    }
    groups.push(group);
  }
  if (anchor === undefined || active.owner !== anchor) active.proven = false;
  return { groups, episodes };
}

function qualifies(e: AttributionActivity) {
  return (
    e.type === 'call_logged' ||
    (e.type === 'stage_changed' &&
      e.previousStage === 'new' &&
      e.nextStage === 'contacted')
  );
}

/** Inputs are distinct persisted activities, selected inside the report snapshot.
 * Only IDs with in-window evidence are returned. The service supplies remaining
 * eligible zero rows, authorized identity labels, order and pagination. */
export function calculateAgentPerformance(input: MetricsInput) {
  const start = input.rangeStart.getTime();
  const end = input.rangeEndExclusive.getTime();
  const now = input.generatedAt.getTime();
  const selected = input.selectedAgentId;
  const histories = new Map<string, AttributionActivity[]>();
  for (const activity of input.activities) {
    const time = activity.createdAt.getTime();
    if (time >= end || time > now) continue;
    const history = histories.get(activity.leadId);
    if (history) history.push(activity);
    else histories.set(activity.leadId, [activity]);
  }
  const metricsByAgent = new Map<string, AgentMetrics>();
  const durations = new Map<string, number>();
  const coverage = {
    excludedActionCount: 0,
    excludedAssignmentEpisodeCount: 0,
    unattributedFirstWinCount: 0,
    hasLimitations: false,
  };
  function row(id: string) {
    let metrics = metricsByAgent.get(id);
    if (!metrics) {
      metrics = emptyAgentMetrics();
      metricsByAgent.set(id, metrics);
    }
    return metrics;
  }
  function visible(id: Owner): id is string {
    return (
      typeof id === 'string' && (selected === undefined || id === selected)
    );
  }

  for (const lead of input.leads) {
    const history = histories.get(lead.id);
    if (!history) continue;
    const { groups, episodes } = reconstruct(history, lead.ownerAfterHistory);
    const handled = new Set<string>();
    let seenWin = false;
    for (const group of groups) {
      const { time, active } = group;
      const owners = group.ownersAtTransition ?? new Set<Owner>([active.owner]);
      if (group.before) owners.add(group.before.owner);
      const unknown =
        !active.proven ||
        owners.has(undefined) ||
        group.before?.proven === false;
      // No owner can precede the lead's creation; every later transition has
      // a before and after interpretation for actions at that exact instant.
      const certain = !unknown && owners.size === 1;
      const inWindow = time >= start;
      let groupEvidence = false;
      for (const e of group.events) {
        if (
          e.type === 'stage_changed' &&
          e.nextStage === 'won' &&
          e.previousStage !== 'won' &&
          !seenWin
        ) {
          seenWin = true;
          if (inWindow) {
            if (group.hasCreation && certain && active.owner) {
              if (visible(active.owner)) row(active.owner).dealsClosed++;
            } else if (selected === undefined || owners.has(selected)) {
              coverage.unattributedFirstWinCount++;
              groupEvidence = true;
            }
          }
        }
        if (!inWindow || !qualifies(e)) continue;
        const actor = e.actorId;
        if (
          !unknown &&
          (actor ? !owners.has(actor) : owners.size === 1 && owners.has(null))
        )
          continue;
        if (certain && actor && actor === active.owner) {
          active.first = Math.min(active.first, time);
          if (visible(actor) && !handled.has(actor)) {
            row(actor).leadsHandled++;
            handled.add(actor);
          }
        } else {
          if (!actor || actor === active.owner)
            active.possibleFirst = Math.min(active.possibleFirst, time);
          if (
            selected === undefined ||
            (actor ? actor === selected : owners.has(selected))
          ) {
            coverage.excludedActionCount++;
            if (!actor) groupEvidence = true;
            else if (visible(actor) && owners.has(actor)) row(actor);
          }
        }
      }
      if (groupEvidence)
        for (const owner of owners) if (visible(owner)) row(owner);
    }
    for (const episode of episodes) {
      const id = episode.owner;
      if (episode.start < start || (selected !== undefined && selected !== id))
        continue;
      const metrics = visible(id) ? row(id) : undefined;
      if (
        !episode.proven ||
        !metrics ||
        episode.possibleFirst < episode.first
      ) {
        coverage.excludedAssignmentEpisodeCount++;
        continue;
      }
      metrics.assignmentEpisodes++;
      if (episode.first !== Infinity && id) {
        metrics.completedFollowUps++;
        durations.set(
          id,
          (durations.get(id) ?? 0) + episode.first - episode.start,
        );
      } else if (episode.ended) metrics.endedWithoutFollowUp++;
      else metrics.awaitingFollowUp++;
    }
  }
  for (const [id, elapsed] of durations) {
    const metrics = metricsByAgent.get(id)!;
    metrics.averageFirstFollowUpSeconds = Math.round(
      elapsed / metrics.completedFollowUps / 1000,
    );
  }
  coverage.hasLimitations =
    coverage.excludedActionCount +
      coverage.excludedAssignmentEpisodeCount +
      coverage.unattributedFirstWinCount >
    0;
  return { metricsByAgent, coverage };
}
