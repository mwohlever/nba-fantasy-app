import type { AcceptedHole } from './holeAcceptance';
import type { GolfRosterPeriodType } from '../rules/leagueRules';
import { calculateGolfTeamResults } from './teamResults';
import { scoreBestBall } from './bestBall';
import { eligibleGolfPlayerIds } from './eligibleRoster';
import type { EligibleGolfRoster, RegulationRound } from './eligibleRoster';
import { standardGolfContributions } from './standardPeriods';

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
  penaltyPerRound?: number;
};

/** Shared production boundary over accepted state and acquisition-independent rosters. */
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
    // Each period/player becomes a distinct scoring entry, with only its own
    // regulation rounds. The existing aggregate ranking engine remains in use.
    const events: Array<Record<string, any>> = [];
    const competitors: Array<Record<string, any>> = [];
    const lineups = input.rosters.map(roster => ({ team_id: roster.teamId,
      lineup_players: standardGolfContributions(input.acceptedEvents, roster, input.rosterPeriodType, input.penaltyPerRound ?? 0).map(c => {
        const id = events.length + 1;
        const event = input.acceptedEvents.find(e => e.player_id === c.playerId);
        events.push({ ...event, player_id: id, fantasy_score: c.score });
        competitors.push({ playerId: id, scoringRounds: c.rounds.map(r => r.roundNumber), rounds: (event?.golf_rounds ?? []).filter(r => c.rounds.some(x => x.roundNumber === r.round_number))
          .map(r => ({ roundNumber: r.round_number, holesCompleted: r.holes_completed, scoreToPar: r.score_to_par,
            holes: (r.golf_holes ?? []).map(h => ({ relativeToPar: h.relative_to_par })) })) });
        return { player_id: id };
      }),
    }));
    return { gameType: 'standard' as const, teams: calculateGolfTeamResults(input.slateId, events, competitors, lineups, input.slateTeams) };
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
