import type { PlayerStat } from "@/components/lineups/types";

/** Display only the slate fields the existing refresh pipeline actually persists. */
export function scoresStatLine(sport: string, position: string, stat: PlayerStat | null): string {
  if (!stat) return "No stats yet";
  const value = (key: keyof PlayerStat) => {
    const number = Number(stat[key] ?? 0);
    return Number.isFinite(number) ? number : 0;
  };
  if (sport === "nba") {
    return `${value("points")} PTS · ${value("rebounds")} REB · ${value("assists")} AST`;
  }
  switch (position.toUpperCase()) {
    case "QB":
      return `${value("passing_yards")} PASS · ${value("passing_tds")} TD · ${value("passing_ints")} INT · ${value("rushing_yards")} RUSH`;
    case "RB":
      return `${value("rushing_yards")} RUSH · ${value("rushing_tds")} RUSH TD · ${value("receptions")} REC · ${value("receiving_yards")} REC YD${value("receiving_tds") ? ` · ${value("receiving_tds")} REC TD` : ""}`;
    case "WR":
    case "TE":
      return `${value("receptions")} REC · ${value("receiving_yards")} YD · ${value("receiving_tds")} TD`;
    case "K":
    case "PK":
      return "Kicking breakdown unavailable";
    case "D/ST":
      return "Defense breakdown unavailable";
    default:
      return "Stat breakdown unavailable";
  }
}
