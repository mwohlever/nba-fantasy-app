import {
  getDefaultLeagueRules,
  type NflScoringRules,
} from "@/lib/rules/leagueRules";

export type { NflScoringRules };

export const DEFAULT_NFL_SCORING_RULES =
  getDefaultLeagueRules("nfl").scoring as NflScoringRules;

export function calculateNflFantasyPoints(
  stats: {
    passing_yards: number;
    passing_tds: number;
    passing_ints: number;
    rushing_yards: number;
    rushing_tds: number;
    receiving_yards: number;
    receiving_tds: number;
    receptions: number;
    fumbles_lost: number;
  },
  scoring: NflScoringRules = DEFAULT_NFL_SCORING_RULES,
) {
  return (
    stats.passing_yards * scoring.passingYards +
    stats.passing_tds * scoring.passingTouchdowns +
    stats.passing_ints * scoring.passingInterceptions +
    stats.rushing_yards * scoring.rushingYards +
    stats.rushing_tds * scoring.rushingTouchdowns +
    stats.receiving_yards * scoring.receivingYards +
    stats.receiving_tds * scoring.receivingTouchdowns +
    stats.receptions * scoring.receptions +
    stats.fumbles_lost * scoring.fumblesLost
  );
}
