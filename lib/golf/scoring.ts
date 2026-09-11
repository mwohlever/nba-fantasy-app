import type { AcceptedHole } from './holeAcceptance';
import type { GolfRosterPeriodType } from '../rules/leagueRules';
import { calculateGolfTeamResults } from './teamResults';
import { scoreBestBall } from './bestBall';
import { eligibleGolfPlayerIds } from './eligibleRoster';
import type { EligibleGolfRoster, RegulationRound } from './eligibleRoster';

/** Accepted reconciliation output ONLY. Provider observations must first reconcile. */
export type AcceptedGolfEvent = {
  player_id: number;
  golf_rounds?: ReadonlyArray<{
    round_number: number;
    holes_completed?: number;
    score_to_par?: number | null;
    golf_holes?: readonly AcceptedHole[];
  }>;
  [key: string]: unknown;
};
export type GolfScoringInput = {
  slateId: number;
  acceptedEvents: readonly AcceptedGolfEvent[];
  rosters: readonly EligibleGolfRoster[];
  rosterPeriodType: GolfRosterPeriodType;
};

/** Opt-in pure boundary. No production caller or persistence is introduced here. */
export function scoreGolfCompetition(input: GolfScoringInput & (
  | { gameType: 'standard'; slateTeams: Array<Record<string, unknown>> }
  | { gameType: 'best_ball'; rounds: readonly RegulationRound[] }
)) {
  if (new Set(input.rosters.map(r => r.teamId)).size !== input.rosters.length) throw new Error('Duplicate team roster');
  if (input.gameType === 'best_ball') {
    return { gameType: 'best_ball' as const, teams: input.rosters.map(roster => scoreBestBall({ ...input, roster })) };
  }
  if (input.gameType !== 'standard') throw new Error('Unknown Golf game type');
  if (input.rosterPeriodType !== 'full_tournament') {
    throw new Error('Standard split-period accounting is not implemented');
  }
  // Keep the accepted aggregate/penalties and complete ranking pipeline unchanged.
  const competitors = input.acceptedEvents.map(event => ({
    playerId: event.player_id,
    rounds: (event.golf_rounds ?? []).map(round => ({
      roundNumber: round.round_number, holesCompleted: round.holes_completed, scoreToPar: round.score_to_par,
      holes: (round.golf_holes ?? []).map(hole => ({ relativeToPar: hole.relative_to_par })),
    })),
  }));
  const lineups = input.rosters.map(roster => ({ team_id: roster.teamId,
    lineup_players: eligibleGolfPlayerIds(roster, input.rosterPeriodType, 1).map(player_id => ({ player_id })),
  }));
  return { gameType: 'standard' as const, teams: calculateGolfTeamResults(
    input.slateId, [...input.acceptedEvents], competitors, lineups, input.slateTeams,
  ) };
}
