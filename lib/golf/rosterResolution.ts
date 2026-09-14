import { resolveGolfRules, type LeagueSettingsInput } from '../rules/leagueRules';
import type { EligibleGolfRoster, GolfPeriod } from './eligibleRoster';

export type GolfStoredRoster = { team_id: number; period_key: GolfPeriod; player_ids: number[] };

/** Acquisition is resolved here. Prices never enter the scoring contract. */
export function resolveGolfScoringRosters(input: {
  snapshot: LeagueSettingsInput | null;
  teamIds: number[];
  snake: Array<{ team_id: number; lineup_players: Array<{ player_id: number }> }>;
  salaryCap: GolfStoredRoster[];
  snakePeriods: GolfStoredRoster[];
}): EligibleGolfRoster[] {
  const rules = resolveGolfRules(input.snapshot);
  const keys: GolfPeriod[] = rules.rosterPeriods.type === 'split_after_round_2' ? ['opening', 'weekend'] : ['full_tournament'];
  return input.teamIds.map(teamId => ({ teamId, periods: keys.map(period => {
    const source = rules.draft.type === 'salary_cap' ? input.salaryCap : input.snakePeriods;
    const stored = source.filter(r => r.team_id === teamId && r.period_key === period);
    if (stored.length > 1) throw new Error('Duplicate Golf period roster');
    // Legacy Snake is the Opening source only. Never carry it into Weekend.
    const legacy = rules.draft.type === 'snake' && period !== 'weekend'
      ? input.snake.find(r => r.team_id === teamId)?.lineup_players.map(r => Number(r.player_id)) ?? [] : [];
    const playerIds = stored[0]?.player_ids ?? legacy;
    if (new Set(playerIds).size !== playerIds.length || playerIds.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new Error('Invalid Golf roster');
    return { period, playerIds };
  }) }));
}
