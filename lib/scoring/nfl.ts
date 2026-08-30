import {
  getDefaultLeagueRules,
  type NflScoringRules,
} from "@/lib/rules/leagueRules";

export type { NflScoringRules };

export const DEFAULT_NFL_SCORING_RULES =
  getDefaultLeagueRules("nfl").scoring as NflScoringRules;

export type NflDstStats = {
  sacks: number;
  interceptions: number;
  fumbleRecoveries: number;
  safeties: number;
  touchdowns: number;
  pointsAllowed: number;
  yardsAllowed: number;
};

export function getNflDstPointsAllowedScore(
  pointsAllowed: number,
  scoring: NflScoringRules = DEFAULT_NFL_SCORING_RULES,
) {
  if (pointsAllowed <= 0) return scoring.dstPointsAllowed0;
  if (pointsAllowed <= 6) return scoring.dstPointsAllowed1To6;
  if (pointsAllowed <= 13) return scoring.dstPointsAllowed7To13;
  if (pointsAllowed <= 20) return scoring.dstPointsAllowed14To20;
  if (pointsAllowed <= 27) return scoring.dstPointsAllowed21To27;
  if (pointsAllowed <= 34) return scoring.dstPointsAllowed28To34;
  return scoring.dstPointsAllowed35Plus;
}

export function getNflDstYardsAllowedScore(
  yardsAllowed: number,
  scoring: NflScoringRules = DEFAULT_NFL_SCORING_RULES,
) {
  if (yardsAllowed < 100) return scoring.dstYardsAllowedUnder100;
  if (yardsAllowed < 200) return scoring.dstYardsAllowed100To199;
  if (yardsAllowed < 300) return scoring.dstYardsAllowed200To299;
  if (yardsAllowed < 350) return scoring.dstYardsAllowed300To349;
  if (yardsAllowed < 400) return scoring.dstYardsAllowed350To399;
  if (yardsAllowed < 450) return scoring.dstYardsAllowed400To449;
  return scoring.dstYardsAllowed450Plus;
}

export function calculateNflDstFantasyPoints(
  stats: NflDstStats,
  scoring: NflScoringRules = DEFAULT_NFL_SCORING_RULES,
) {
  return (
    stats.sacks * scoring.dstSacks +
    stats.interceptions * scoring.dstInterceptions +
    stats.fumbleRecoveries * scoring.dstFumbleRecoveries +
    stats.safeties * scoring.dstSafeties +
    stats.touchdowns * scoring.dstTouchdowns +
    getNflDstPointsAllowedScore(stats.pointsAllowed, scoring) +
    getNflDstYardsAllowedScore(stats.yardsAllowed, scoring)
  );
}

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
