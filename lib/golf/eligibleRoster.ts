import type { GolfRosterPeriodType } from '../rules/leagueRules';

export type RegulationRound = 1 | 2 | 3 | 4;
export type GolfPeriod = 'full_tournament' | 'opening' | 'weekend';
export type EligibleGolfRoster = {
  teamId: number;
  periods: ReadonlyArray<{ period: GolfPeriod; playerIds: readonly number[] }>;
};
export function golfPeriodForRound(type: GolfRosterPeriodType, round: RegulationRound): GolfPeriod {
  if (![1, 2, 3, 4].includes(round)) throw new Error('Only regulation rounds 1–4 are supported');
  if (type === 'full_tournament') return 'full_tournament';
  if (type === 'split_after_round_2') return round <= 2 ? 'opening' : 'weekend';
  throw new Error('Unknown Golf roster period type');
}

export function eligibleGolfPlayerIds(roster: EligibleGolfRoster, type: GolfRosterPeriodType, round: RegulationRound) {
  const period = golfPeriodForRound(type, round);
  const entries = roster.periods.filter(entry => entry.period === period);
  if (entries.length !== 1) throw new Error(`Supply exactly one ${period} roster for team ${roster.teamId}`);
  const ids = entries[0].playerIds;
  if (new Set(ids).size !== ids.length || ids.some(id => !Number.isSafeInteger(id) || id <= 0)) {
    throw new Error('Eligible roster must contain unique positive player IDs');
  }
  return [...ids];
}

