import { decomposeGolfFantasyScoreByRound } from '../scoring/golf';
import { golfPeriodForRound, type EligibleGolfRoster, type RegulationRound } from './eligibleRoster';
import type { AcceptedGolfEvent } from './scoring';
import type { GolfRosterPeriodType } from '../rules/leagueRules';

export function standardGolfContributions(events: readonly AcceptedGolfEvent[], roster: EligibleGolfRoster,
  periodType: GolfRosterPeriodType, penaltyPerRound: number) {
  const byPlayer = new Map(events.map(e => [e.player_id, e]));
  return roster.periods.flatMap(period => period.playerIds.map(playerId => {
    const event = byPlayer.get(playerId);
    const rounds = event?.golf_rounds ?? [];
    const roundScores = decomposeGolfFantasyScoreByRound({
      rounds: rounds.map(r => ({ roundNumber: r.round_number, scoreToPar: r.score_to_par ?? null, holesCompleted: r.holes_completed ?? 0 })),
      penaltyStrokes: Number(event?.penalty_strokes ?? 0), penaltyPerRound,
      fantasyScore: Number(event?.fantasy_score ?? 0),
    });
    const applicable = ([1, 2, 3, 4] as RegulationRound[]).filter(r => golfPeriodForRound(periodType, r) === period.period);
    return { playerId, period: period.period, score: event?.fantasy_score == null ? null : applicable.reduce((sum, r) => sum + roundScores[r - 1], 0),
      rounds: applicable.map(roundNumber => ({ roundNumber, score: roundScores[roundNumber - 1],
        complete: (rounds.find(r => r.round_number === roundNumber)?.holes_completed ?? 0) >= 18 })),
    };
  }));
}
