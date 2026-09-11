import { resolveGolfRules } from '../rules/leagueRules';
import type { LeagueSettingsInput } from '../rules/leagueRules';
import type { GolfPeriod, RegulationRound } from './eligibleRoster';
import { evaluateGolfRosterPeriodState } from './rosterPeriodState';
import type { GolfPeriodEvidence } from './rosterPeriodState';

export type GolfPeriodScope = { groupId: string; leagueId: string; slateId: number };
export type RetainedGolfPeriod = GolfPeriodScope & {
  period: GolfPeriod;
  revision: number;
  acceptedRevision: number;
  startedRounds: RegulationRound[];
  openedAt: string | null;
  lockedAt: string | null;
  completedAt: string | null;
  lockReason: string | null;
};

/** Only pass a frozen slate snapshot, never current Group settings. No DB creation. */
export function golfPeriodKeys(snapshot: LeagueSettingsInput | null): GolfPeriod[] {
  return resolveGolfRules(snapshot).rosterPeriods.type === 'split_after_round_2'
    ? ['opening', 'weekend'] : ['full_tournament'];
}

export function findGolfPeriod(rows: readonly RetainedGolfPeriod[], scope: GolfPeriodScope, period: GolfPeriod) {
  const matches = rows.filter(row => row.slateId === scope.slateId && row.groupId === scope.groupId && row.leagueId === scope.leagueId && row.period === period);
  if (matches.length > 1) throw new Error('Duplicate authoritative period');
  return matches[0] ?? null;
}

/** CAS planning only. Future RPC must recheck both revisions under database locks. */
export function retainGolfPeriodFacts(current: RetainedGolfPeriod, update: {
  expectedRevision: number;
  acceptedRevision: number;
  startedRounds?: readonly RegulationRound[];
  openedAt?: string;
  lockedAt?: string;
  completedAt?: string;
  lockReason?: string;
}): RetainedGolfPeriod {
  if (update.expectedRevision !== current.revision || update.acceptedRevision < current.acceptedRevision) throw new Error('Golf period revision conflict');
  const startedRounds = [...new Set([...current.startedRounds, ...(update.startedRounds ?? [])])].sort((a,b)=>a-b);
  if (startedRounds.some(r => ![1,2,3,4].includes(r))) throw new Error('Invalid regulation start evidence');
  for (const time of [update.openedAt, update.lockedAt, update.completedAt]) if (time !== undefined && !Number.isFinite(Date.parse(time))) throw new Error('Invalid fact timestamp');
  if (update.lockedAt && !current.lockedAt && !update.lockReason) throw new Error('Lock reason required');
  return { ...current, revision: current.revision + 1, acceptedRevision: update.acceptedRevision,
    startedRounds, openedAt: current.openedAt ?? update.openedAt ?? null,
    lockedAt: current.lockedAt ?? update.lockedAt ?? null,
    completedAt: current.completedAt ?? update.completedAt ?? null,
    lockReason: current.lockReason ?? (update.lockedAt ? update.lockReason! : null),
  };
}

/** No-row compatibility is read-only; period-aware mutations must require actual rows. */
export function evaluateStoredGolfPeriods(scope: GolfPeriodScope, snapshot: LeagueSettingsInput | null,
  rows: readonly RetainedGolfPeriod[], evidence: GolfPeriodEvidence) {
  const keys = golfPeriodKeys(snapshot);
  const retained = keys.map(key => findGolfPeriod(rows, scope, key));
  const startedRounds = [...new Set([...evidence.startedRounds, ...retained.flatMap(row => row?.startedRounds ?? [])])];
  const initial = retained[0];
  const weekend = retained[keys.indexOf('weekend')];
  const result = evaluateGolfRosterPeriodState({ rosterPeriodType: resolveGolfRules(snapshot).rosterPeriods.type,
    evidence: { ...evidence, startedRounds, acquisition: {
      initial: initial?.lockedAt || initial?.completedAt ? 'locked' : evidence.acquisition.initial,
      weekendLocked: evidence.acquisition.weekendLocked || !!weekend?.lockedAt || !!weekend?.completedAt,
    } },
  });
  const periods = result.periods.map(period => {
    const row = retained[keys.indexOf(period.period)];
    return row?.completedAt ? { ...period, state: 'completed' as const, reason: 'retained_completion' as const, canBuildRoster: false, locked: true }
      : period;
  });
  const currentPeriod = periods.find(period => period.period === result.currentPeriod)?.state === 'completed'
    ? null : result.currentPeriod;
  return { ...result, currentPeriod, persisted: retained.every(Boolean), periods };
}
