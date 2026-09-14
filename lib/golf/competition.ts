import { resolveGolfRules, type LeagueSettingsInput } from '../rules/leagueRules';
import { scoreGolfCompetition, type AcceptedGolfEvent } from './scoring';
import { standardGolfContributions } from './standardPeriods';
import type { EligibleGolfRoster, GolfPeriod } from './eligibleRoster';
import type { BestBallHole } from './bestBall';

export type GolfContribution = { playerId: number; period: GolfPeriod; score: number | null; countingHoles?: number; tiedHoles?: number };
export type GolfBestBallRound = { roundNumber: number; period: GolfPeriod; holes: BestBallHole[] };
export type GolfFantasyTeam = {
  slate_id: number; team_id: number; fantasy_points: number | null; finish_position: number | null;
  games_completed: number; games_in_progress: number; games_remaining: number;
  contributions: GolfContribution[];
  provisional: boolean;
  bestBallRounds?: GolfBestBallRound[];
};

/** One result consumed by reconciliation, Scores, and Home. No salary inputs. */
export function calculateGolfCompetition(input: { slateId: number; snapshot: LeagueSettingsInput | null;
  events: readonly AcceptedGolfEvent[]; rosters: EligibleGolfRoster[];
  slateTeams: Array<Record<string, any>>; penaltyPerRound: number }): GolfFantasyTeam[] {
  const rules = resolveGolfRules(input.snapshot);
  const common = { slateId: input.slateId, acceptedEvents: input.events, rosters: input.rosters,
    rosterPeriodType: rules.rosterPeriods.type, penaltyPerRound: input.penaltyPerRound };
  if (rules.gameType === 'standard') {
    const result = scoreGolfCompetition({ ...common, gameType: 'standard', slateTeams: input.slateTeams });
    if (result.gameType !== 'standard') throw new Error('Golf scoring mode mismatch');
    return result.teams.map(team => ({ ...team, provisional: false,
      contributions: standardGolfContributions(input.events, input.rosters.find(r => r.teamId === team.team_id)!, rules.rosterPeriods.type, input.penaltyPerRound),
    }));
  }
  const result = scoreGolfCompetition({ ...common, gameType: 'best_ball', rounds: [1, 2, 3, 4] });
  if (result.gameType !== 'best_ball') throw new Error('Golf scoring mode mismatch');
  const teams = result.teams.map(team => {
    const roster = input.rosters.find(r => r.teamId === team.teamId)!;
    const contributions = roster.periods.flatMap(period => period.playerIds.map(playerId => {
      const holes = team.rounds.filter(r => r.period === period.period).flatMap(r => r.holes);
      const counted = holes.filter(h => h.primaryContributorPlayerId === playerId && h.relativeToPar !== null);
      return { playerId, period: period.period, score: counted.length ? counted.reduce((sum, h) => sum + h.relativeToPar!, 0) : null,
        countingHoles: counted.length, tiedHoles: holes.filter(h => h.contributorPlayerIds.includes(playerId) && h.contributorPlayerIds.length > 1).length };
    }));
    const holes = team.rounds.flatMap(r => r.holes);
    return { slate_id: input.slateId, team_id: team.teamId, fantasy_points: team.toPar, finish_position: null as number | null,
      games_completed: holes.filter(h => h.status === 'final').length,
      games_in_progress: holes.filter(h => h.status === 'provisional').length,
      games_remaining: holes.filter(h => h.status === 'unscored').length,
      contributions, provisional: holes.some(h => h.status === 'provisional') || (team.holesScored > 0 && team.toPar === null),
      bestBallRounds: team.rounds.map(round => ({ roundNumber: round.roundNumber, period: round.period, holes: round.holes })),
    };
  });
  const draftOrder = (id: number) => Number(input.slateTeams.find(t => Number(t.team_id) === id)?.draft_order ?? 999);
  teams.sort((a, b) => (a.fantasy_points ?? Infinity) - (b.fantasy_points ?? Infinity) || draftOrder(a.team_id) - draftOrder(b.team_id) || a.team_id - b.team_id);
  teams.forEach((team, i) => { team.finish_position = team.fantasy_points === null ? null : i + 1; });
  return teams;
}
