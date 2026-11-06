"use client";
import { useCallback } from "react";
import { useGroupContext } from "@/components/providers/GroupProvider";
import { seasonLabel, validCenterSeason, type CenterSport, type CenterWindow } from "@/lib/player-center/types";
import { windowLabel } from "@/lib/player-center/display";
import { realCenterLoader, type CenterLoader, type ComparisonData } from "./data";
import { useCenterResource } from "./useCenterResource";

type Player = { id: number; position_group?: string };
type Metric = { key: string; label: string; lower: boolean };
export function comparisonHeading(sport: CenterSport, season: number | null, window: CenterWindow) {
  return `${season === null ? "Season unavailable" : seasonLabel(sport, season)} ${sport.toUpperCase()} · ${windowLabel[window]} averages`;
}
function metricsFor(sport: CenterSport, players: Player[]): Metric[] {
  const metrics: Array<[string, string, boolean?]> = sport === "nba" ? [
    ["fantasy_points", "FP"], ["points", "PTS"], ["rebounds", "REB"], ["assists", "AST"],
    ["steals", "STL"], ["blocks", "BLK"], ["turnovers", "TO", true],
  ] : [
    ["fantasy_points", "FP/G"],
    ...(players.some(player => player.position_group?.toUpperCase() === "QB") ? [
      ["passing_yards", "Pass Yds/G"], ["passing_tds", "Pass TD/G"], ["passing_ints", "INT/G", true],
    ] as Array<[string, string, boolean?]> : []),
    ...(players.some(player => !["K", "D/ST"].includes(player.position_group?.toUpperCase() ?? "")) ? [
      ["rushing_yards", "Rush Yds/G"], ["rushing_tds", "Rush TD/G"], ["receiving_targets", "Targets/G"],
      ["receptions", "REC/G"], ["receiving_yards", "Rec Yds/G"], ["receiving_tds", "Rec TD/G"],
    ] as Array<[string, string, boolean?]> : []),
    ...(players.some(player => player.position_group?.toUpperCase() === "K") ? [
      ["field_goals_made", "FG/G"], ["field_goals_attempted", "FGA/G"],
      ["extra_points_made", "PAT/G"], ["extra_points_attempted", "PATA/G"], ["kicking_points", "Kick Pts/G"],
    ] as Array<[string, string, boolean?]> : []),
    ...(players.some(player => player.position_group?.toUpperCase() === "D/ST") ? [
      ["sacks", "Sacks/G"], ["interceptions", "Def INT/G"], ["fumbleRecoveries", "FR/G"],
      ["pointsAllowed", "Pts Allowed/G", true], ["yardsAllowed", "Yds Allowed/G", true],
    ] as Array<[string, string, boolean?]> : []),
  ];
  return metrics.map(([key, label, lower = false]) => ({ key, label, lower }));
}

/** One stored-facts response supplies every metric. No provider/profile or prior-year fallback. */
export default function ObservedComparisonRows({ sport, season, window, slateId, players, loader = realCenterLoader }: {
  sport: CenterSport; season: number | null; window: CenterWindow; slateId?: number | null; players: Player[]; loader?: CenterLoader;
}) {
  const { groupContext } = useGroupContext(), scope = groupContext?.group.id ?? "none";
  const ids = players.map(player => player.id).join(",");
  const load = useCallback(async (signal: AbortSignal) => {
    if (season === null || !validCenterSeason(season, sport)) throw new Error("A valid professional season is required for comparison.");
    if (scope === "none") throw new Error("An active Group is required for comparison.");
    // Omit the browser's position/search filters: selected NFL players can span positions.
    const result = await loader.comparisons({ sport, season, window, slateId, metric: "fantasy_points", ascending: false, playerIds: ids }, signal);
    if (result.sport !== sport || result.season !== season || result.window !== window || result.phase !== "regular" ||
      result.metric !== "fantasy_points" || (result as ComparisonData & { groupId?: string }).groupId !== scope || !Array.isArray(result.players)) {
      throw new Error("Comparison context changed. Reopen Compare Players.");
    }
    const selected = result.players.filter(row => ids.split(",").includes(String(row.player.playerId)));
    if (selected.some(row => row.player.sport !== sport || row.summary.window !== window) || new Set(selected.map(row => row.player.playerId)).size !== selected.length) {
      throw new Error("Comparison samples do not match the selected context.");
    }
    return result;
  }, [loader, sport, season, window, slateId, scope, ids]);
  const { data, loading, error } = useCenterResource(`${scope}:${sport}:${season}:${window}:${slateId}:${ids}`, load);
  const byId = new Map(data?.players.map(row => [row.player.playerId, row]) ?? []);
  const stale = players.some(player => byId.get(player.id)?.coverage.freshness === "stale");
  return <>
    <p className="px-3 py-2 text-xs text-slate-400" role={error ? "alert" : "status"}>
      {error || (loading ? "Loading selected-window statistics…" : `${data?.players.some(row => row.summary.basis === "published_season") ? "Published season totals / provider GP" : "Actual observed game averages"} · ${data?.scoringBasis === "slate_snapshot" ? "Frozen slate scoring" : data?.scoringBasis === "legacy_defaults" ? "Legacy default scoring" : "Current Group scoring"}. Missing scores remain unavailable; partial samples are qualified. ✓ marks the best available value.`)}
      {stale && " Source data is stale."}
    </p>
    {metricsFor(sport, players).map(metric => {
      const values = players.map(player => {
        const row = byId.get(player.id), value = row?.player.identity === "resolved" ? row.summary.observedAverages?.[metric.key] : null;
        return typeof value === "number" && Number.isFinite(value) ? value : null;
      });
      const finite = values.filter((value): value is number => value !== null);
      const best = finite.length ? metric.lower ? Math.min(...finite) : Math.max(...finite) : null;
      return <div key={metric.key} data-comparison-metric={metric.key} className="grid border-t border-slate-700 first:border-t-0"
        style={{ gridTemplateColumns: `110px repeat(${players.length}, minmax(0, 1fr))` }}>
        <div className="flex items-center bg-slate-900 px-3 py-3 text-xs font-bold uppercase text-slate-400">{metric.label}</div>
        {values.map((value, index) => {
          const row = byId.get(players[index].id), isBest = value !== null && value === best;
          return <div key={`${metric.key}-${players[index].id}`} data-comparison-player={players[index].id} data-best={isBest}
            className={`flex flex-col items-center justify-center border-l border-slate-700 px-2 py-3 text-sm font-black ${isBest ? "bg-sky-950 text-sky-300" : "bg-slate-900 text-white"}`}>
            <span>{value === null ? "—" : value.toFixed(1)}{isBest ? " ✓" : ""}</span>
            <small className="mt-1 text-[10px] font-normal text-slate-400">{value === null ? loading ? "Loading" : "Unavailable" : `n=${row?.summary.metricSamples[metric.key] ?? 0}${row?.summary.metricComparable[metric.key] ? "" : " · Partial"}`}</small>
          </div>;
        })}
      </div>;
    })}
  </>;
}
