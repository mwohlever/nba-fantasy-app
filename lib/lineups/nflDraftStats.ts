export const nflStatFields = {
  nfl_pass_yd: ["passing_yards", "Pass Yards"],
  nfl_pass_td: ["passing_tds", "Pass TD"],
  nfl_int: ["passing_ints", "INT"],
  nfl_rush_yd: ["rushing_yards", "Rush Yards"],
  nfl_rush_td: ["rushing_tds", "Rush TD"],
  nfl_targets: ["receiving_targets", "Targets"],
  nfl_receptions: ["receptions", "REC"],
  nfl_rec_yd: ["receiving_yards", "REC YDS"],
  nfl_rec_td: ["receiving_tds", "REC TD"],
  nfl_fp: ["fantasy_points_per_game", "FP/G"],
} as const;
export type NflStatKey = keyof typeof nflStatFields;
export type NflDraftStat = Partial<Record<(typeof nflStatFields)[NflStatKey][0], number | null>>;

export function nflPositionStats(position: string): NflStatKey[] {
  switch (position.toUpperCase()) {
    case "QB": return ["nfl_pass_yd", "nfl_pass_td", "nfl_int", "nfl_rush_yd"];
    case "RB": return ["nfl_rush_yd", "nfl_rush_td", "nfl_receptions", "nfl_rec_yd"];
    case "WR": case "TE": return ["nfl_rec_yd", "nfl_receptions", "nfl_rec_td"];
    case "K": case "D/ST": return [];
    default: return ["nfl_fp", "nfl_pass_yd", "nfl_rush_yd", "nfl_rec_yd", "nfl_receptions", "nfl_rec_td"];
  }
}

export function nflStatValue(row: NflDraftStat | undefined, key: string): number | null {
  const field = nflStatFields[key as NflStatKey]?.[0];
  const value = field ? row?.[field] : null;
  return value != null && Number.isFinite(Number(value)) ? Number(value) : null;
}

export function compareNflStats(a: NflDraftStat | undefined, b: NflDraftStat | undefined, key: string, ascending: boolean) {
  const left = nflStatValue(a, key), right = nflStatValue(b, key);
  if (left === null) return right === null ? 0 : 1;
  if (right === null) return -1;
  return ascending ? left - right : right - left;
}

// This table is imported exclusively from ESPN Core season type 2 (regular season).
export function hasMeaningfulNflStats(rows: Array<NflDraftStat & { games_played?: number | null }>) {
  return rows.some(row => Number(row.games_played) > 0 &&
    [row.passing_yards, row.rushing_yards, row.receiving_yards, row.receptions, row.passing_tds, row.rushing_tds, row.receiving_tds]
      .some(value => value != null && Number(value) !== 0));
}

export function nflComparisonSeason(season: number, rows: Array<NflDraftStat & { games_played?: number | null }>) {
  return hasMeaningfulNflStats(rows) ? season : season - 1;
}

export function nflSeasonForSlate(slate: { start_date?: string; date: string; display_name?: string | null } | null | undefined, fallback: string) {
  const namedSeason = slate?.display_name?.match(/^(\d{4}) Week \d+$/)?.[1];
  if (namedSeason) return namedSeason;
  const date = slate?.start_date ?? slate?.date;
  if (!date) return fallback;
  const year = Number(date.slice(0, 4));
  return String(Number(date.slice(5, 7)) < 3 ? year - 1 : year);
}
