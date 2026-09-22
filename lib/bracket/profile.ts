import { bracketResultsFromOfficialGames, bracketScoringRulesFromSnapshot, scoreBracket } from "./scoring";
import { bracketTopologyFromRows } from "./persistence";
import type { BracketPicks } from "./types";

export type BracketProfileEntry = {
  id: number; entrantId: string; contestId: string; competitionId: number; bracketNumber: number;
  season: number; competitionName: string; competitionStatus: string; contestStatus: string;
  lockedAt: string | null; rulesSnapshot: Record<string, unknown> | null; picks: BracketPicks | null;
};
export type BracketProfileGame = { competitionId: number; id: number; gameKey: string; roundKey: string; roundOrder: number; gameOrder: number; sourceATeamId: string | null; sourceAGameId: number | null; sourceBTeamId: string | null; sourceBGameId: number | null; status: string; winnerTeamId: string | null };

const round = (value: number) => Number(value.toFixed(1));

/**
 * A top-half finish is a final contest entry whose competition rank is at
 * most ceil(number of locked entries / 2). Standard competition ranking is
 * used, so tied entries at the boundary all qualify without inventing a tie
 * breaker that the contest did not apply.
 */
export function topHalf(rank: number, lockedEntrants: number) {
  return rank <= Math.ceil(lockedEntrants / 2);
}

export function deriveBracketProfile(entries: BracketProfileEntry[], games: BracketProfileGame[], entrantId: string) {
  const gamesByCompetition = new Map<number, BracketProfileGame[]>();
  for (const game of games) gamesByCompetition.set(game.competitionId, [...(gamesByCompetition.get(game.competitionId) ?? []), game]);
  const rows = entries.filter((entry) => entry.lockedAt && entry.picks && entry.rulesSnapshot).flatMap((entry) => {
    const competitionGames = gamesByCompetition.get(entry.competitionId) ?? [];
    if (!competitionGames.length) return [];
    const topology = bracketTopologyFromRows(competitionGames.map((game) => ({ id: game.id, game_key: game.gameKey, round_key: game.roundKey, round_order: game.roundOrder, game_order: game.gameOrder, source_a_team_id: game.sourceATeamId, source_a_game_id: game.sourceAGameId, source_b_team_id: game.sourceBTeamId, source_b_game_id: game.sourceBGameId })));
    const score = scoreBracket(topology, entry.picks ?? {}, bracketResultsFromOfficialGames(competitionGames.map((game) => ({ gameId: game.gameKey, status: game.status, winnerTeamId: game.winnerTeamId }))), bracketScoringRulesFromSnapshot(entry.rulesSnapshot, topology));
    const complete = entry.competitionStatus === "final" && entry.contestStatus === "final" && competitionGames.every((game) => game.status === "final");
    const champion = [...topology.games].sort((a, b) => b.roundOrder - a.roundOrder || b.gameOrder - a.gameOrder)[0];
    const championCorrect = Boolean(complete && champion && entry.picks?.[champion.id] && entry.picks[champion.id] === competitionGames.find((game) => game.gameKey === champion.id)?.winnerTeamId);
    const perfectRounds = complete ? score.rounds.filter((item) => item.unmadePicks === 0 && item.correctPicks > 0 && item.incorrectPicks === 0 && item.pendingPicks === 0 && item.eliminatedPicks === 0).map((item) => item.roundKey) : [];
    return [{ entry, score, complete, championCorrect, perfectRounds, perfectBracket: complete && score.unmadePicks === 0 && score.correctPicks === competitionGames.length }];
  });
  const rankByEntry = new Map<number, { rank: number; entrants: number }>();
  for (const contestId of [...new Set(rows.map((row) => row.entry.contestId))]) {
    const contestRows = rows.filter((row) => row.entry.contestId === contestId && row.complete).sort((a, b) => b.score.pointsEarned - a.score.pointsEarned || a.entry.id - b.entry.id);
    let rank = 0, prior: number | null = null;
    contestRows.forEach((row, index) => { if (row.score.pointsEarned !== prior) rank = index + 1; prior = row.score.pointsEarned; rankByEntry.set(row.entry.id, { rank, entrants: contestRows.length }); });
  }
  const mine = rows.filter((row) => row.entry.entrantId === entrantId && row.complete).map((row) => ({ ...row, placement: rankByEntry.get(row.entry.id) ?? null }));
  const resolved = mine.reduce((sum, row) => sum + row.score.correctPicks + row.score.incorrectPicks, 0);
  const correct = mine.reduce((sum, row) => sum + row.score.correctPicks, 0);
  const finishes = mine.map((row) => row.placement?.rank).filter((value): value is number => value !== null && value !== undefined);
  const history = [...mine].sort((a, b) => b.entry.season - a.entry.season || b.entry.id - a.entry.id).map((row) => ({ entryId: row.entry.id, contestId: row.entry.contestId, season: row.entry.season, competitionName: row.entry.competitionName, bracketNumber: row.entry.bracketNumber, rank: row.placement?.rank ?? null, entrantCount: row.placement?.entrants ?? null, points: row.score.pointsEarned, correctPicks: row.score.correctPicks, resolvedPicks: row.score.correctPicks + row.score.incorrectPicks, championCorrect: row.championCorrect }));
  const championCount = mine.filter((row) => row.placement?.rank === 1).length;
  const runnerUpCount = mine.filter((row) => row.placement?.rank === 2).length;
  const topHalfCount = mine.filter((row) => row.placement && topHalf(row.placement.rank, row.placement.entrants)).length;
  const perfectRoundCount = mine.reduce((sum, row) => sum + row.perfectRounds.length, 0);
  return { history, summary: { challengesEntered: mine.length, championships: championCount, runnerUps: runnerUpCount, topHalfFinishes: topHalfCount, averageFinish: finishes.length ? round(finishes.reduce((sum, value) => sum + value, 0) / finishes.length) : null, bestFinish: finishes.length ? Math.min(...finishes) : null, totalPoints: mine.reduce((sum, row) => sum + row.score.pointsEarned, 0), correctPicks: correct, resolvedPicks: resolved, pickAccuracy: resolved ? round((correct / resolved) * 100) : null }, achievements: { bracketChampion: championCount > 0, runnerUp: runnerUpCount > 0, championCalled: mine.some((row) => row.championCorrect), topHalf: topHalfCount > 0, perfectRound: perfectRoundCount > 0, perfectBracket: mine.some((row) => row.perfectBracket), perfectRoundCount } };
}
