import { resolveLeagueRules, type NbaScoringRules, type NflScoringRules } from "../rules/leagueRules";
import { getNflDstPointsAllowedScore, getNflDstYardsAllowedScore } from "../scoring/nfl";
import { actualFantasyPoints, summarizeHistory } from "./comparison";
import { seasonLabel, type CenterGame, type CenterHistory, type CenterScoringContext } from "./types";
import type { CenterSeasonStats } from "./espn";

export type ScoringPart = { label: string; value: number | null; multiplier: number | null; points: number | null };
const nba = [["points", "points", "Points"], ["rebounds", "rebounds", "Rebounds"], ["assists", "assists", "Assists"],
  ["steals", "steals", "Steals"], ["blocks", "blocks", "Blocks"], ["turnovers", "turnovers", "Turnovers"]] as const;
const nfl = [["passing_yards", "passingYards", "Passing yards"], ["passing_tds", "passingTouchdowns", "Passing TD"],
  ["passing_ints", "passingInterceptions", "Interceptions thrown"], ["rushing_yards", "rushingYards", "Rushing yards"],
  ["rushing_tds", "rushingTouchdowns", "Rushing TD"], ["receiving_yards", "receivingYards", "Receiving yards"],
  ["receiving_tds", "receivingTouchdowns", "Receiving TD"], ["receptions", "receptions", "Receptions"], ["fumbles_lost", "fumblesLost", "Fumbles lost"]] as const;

/** Explain the canonical coefficients; unknown inputs remain unknown even in a partial breakdown. */
export function scoringBreakdown(game: CenterGame, position: string, context: CenterScoringContext): ScoringPart[] {
  if (position === "K" || game.status !== "final" || game.participation !== "played") return [];
  const rules = resolveLeagueRules({ sport: context.sport, settings: context.settings }).scoring;
  const part = (field: string, label: string, multiplier: number): ScoringPart => {
    const value = game.stats[field];
    return { label, value: value ?? null, multiplier, points: value == null ? null : value * multiplier };
  };
  if (context.sport === "nba") return nba.map(([field, rule, label]) => part(field, label, (rules as NbaScoringRules)[rule]));
  const r = rules as NflScoringRules;
  if (position === "D/ST") return [part("sacks", "Sacks", r.dstSacks), part("interceptions", "Interceptions", r.dstInterceptions),
    part("fumbleRecoveries", "Fumble recoveries", r.dstFumbleRecoveries), part("safeties", "Safeties", r.dstSafeties), part("touchdowns", "Defense / ST TD", r.dstTouchdowns),
    { label: "Points allowed tier", value: game.stats.pointsAllowed ?? null, multiplier: null, points: game.stats.pointsAllowed == null ? null : getNflDstPointsAllowedScore(game.stats.pointsAllowed, r) },
    { label: "Yards allowed tier", value: game.stats.yardsAllowed ?? null, multiplier: null, points: game.stats.yardsAllowed == null ? null : getNflDstYardsAllowedScore(game.stats.yardsAllowed, r) }];
  return nfl.map(([field, rule, label]) => part(field, label, r[rule]));
}

export type PresentableHistory = CenterHistory & { seasonStats: CenterSeasonStats | null; byeWeeks: number[] | null; providerRequests: number };
export function presentProfile(history: PresentableHistory, scoring: CenterScoringContext, asOf: string) {
  return { ...history, seasonLabel: seasonLabel(history.player.sport, history.season), asOf, scoringBasis: scoring.basis,
    fantasyScoringAvailable: history.player.position !== "K",
    kickerScoringDecision: history.player.position === "K" ? "Kicker fantasy scoring has not been configured. Kicking points are real box-score statistics, not fantasy points." : null,
    gameFantasyPoints: Object.fromEntries(history.games.map(game => [game.eventId, Date.parse(game.gameAt) <= Date.parse(asOf) ? actualFantasyPoints(game, history.player.position, scoring) : null])),
    gameBreakdowns: Object.fromEntries(history.games.map(game => [game.eventId, scoringBreakdown(game, history.player.position, scoring)])),
    windows: Object.fromEntries((["last1", "last3", "last5", "season"] as const).map(window => [window, summarizeHistory(history, window, scoring, asOf)])) };
}
export type CenterProfile = ReturnType<typeof presentProfile>;
