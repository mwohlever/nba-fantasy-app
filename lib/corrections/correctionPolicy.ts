import type {
  NbaScoringRules,
  NflScoringRules,
} from "@/lib/rules/leagueRules";

export type CorrectionSport = "nba" | "nfl";

export type CorrectionStatValues = Record<string, number>;

export function parseCorrectionSport(
  value: string | null | undefined,
): CorrectionSport | null {
  return value === "nba" || value === "nfl" ? value : null;
}

export function getCorrectionPlayerSource(sport: CorrectionSport) {
  return sport === "nfl"
    ? {
        table: "players_nfl",
        positionColumn: "position",
      }
    : {
        table: "players",
        positionColumn: "position_group",
      };
}

export function calculateCorrectionFantasyPoints({
  sport,
  stats,
  scoring,
}: {
  sport: CorrectionSport;
  stats: CorrectionStatValues;
  scoring: NbaScoringRules | NflScoringRules;
}) {
  if (sport === "nfl") {
    const rules = scoring as NflScoringRules;

    return (
      Number(stats.passing_yards ?? 0) * rules.passingYards +
      Number(stats.passing_tds ?? 0) * rules.passingTouchdowns +
      Number(stats.passing_ints ?? 0) * rules.passingInterceptions +
      Number(stats.rushing_yards ?? 0) * rules.rushingYards +
      Number(stats.rushing_tds ?? 0) * rules.rushingTouchdowns +
      Number(stats.receiving_yards ?? 0) * rules.receivingYards +
      Number(stats.receiving_tds ?? 0) * rules.receivingTouchdowns +
      Number(stats.receptions ?? 0) * rules.receptions +
      Number(stats.fumbles_lost ?? 0) * rules.fumblesLost
    );
  }

  const rules = scoring as NbaScoringRules;

  return (
    Number(stats.points ?? 0) * rules.points +
    Number(stats.rebounds ?? 0) * rules.rebounds +
    Number(stats.assists ?? 0) * rules.assists +
    Number(stats.steals ?? 0) * rules.steals +
    Number(stats.blocks ?? 0) * rules.blocks +
    Number(stats.turnovers ?? 0) * rules.turnovers
  );
}

export function uniqueParticipatingTeamIds(
  rows: Array<{ team_id: number; is_participating?: boolean | null }>,
) {
  return Array.from(
    new Set(
      rows
        .filter((row) => row.is_participating !== false)
        .map((row) => Number(row.team_id))
        .filter((teamId) => Number.isInteger(teamId) && teamId > 0),
    ),
  );
}
