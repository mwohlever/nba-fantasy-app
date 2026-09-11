import type { GolfRosterPeriodType } from '../rules/leagueRules';
import type { GolfPeriod, RegulationRound } from './eligibleRoster';
import { golfPeriodForRound } from './eligibleRoster';
import type { AcceptedGolfEvent } from './scoring';

export type PeriodState = 'unavailable' | 'upcoming' | 'open' | 'locked' | 'completed' | 'uncertain';
export type PeriodReason = 'acquisition_open' | 'acquisition_pending' | 'acquisition_locked'
  | 'awaiting_round_2_completion' | 'awaiting_cut_confirmation' | 'weekend_field_ready'
  | 'round_3_started' | 'opening_play_started' | 'shortened_event_no_weekend'
  | 'tournament_complete' | 'retained_completion' | 'provider_state_uncertain' | 'round_2_complete';
export type WeekendEligibility = 'made_cut' | 'continuing' | 'missed_cut' | 'withdrawn'
  | 'disqualified' | 'did_not_start' | 'unknown';

/** Confirmations are future server-normalized, accepted facts, NOT raw provider flags.
 * null means unknown. No current production adapter claims to supply these facts.
 */
export type GolfPeriodEvidence = {
  regulationRoundCount: RegulationRound | null;
  tournamentComplete: boolean | null;
  round2Complete: boolean | null;
  /** Positive confirmation of a pre-R3 window; absence of holes is insufficient. */
  round3NotStarted: boolean | null;
  cut: 'confirmed' | 'pending' | 'no_cut' | 'unknown';
  fieldComplete: boolean;
  players: readonly { playerId: number; eligibility: WeekendEligibility }[];
  acceptedEvents: readonly AcceptedGolfEvent[];
  /** Monotonic historical start evidence; must survive hole retractions/omissions. */
  startedRounds: readonly RegulationRound[];
  acquisition: { initial: 'open' | 'upcoming' | 'locked' | 'unknown'; weekendLocked: boolean };
};
export type GolfPeriodStatus = {
  period: GolfPeriod;
  regulationRounds: RegulationRound[];
  state: PeriodState;
  reason: PeriodReason;
  canBuildRoster: boolean;
  locked: boolean;
  eligibilityKnown: boolean;
  eligiblePlayerIds: number[];
  unresolvedPlayerIds: number[];
  ineligiblePlayerIds: number[];
};

export function evaluateGolfRosterPeriodState(input: {
  rosterPeriodType: GolfRosterPeriodType;
  evidence: GolfPeriodEvidence;
}) {
  const { rosterPeriodType: type, evidence: e } = input;
  // Validate the configuration even when the confirmed round count is absent.
  golfPeriodForRound(type, 1);
  if (e.regulationRoundCount !== null && ![1, 2, 3, 4].includes(e.regulationRoundCount)) throw new Error('Invalid regulation round count');
  if (e.startedRounds.some(r => ![1, 2, 3, 4].includes(r))) throw new Error('Invalid started regulation round');
  if (new Set(e.players.map(p => p.playerId)).size !== e.players.length || e.players.some(p => !Number.isSafeInteger(p.playerId) || p.playerId <= 0)) throw new Error('Invalid or duplicate field player');
  const available: RegulationRound[] = ([1, 2, 3, 4] as const).filter(r => e.regulationRoundCount !== null && r <= e.regulationRoundCount);
  const played = new Set<number>(e.startedRounds);
  for (const event of e.acceptedEvents) for (const round of event.golf_rounds ?? []) {
    if ([1, 2, 3, 4].includes(round.round_number) && ((round.holes_completed ?? 0) > 0 ||
      (round.golf_holes ?? []).some(h => h.hole_number >= 1 && h.hole_number <= 18 && h.strokes !== null && h.strokes > 0))) played.add(round.round_number);
  }
  const r3Started = e.round3NotStarted === false || [...played].some(r => r >= 3);
  const initialPlay = played.size > 0;
  const sorted = [...e.players].sort((a, b) => a.playerId - b.playerId);
  const eligiblePlayerIds: number[] = [], unresolvedPlayerIds: number[] = [], ineligiblePlayerIds: number[] = [];
  for (const player of sorted) {
    const event = e.acceptedEvents.find(event => event.player_id === player.playerId);
    const terminal = ['cut', 'withdrawn', 'disqualified', 'did_not_start'].includes(String(event?.status));
    if (terminal || ['missed_cut', 'withdrawn', 'disqualified', 'did_not_start'].includes(player.eligibility)) ineligiblePlayerIds.push(player.playerId);
    else if (player.eligibility === 'made_cut' || player.eligibility === 'continuing') eligiblePlayerIds.push(player.playerId);
    else unresolvedPlayerIds.push(player.playerId);
  }
  const eligibilityKnown = e.fieldComplete && e.players.length > 0 && unresolvedPlayerIds.length === 0;
  const make = (period: GolfPeriod, state: PeriodState, reason: PeriodReason, locked = false): GolfPeriodStatus => ({
    period, regulationRounds: available.filter(r => golfPeriodForRound(type, r) === period), state, reason,
    canBuildRoster: state === 'open', locked,
    // Initial acquisition membership is governed by existing slate rules, not cut eligibility.
    eligibilityKnown: period === 'weekend' && eligibilityKnown,
    eligiblePlayerIds: period === 'weekend' ? eligiblePlayerIds : [],
    unresolvedPlayerIds: period === 'weekend' ? unresolvedPlayerIds : [],
    ineligiblePlayerIds: period === 'weekend' ? ineligiblePlayerIds : [],
  });
  const initial = (period: GolfPeriod) => {
    if (e.tournamentComplete === true) return make(period, 'completed', 'tournament_complete', true);
    if (e.acquisition.initial === 'locked') return make(period, 'locked', 'acquisition_locked', true);
    if (e.acquisition.initial === 'open') return make(period, 'open', 'acquisition_open');
    if (e.acquisition.initial === 'upcoming') return make(period, 'upcoming', 'acquisition_pending');
    return make(period, 'uncertain', 'provider_state_uncertain');
  };
  if (type === 'full_tournament') return {
    rosterPeriodType: type, currentPeriod: e.tournamentComplete === true ? null : 'full_tournament' as GolfPeriod,
    periods: [initial('full_tournament')],
  };
  const opening = e.tournamentComplete === true ? make('opening', 'completed', 'tournament_complete', true)
    : e.round2Complete === true || r3Started ? make('opening', 'completed', 'round_2_complete', true)
    : initialPlay ? make('opening', 'locked', 'opening_play_started', true) : initial('opening');
  let weekend: GolfPeriodStatus;
  // Start/deadline locks win over late or missing transition metadata.
  if (r3Started) weekend = make('weekend', e.tournamentComplete === true ? 'completed' : 'locked', e.tournamentComplete === true ? 'tournament_complete' : 'round_3_started', true);
  else if (e.regulationRoundCount !== null && e.regulationRoundCount <= 2) weekend = make('weekend', 'unavailable', 'shortened_event_no_weekend', true);
  else if (e.tournamentComplete === true) weekend = make('weekend', 'completed', 'tournament_complete', true);
  else if (e.acquisition.weekendLocked) weekend = make('weekend', 'locked', 'acquisition_locked', true);
  else if (e.round2Complete === false) weekend = make('weekend', 'unavailable', 'awaiting_round_2_completion');
  else if (e.round2Complete === null || e.regulationRoundCount === null || e.tournamentComplete === null || e.round3NotStarted === null) weekend = make('weekend', 'uncertain', 'provider_state_uncertain');
  else if (e.cut === 'pending') weekend = make('weekend', 'uncertain', 'awaiting_cut_confirmation');
  else if (e.cut === 'unknown' || !eligibilityKnown) weekend = make('weekend', 'uncertain', 'provider_state_uncertain');
  else weekend = make('weekend', 'open', 'weekend_field_ready');
  return { rosterPeriodType: type,
    currentPeriod: e.tournamentComplete === true ? null : (r3Started || weekend.state === 'open' ? 'weekend' : 'opening') as GolfPeriod,
    periods: [opening, weekend],
  };
}
