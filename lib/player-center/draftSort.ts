import { comparisonStats, draftSortStats } from "./comparison";

export const existingDraftOrder = "existing_order";
export type DraftSortSelection = { metric: string; ascending: boolean; position: string; context: string; explicit: boolean };

export function nflDraftMetrics(position: string, fantasyAvailable: boolean) {
  const keys = position === "FLEX" ? ["RB", "WR", "TE"] : position === "SF" ? ["QB", "RB", "WR", "TE"]
    : position in comparisonStats ? [position] : ["QB", "RB", "WR", "TE", "K", "D/ST"];
  const metrics = draftSortStats([...new Set(keys.flatMap(key => [...comparisonStats[key as keyof typeof comparisonStats]]))])
    .filter(metric => metric !== "fantasy_points" || !["K", "D/ST"].includes(position));
  return metrics.includes("fantasy_points") ? ["fantasy_points", ...(fantasyAvailable ? ["fantasy_points_total"] : []), ...metrics.filter(metric => metric !== "fantasy_points")] : metrics;
}

/** Automatic defaults follow position; an explicit, still meaningful choice survives a filter change. */
export function resolveNflDraftSort(position: string, context: string, selection: DraftSortSelection | null,
  fantasyAvailable = false, kickingAvailable = false) {
  const fallback = position === "QB" ? "passing_yards" : position === "RB" ? "rushing_yards"
    : ["WR", "TE"].includes(position) ? "receiving_yards" : position === "K" && kickingAvailable ? "field_goals_made" : existingDraftOrder;
  const automatic = !["K", "D/ST"].includes(position) ? "fantasy_points" : fallback;
  const meaningful = selection && (selection.metric === "name" || selection.metric === existingDraftOrder || nflDraftMetrics(position, fantasyAvailable).includes(selection.metric));
  const preserved = selection?.context === context && meaningful && (selection.explicit || selection.position === position && selection.metric === automatic);
  return preserved ? { metric: selection.metric, ascending: selection.ascending } : { metric: automatic, ascending: false };
}
