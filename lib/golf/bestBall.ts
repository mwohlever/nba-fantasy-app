import { eligibleGolfPlayerIds, golfPeriodForRound } from './eligibleRoster';
import type { EligibleGolfRoster, RegulationRound } from './eligibleRoster';
import type { GolfScoringInput } from './scoring';

export type BestBallHole = {
  holeNumber: number;
  strokes: number | null;
  relativeToPar: number | null;
  par: number | null;
  contributorPlayerIds: number[];
  primaryContributorPlayerId: number | null;
  unresolvedPlayerIds: number[];
  status: 'unscored' | 'provisional' | 'final';
};

function totals(holes: readonly BestBallHole[]) {
  const scored = holes.filter(hole => hole.strokes !== null);
  return {
    holesScored: scored.length,
    // Empty/unknown is not an even-par score. Totals cover scored holes only.
    strokes: scored.length ? scored.reduce((sum, hole) => sum + hole.strokes!, 0) : null,
    toPar: scored.length && scored.every(hole => hole.relativeToPar !== null)
      ? scored.reduce((sum, hole) => sum + hole.relativeToPar!, 0) : null,
  };
}

/**
 * Caller supplies accepted state and rosters for comparable regulation course holes.
 * Canonical storage has no per-player course identity: multi-course events require a
 * verified course mapping before use. This reducer never maps playing sequence to holes.
 * Final means all eligible golfers currently have an accepted contribution; corrections
 * can still revise it. Terminal status alone cannot prove missing feed data won't arrive.
 */
export function scoreBestBall(input: Omit<GolfScoringInput, 'rosters'> & {
  roster: EligibleGolfRoster;
  rounds: readonly RegulationRound[];
}) {
  if (!input.rounds.length || new Set(input.rounds).size !== input.rounds.length) throw new Error('Supply unique regulation rounds');
  const events = new Map(input.acceptedEvents.map(event => [event.player_id, event]));
  if (events.size !== input.acceptedEvents.length) throw new Error('Duplicate accepted golfer');
  const rounds = [...input.rounds].sort((a, b) => a - b).map(roundNumber => {
    const playerIds = eligibleGolfPlayerIds(input.roster, input.rosterPeriodType, roundNumber).sort((a, b) => a - b);
    const playerHoles = playerIds.map(playerId => {
      const rounds = (events.get(playerId)?.golf_rounds ?? []).filter(round => round.round_number === roundNumber);
      if (rounds.length > 1) throw new Error('Duplicate accepted round');
      const holes = rounds[0]?.golf_holes ?? [];
      if (new Set(holes.map(hole => hole.hole_number)).size !== holes.length) throw new Error('Duplicate accepted hole');
      return { playerId, holes };
    });
    const holes: BestBallHole[] = Array.from({ length: 18 }, (_, index) => {
      const holeNumber = index + 1;
      const contributions = playerHoles.flatMap(({ playerId, holes }) => {
        const hole = holes.find(hole => hole.hole_number === holeNumber);
        if (hole?.strokes == null) return [];
        if (!Number.isInteger(hole.strokes) || hole.strokes <= 0) throw new Error('Invalid accepted strokes');
        return [{ playerId, strokes: hole.strokes, relativeToPar: hole.relative_to_par }];
      });
      const strokes = contributions.length ? Math.min(...contributions.map(hole => hole.strokes)) : null;
      const winners = contributions.filter(hole => hole.strokes === strokes);
      const pars = contributions.map(hole => hole.relativeToPar == null ? null : hole.strokes - hole.relativeToPar);
      const par = pars.length && pars.every(value => value !== null && Number.isInteger(value) && value >= 3 && value <= 6 && value === pars[0]) ? pars[0] : null;
      const unresolvedPlayerIds = playerIds.filter(id => !contributions.some(hole => hole.playerId === id));
      return {
        holeNumber, strokes, par, relativeToPar: strokes !== null && par !== null ? strokes - par : null,
        contributorPlayerIds: winners.map(hole => hole.playerId), primaryContributorPlayerId: winners[0]?.playerId ?? null,
        unresolvedPlayerIds,
        status: strokes === null ? 'unscored' : unresolvedPlayerIds.length ? 'provisional' : 'final',
      };
    });
    return { roundNumber, period: golfPeriodForRound(input.rosterPeriodType, roundNumber), holes, ...totals(holes) };
  });
  return { teamId: input.roster.teamId, rounds, ...totals(rounds.flatMap(round => round.holes)) };
}
