import type { SeasonFacts } from "./types";

type Obj = Record<string, unknown>;
const object = (value: unknown): Obj => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Obj : {};
export const NFL_FANTASY_PAGE_SIZE = 2000;
export const nflFantasyBulkUrl = (season: number) => `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leaguedefaults/3?view=kona_player_info`;
export function nflFantasyBulkFilter(season: number, offset: number) {
  return JSON.stringify({ players: { limit: NFL_FANTASY_PAGE_SIZE, offset, sortPercOwned: { sortPriority: 1, sortAsc: false },
    filterStatsForTopScoringPeriodIds: { value: 1, additionalValue: [`00${season}`] } } });
}
export type NflFantasyActual = { id: string; season: number; gamesPlayed: number; stats: Record<string, number> };
export function normalizeNflFantasyPage(payload: unknown, season: number) {
  const players = object(payload).players;
  if (!Array.isArray(players) || players.length > NFL_FANTASY_PAGE_SIZE) throw new Error("Invalid NFL fantasy bulk page");
  const ids = new Set<string>(), rows: NflFantasyActual[] = [];
  for (const raw of players) {
    const wrapper = object(raw), p = object(wrapper.player), id = String(p.id);
    // ESPN's negative synthetic D/ST IDs are deliberately outside this adapter.
    if (!/^-?[1-9]\d*$/.test(id) || String(wrapper.id) !== id || ids.has(id)) throw new Error("Invalid NFL fantasy bulk identity");
    ids.add(id);
    if (id.startsWith("-") || !Array.isArray(p.stats)) continue;
    const actual = p.stats.map(object).filter(s => s.seasonId === season && s.statSourceId === 0 && s.statSplitTypeId === 0 && s.scoringPeriodId === 0);
    if (actual.length > 1) throw new Error("Duplicate NFL actual season total");
    const record = actual[0];
    if (!record || record.id !== `00${season}` || String(record.externalId) !== String(season)) continue;
    const stats = object(record.stats), gp = stats["210"];
    if (typeof gp !== "number" || !Number.isInteger(gp) || gp <= 0 || gp > 25) continue;
    if (Object.values(stats).some(n => typeof n !== "number" || !Number.isFinite(n))) throw new Error("Invalid NFL fantasy statistic");
    rows.push({ id, season, gamesPlayed: gp, stats: stats as Record<string, number> });
  }
  return { rows, ids: [...ids], count: players.length };
}
const commonInputs = { passing_yards: "3", passing_tds: "4", passing_ints: "20", rushing_yards: "24", rushing_tds: "25", receiving_yards: "42", receiving_tds: "43", receptions: "53" };

/** Authorized sparse-zero interpretation applies ONLY to a reconciled actual season record. */
export function supplementNflFumbles(facts: SeasonFacts[], actuals: NflFantasyActual[]) {
  const byId = new Map(actuals.map(row => [row.id, row]));
  return facts.map(fact => {
    if (fact.sport !== "nfl" || fact.phase !== "regular" || fact.stats.fumbles_lost !== null) return fact;
    const actual = byId.get(fact.providerPlayerId);
    if (!actual || actual.season !== fact.season || actual.gamesPlayed !== fact.gamesPlayed || Object.entries(commonInputs).some(([key, id]) =>
      fact.stats[key] === null || fact.stats[key] === undefined || fact.stats[key] !== (actual.stats[id] ?? 0))) return fact;
    // GP alone is not evidence of an intact sparse offensive record. Never
    // decode a missing loss from an otherwise empty scoring payload.
    if (!Object.hasOwn(actual.stats, "72") && !Object.values(commonInputs).some(id => Object.hasOwn(actual.stats, id))) return fact;
    const losses = actual.stats["72"] ?? 0;
    if (!Number.isInteger(losses) || losses < 0) return fact;
    return { ...fact, stats: { ...fact.stats, fumbles_lost: losses }, source: `${fact.source} + ${nflFantasyBulkUrl(fact.season)}`,
      issues: [...fact.issues, ...(actual.stats["72"] === undefined ? ["fumbles_lost_sparse_zero"] : [])] };
  });
}
