"use client";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useGroupContext } from "@/components/providers/GroupProvider";
import PlayerHeadshot from "@/components/ui/PlayerHeadshot";
import { comparisonStats, compareActualStats } from "@/lib/player-center/comparison";
import { formatStat, statLabels, windowLabel, type CenterIdentity } from "@/lib/player-center/display";
import type { CenterSport, CenterWindow } from "@/lib/player-center/types";
import { realCenterLoader, type CenterLoader, type ComparisonData } from "./data";
import { useCenterResource } from "./useCenterResource";
import { WindowControl } from "./PlayerCenter";
import CoverageNotice from "./CoverageNotice";

export type BrowserEntry = { identity: CenterIdentity; status?: string };
export type ResearchBrowserProps = { sport: CenterSport; season: number; slateId?: number | null; loader?: CenterLoader; fixture?: boolean;
  entries?: BrowserEntry[]; search?: string; onSearch?: (search: string) => void; position?: string; onPosition?: (position: string) => void;
  positions?: string[]; hidePositionFilter?: boolean; onInspect: (identity: CenterIdentity) => void;
  onSelect?: (identity: CenterIdentity) => void; selectedId?: number | null; disabled?: boolean; extras?: ReactNode };

export default function ResearchBrowser({ sport, season, slateId, loader = realCenterLoader, fixture = false, entries, search: controlledSearch, onSearch,
  position: controlledPosition, onPosition, positions, hidePositionFilter, onInspect, onSelect, selectedId, disabled = false, extras }: ResearchBrowserProps) {
  const [searchState, setSearch] = useState(""), [positionState, setPosition] = useState("All");
  const [window, setWindow] = useState<CenterWindow>("last5"), [metric, setMetric] = useState("fantasy_points"), [ascending, setAscending] = useState(false);
  const search = controlledSearch ?? searchState, position = controlledPosition ?? positionState;
  const { groupContext } = useGroupContext(), scope = groupContext?.group.id ?? "none";
  const providerPosition = ["G", "F/C", "QB", "RB", "WR", "TE", "K", "D/ST"].includes(position) ? position : undefined;
  const requestMetric = metric === "name" ? "fantasy_points" : metric;
  const load = useCallback(async (signal: AbortSignal) => {
    const data = await loader.comparisons({ sport, season, slateId, window, metric: requestMetric, ascending, position: providerPosition }, signal);
    if (!Array.isArray(data.players) || !data.coverage) throw new Error("Comparison data is not available for this pool.");
    if (data.sport !== sport || data.season !== season || data.window !== window || data.metric !== requestMetric) throw new Error("Comparison context changed. Reopen player research.");
    if (!fixture && scope !== "none" && (data as ComparisonData & { groupId?: string }).groupId !== scope) throw new Error("The active Group changed. Reopen player research.");
    return data;
  }, [loader, sport, season, slateId, window, requestMetric, ascending, providerPosition, fixture, scope]);
  const { data, loading, error } = useCenterResource(`${scope}:${sport}:${season}:${slateId}:${window}:${requestMetric}:${ascending}:${providerPosition}`, load);
  const options = useMemo<string[]>(() => {
    if (sport === "nba") return [...comparisonStats.nba];
    const keys = position === "FLEX" ? ["RB", "WR", "TE"] : position === "SF" ? ["QB", "RB", "WR", "TE"]
      : position in comparisonStats ? [position] : Object.keys(comparisonStats).filter(key => key !== "nba");
    return [...new Set(keys.flatMap(key => [...comparisonStats[key as keyof typeof comparisonStats]]))];
  }, [sport, position]);
  const dataById = new Map(data?.players.map(row => [row.player.playerId, row]) ?? []);
  const sourceEntries: BrowserEntry[] = entries ?? (data?.players.map(row => ({ identity: { id: row.player.playerId, name: row.player.name, positionGroup: row.player.position,
    nbaPlayerId: sport === "nba" ? Number(row.player.nativePlayerId) || null : null, nflPlayerId: sport === "nfl" ? Number(row.player.nativePlayerId) || null : null } })) ?? []);
  // A draft may contain legacy/inactive rows outside the active comparison catalog.
  // Such rows must not silently disappear from the relevant ranking universe.
  const knownEntries = sourceEntries.every(entry => dataById.has(entry.identity.id));
  const canSort = metric === "name" || data?.coverage.canSort === true && knownEntries;
  const rows = sourceEntries.filter(row => (!search || row.identity.name.toLowerCase().includes(search.toLowerCase())) &&
    (entries !== undefined || position === "All" || row.identity.positionGroup === position)).sort((a, b) => {
    const comparison = canSort && metric !== "name" ? compareActualStats(dataById.get(a.identity.id)?.rankableAverage, dataById.get(b.identity.id)?.rankableAverage, ascending) : 0;
    return comparison || a.identity.name.localeCompare(b.identity.name) * (metric === "name" && !ascending ? -1 : 1);
  });
  const selectedMetric = statLabels[metric] ?? "Player name";
  const allPositions = positions ?? (sport === "nba" ? ["All", "G", "F/C"] : ["All", "QB", "RB", "WR", "TE", "K", "D/ST"]);
  return <section className="pc pc-browser" data-sport={sport} aria-label={`${sport.toUpperCase()} player research`}>
    {fixture && <div className="pc-fixture">FIXTURE PLAYER POOL · captured statistics · selection does not save a draft</div>}
    <div className="pc-browser-controls">
      <label className="pc-search">Search players<input type="search" placeholder="Search players…" value={search} onChange={e => (onSearch ?? setSearch)(e.target.value)} /></label>
      {!hidePositionFilter && <label>Position<select aria-label="Position filter" value={position} onChange={e => { (onPosition ?? setPosition)(e.target.value); setMetric(e.target.value === "K" ? "field_goals_made" : "fantasy_points"); }}>
        {[...new Set(allPositions)].map(value => <option key={value} value={value}>{value}</option>)}</select></label>}
      <label>Stat sort<select aria-label="Stat sort" value={metric} onChange={e => setMetric(e.target.value)}><option value="name">Player name</option>
        {!options.includes(metric) && metric !== "name" && <option value={metric}>{statLabels[metric]}</option>}
        {options.map(key => <option key={key} value={key}>{statLabels[key] ?? key}</option>)}</select></label>
      <button className="pc-direction" aria-label="Change stat sort direction" onClick={() => setAscending(value => !value)}>{ascending ? "Ascending ↑" : "Descending ↓"}</button>
    </div>
    <div className="pc-browser-subcontrols"><WindowControl value={window} onChange={setWindow} />{extras}</div>
    <div className="pc-sort-state" aria-live="polite"><strong>{metric === "name" ? `Player name · ${ascending ? "A–Z" : "Z–A"}` : canSort ? `${windowLabel[window]} · ${selectedMetric} / game · ${ascending ? "low to high" : "high to low"}` : "Alphabetical · statistical ranking unavailable"}</strong><span>{rows.length} players</span></div>
    {metric !== "name" && !canSort && <CoverageNotice summary={loading ? "Checking coverage…" : error ? "Comparison data unavailable" : !knownEntries ? "Pool coverage incomplete" : `${data?.coverage.rankablePlayers ?? 0}/${data?.coverage.relevantPlayers ?? 0} source players have a complete sample`}>
      <p>{error || `A complete, fresh ${windowLabel[window].toLowerCase()} ${selectedMetric} sample is required across the relevant player pool. Names remain alphabetical; observed values are not authoritative rankings.`}</p>
      {!knownEntries && <p>Some draft players have no verified comparison record.</p>}
      <p>Missing statistics are unavailable, not zero. Change the window or metric to check another comparison.</p>
    </CoverageNotice>}
    <div className="pc-table-scroll" role="region" aria-label="Player research table; scroll for statistics" tabIndex={0}><table className="pc-table pc-pool-table"><thead><tr>
      <th className="pc-sticky">Player</th><th>Position</th><th>{windowLabel[window]}<small>{metric === "name" ? "FP / game" : `${selectedMetric} / game`}</small></th><th>Sample</th><th>Status</th><th>Profile</th>
    </tr></thead><tbody>{rows.map(entry => {
      const row = dataById.get(entry.identity.id), value = row?.observedAverage;
      return <tr key={entry.identity.id} data-selected={selectedId === entry.identity.id}>
        <th className="pc-sticky" scope="row"><button type="button" className="draft-player-card pc-player-button" aria-label={`${onSelect ? "Select" : "View"} ${entry.identity.name} player profile`} disabled={disabled} onClick={() => (onSelect ?? onInspect)(entry.identity)}>
          <PlayerHeadshot nbaPlayerId={entry.identity.nbaPlayerId} nflPlayerId={entry.identity.nflPlayerId} imageUrl={entry.identity.headshotUrl} playerName={entry.identity.name} size="sm" />
          <span>{entry.identity.name}<small>{entry.identity.teamAbbreviation ?? "Player profile"}</small></span></button></th>
        <td>{entry.identity.positionGroup ?? "—"}</td><td className="pc-fp">{formatStat(value)}{row?.metricRelevant === false && <small>Not applicable</small>}{value != null && row?.rankableAverage == null && <small>Observed only</small>}</td>
        <td>{row ? `${row.summary.metricSamples[requestMetric] ?? 0} / ${row.summary.sampleSize}` : "—"}<small>verified / observed</small></td><td><span className="pc-status">{entry.status ?? (!row ? "Statistics unavailable" : row.player.identity !== "resolved" ? "Mapping unavailable" : row.summary.availableGames ? "Observed games" : "No verified games")}</span>{row?.coverage.freshness === "stale" && <small>Statistics stale</small>}{row?.coverage.freshness === "unavailable" && <small>Statistics unavailable</small>}</td>
        <td><button type="button" className="pc-info" aria-label={`Info about ${entry.identity.name}`} disabled={disabled} onClick={() => onInspect(entry.identity)}>Info</button></td>
      </tr>;
    })}</tbody></table></div>
    {!rows.length && <div className="pc-empty"><strong>{loading ? "Loading player catalog…" : "No players to display"}</strong><p>{error || "Try another search or position. Missing coverage will not be replaced with projections."}</p></div>}
    <p className="pc-footnote">{windowLabel[window]} averages use actual appearances in {data?.seasonLabel ?? season}. — means unavailable. Samples show verified / observed games.{data?.asOf && <> Cutoff {new Date(data.asOf).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}.</>}</p>
  </section>;
}
