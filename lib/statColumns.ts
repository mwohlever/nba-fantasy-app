export type StatColumn = {
  key: string;
  label: string;
};

export const STAT_COLUMNS_BY_SPORT: Record<string, StatColumn[]> = {
  nba: [
    { key: "points", label: "PTS" },
    { key: "rebounds", label: "REB" },
    { key: "assists", label: "AST" },
    { key: "steals", label: "STL" },
    { key: "blocks", label: "BLK" },
    { key: "turnovers", label: "TO" },
  ],
  nfl: [
    { key: "passing_yards", label: "PASS YD" },
    { key: "passing_tds", label: "PASS TD" },
    { key: "passing_ints", label: "INT" },
    { key: "rushing_yards", label: "RUSH YD" },
    { key: "rushing_tds", label: "RUSH TD" },
    { key: "receiving_yards", label: "REC YD" },
    { key: "receiving_tds", label: "REC TD" },
    { key: "receptions", label: "REC" },
    { key: "fumbles_lost", label: "FUM" },
  ],
};

export function getStatColumns(sport: string | null | undefined): StatColumn[] {
  return STAT_COLUMNS_BY_SPORT[sport ?? "nba"] ?? STAT_COLUMNS_BY_SPORT.nba;
}
