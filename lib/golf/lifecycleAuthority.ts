import type { AcceptedGolfEvent } from './scoring';
import type { GolfPeriodEvidence } from './rosterPeriodState';
import type { RetainedGolfPeriod, GolfPeriodScope } from './periodPersistence';
import { evaluateStoredGolfPeriods, golfPeriodKeys } from './periodPersistence';
import type { LeagueSettingsInput } from '../rules/leagueRules';
import type { RegulationRound, GolfPeriod } from './eligibleRoster';

/** Positive play only; never infer pre-R3 freshness from missing scores. */
export function acceptedStartedRounds(events: readonly AcceptedGolfEvent[]): RegulationRound[] {
  const rounds = new Set<RegulationRound>();
  for (const event of events) for (const round of event.golf_rounds ?? []) {
    if ([1,2,3,4].includes(round.round_number) && ((round.holes_completed ?? 0) > 0 ||
      (round.golf_holes ?? []).some(h => h.hole_number >= 1 && h.hole_number <= 18 && h.strokes !== null && h.strokes > 0))) rounds.add(round.round_number as RegulationRound);
  }
  return [...rounds].sort((a,b)=>a-b);
}

/** Idempotent creation plan; SQL handles actual atomic creation and scope checks. */
export function missingGolfPeriodKeys(scope: GolfPeriodScope, snapshot: LeagueSettingsInput | null, rows: readonly RetainedGolfPeriod[]) {
  const scoped = rows.filter(r => r.slateId===scope.slateId && r.groupId===scope.groupId && r.leagueId===scope.leagueId);
  const keys = golfPeriodKeys(snapshot);
  if (scoped.some(r=>!keys.includes(r.period)) || new Set(scoped.map(r=>r.period)).size!==scoped.length) throw new Error('Invalid initialized period structure');
  return keys.filter(key=>!scoped.some(r=>r.period===key));
}

export type GolfReadinessLease = {
  /** Server-reviewed source reference, never client assertions or an automatic TTL. */
  sourceReference: string;
  observedAt: string;
  acquisitionDeadline: string;
  acceptedRevision: number;
  periodRevision: number;
};

/** Pure common gate. Must execute inside the future roster mutation's locked transaction;
 * this is not a reusable authorization token or an exposed route.
 * Actor/proxy authorization, field and membership reads must be server-derived.
 */
export function assertGolfLifecycleAcquisition(input: {
  scope: GolfPeriodScope;
  snapshot: LeagueSettingsInput | null;
  rows: readonly RetainedGolfPeriod[];
  evidence: GolfPeriodEvidence;
  period: GolfPeriod;
  expectedPeriodRevision: number;
  expectedAcceptedRevision: number;
  currentAcceptedRevision: number;
  actorAuthorized: boolean;
  teamParticipating: boolean;
  tournamentPlayerIds: readonly number[];
  selectedPlayerIds: readonly number[];
  lease: GolfReadinessLease | null;
  now: string;
}) {
  const { scope }=input;
  const row=input.rows.find(r=>r.slateId===scope.slateId && r.groupId===scope.groupId && r.leagueId===scope.leagueId && r.period===input.period);
  if (!input.actorAuthorized || !input.teamParticipating) throw new Error('Unauthorized Golf participant');
  if (!row || missingGolfPeriodKeys(scope,input.snapshot,input.rows).length) throw new Error('Initialize all Golf periods first');
  if (row.revision!==input.expectedPeriodRevision || input.currentAcceptedRevision!==input.expectedAcceptedRevision || row.acceptedRevision!==input.currentAcceptedRevision) throw new Error('Golf lifecycle revision conflict');
  const state=evaluateStoredGolfPeriods(scope,input.snapshot,input.rows,input.evidence).periods.find(p=>p.period===input.period);
  if (!state?.canBuildRoster || state.locked) throw new Error('Golf acquisition unavailable');
  if (new Set(input.selectedPlayerIds).size!==input.selectedPlayerIds.length || input.selectedPlayerIds.some(id=>!input.tournamentPlayerIds.includes(id))) throw new Error('Invalid tournament golfer');
  if (input.period==='weekend') {
    const lease=input.lease, now=Date.parse(input.now);
    if (!lease || !lease.sourceReference.trim() || !Number.isFinite(now) || !Number.isFinite(Date.parse(lease.observedAt)) ||
      !Number.isFinite(Date.parse(lease.acquisitionDeadline)) || Date.parse(lease.observedAt)>now || Date.parse(lease.acquisitionDeadline)<=now ||
      lease.acceptedRevision!==input.currentAcceptedRevision || lease.periodRevision!==row.revision) throw new Error('Fresh reviewed pre-R3 confirmation required');
    if (!state.eligibilityKnown || input.selectedPlayerIds.some(id=>!state.eligiblePlayerIds.includes(id))) throw new Error('Golfer not eligible for weekend');
  }
}
