"use client";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useGroupContext } from "@/components/providers/GroupProvider";
import PlayerHeadshot from "@/components/ui/PlayerHeadshot";
import { comparisonStats, compareActualStats, draftSortStats } from "@/lib/player-center/comparison";
import { formatStat, statLabels, windowLabel, type CenterIdentity } from "@/lib/player-center/display";
import type { CenterSport, CenterWindow } from "@/lib/player-center/types";
import { realCenterLoader, type CenterLoader, type ComparisonData } from "./data";
import { useCenterResource } from "./useCenterResource";
import { WindowControl } from "./PlayerCenter";
import CoverageNotice from "./CoverageNotice";

export type BrowserEntry = { identity: CenterIdentity; status?: string };
export type ResearchBrowserProps = { sport: CenterSport; season: number; slateId?: number | null; loader?: CenterLoader; fixture?: boolean;
  window?: CenterWindow; onWindowChange?: (window: CenterWindow) => void;
  entries?: BrowserEntry[]; search?: string; onSearch?: (search: string) => void; position?: string; onPosition?: (position: string) => void;
  positions?: string[]; hidePositionFilter?: boolean; onInspect: (identity: CenterIdentity) => void;
  onSelect?: (identity: CenterIdentity) => void; selectedId?: number | null; disabled?: boolean; extras?: ReactNode;
  comparison?: { selectedIds: number[]; onToggle: (identity: CenterIdentity) => void } };

export default function ResearchBrowser({ sport, season, slateId, loader = realCenterLoader, fixture = false, entries, search: controlledSearch, onSearch,
  position: controlledPosition, onPosition, positions, hidePositionFilter, onInspect, onSelect, selectedId, disabled = false, extras, comparison,
  window: controlledWindow, onWindowChange }: ResearchBrowserProps) {
  const [searchState, setSearch] = useState(""), [positionState, setPosition] = useState("All");
  const [windowState, setWindowState] = useState<CenterWindow>("last5"), [metric, setMetric] = useState("fantasy_points"), [ascending, setAscending] = useState(false);
  const window = controlledWindow ?? windowState, setWindow = onWindowChange ?? setWindowState;
  const search = controlledSearch ?? searchState, position = controlledPosition ?? positionState;
  const { groupContext } = useGroupContext(), scope = groupContext?.group.id ?? "none";
  const providerPosition = ["G", "F/C", "QB", "RB", "WR", "TE", "K", "D/ST"].includes(position) ? position : undefined;
  const batchContext = `${scope}:${sport}:${season}:${slateId}`;
  const [batch, setBatch] = useState<{ context: string; ids: number[]; attempted: number[] }>({ context: "", ids: [], attempted: [] });
  const activeBatch: { ids: number[]; attempted: number[] } = batch.context === batchContext ? batch : { ids: [], attempted: [] };
  const eligiblePlayerIds = entries?.map(entry => entry.identity.id).join(",");
  const playerIds = activeBatch.ids.join(",") || undefined;
  const requestMetric = metric === "name" ? "fantasy_points" : metric;
  const load = useCallback(async (signal: AbortSignal) => {
    const data = await loader.comparisons({ sport, season, slateId, window, metric: requestMetric, ascending, position: providerPosition, playerIds, eligiblePlayerIds }, signal);
    if (!Array.isArray(data.players) || !data.coverage) throw new Error("Comparison data is not available for this pool.");
    if (data.sport !== sport || data.season !== season || data.window !== window || data.metric !== requestMetric) throw new Error("Comparison context changed. Reopen player research.");
    if (!fixture && scope !== "none" && (data as ComparisonData & { groupId?: string }).groupId !== scope) throw new Error("The active Group changed. Reopen player research.");
    return data;
  }, [loader, sport, season, slateId, window, requestMetric, ascending, providerPosition, fixture, scope, playerIds, eligiblePlayerIds]);
  const { data, loading, error } = useCenterResource(`${scope}:${sport}:${season}:${slateId}:${window}:${requestMetric}:${ascending}:${providerPosition}:${playerIds}:${eligiblePlayerIds}`, load);
  const options = useMemo<string[]>(() => {
    if (sport === "nba") return draftSortStats(comparisonStats.nba);
    const keys = position === "FLEX" ? ["RB", "WR", "TE"] : position === "SF" ? ["QB", "RB", "WR", "TE"]
      : position in comparisonStats ? [position] : Object.keys(comparisonStats).filter(key => key !== "nba");
    return draftSortStats([...new Set(keys.flatMap(key => [...comparisonStats[key as keyof typeof comparisonStats]]))]);
  }, [sport, position]);
  const dataById = new Map(data?.players.map(row => [row.player.playerId, row]) ?? []);
  const sourceEntries: BrowserEntry[] = entries ?? (data?.players.map(row => ({ identity: { id: row.player.playerId, name: row.player.name, positionGroup: row.player.position,
    nbaPlayerId: sport === "nba" ? Number(row.player.nativePlayerId) || null : null, nflPlayerId: sport === "nfl" ? Number(row.player.nativePlayerId) || null : null } })) ?? []);
  // A draft may contain legacy/inactive rows outside the active comparison catalog.
  // Such rows must not silently disappear from the relevant ranking universe.
  const knownEntries = sourceEntries.every(entry => dataById.has(entry.identity.id));
  // A known short sample can be excluded from an otherwise certified ranking.
  // If we display its observed mean, sort it numerically and qualify the whole view.
  const canSort = metric === "name" || data?.coverage.canSort === true && knownEntries && sourceEntries.every(entry => {
    const row = dataById.get(entry.identity.id);
    return row?.observedAverage == null || row.rankableAverage != null;
  });
  const rows = sourceEntries.filter(row => (!search || row.identity.name.toLowerCase().includes(search.toLowerCase())) &&
    (entries !== undefined || position === "All" || row.identity.positionGroup === position)).sort((a, b) => {
    const left = dataById.get(a.identity.id), right = dataById.get(b.identity.id);
    const comparison = metric !== "name" ? compareActualStats(canSort ? left?.rankableAverage : left?.observedAverage, canSort ? right?.rankableAverage : right?.observedAverage, ascending) : 0;
    return comparison || a.identity.name.localeCompare(b.identity.name) * (metric === "name" && !ascending ? -1 : 1) || a.identity.id - b.identity.id;
  });
  const observedPlayers = rows.filter(entry => { const value = dataById.get(entry.identity.id)?.observedAverage; return value != null && Number.isFinite(value); }).length;
  const missing = rows.filter(entry => {
    const row = dataById.get(entry.identity.id);
    return !activeBatch.attempted.includes(entry.identity.id) && row?.player.identity === "resolved" && row.metricRelevant !== false && row.observedAverage == null;
  }).slice(0, 3).map(entry => entry.identity.id);
  const published = window === "season" && data?.players.some(row => row.summary.basis === "published_season");
  const selectedMetric = statLabels[metric] ?? "Player name";
  const coverageMetric = statLabels[requestMetric] ?? requestMetric;
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
    <div className="pc-sort-state" aria-live="polite"><strong>{metric === "name" ? `Player name · ${ascending ? "A–Z" : "Z–A"}` : canSort ? `${windowLabel[window]} · ${selectedMetric} / game · ${ascending ? "low to high" : "high to low"}` : observedPlayers ? `${published ? "Published season sorting · partial pool" : "Observed-data sorting"} · ${windowLabel[window]} · ${selectedMetric} / game · ${ascending ? "low to high" : "high to low"}` : "Alphabetical · statistical ranking unavailable"}</strong><span>{rows.length} players</span></div>
    {!fixture && <button type="button" className="pc-direction" disabled={loading || !missing.length} onClick={() => setBatch({ context: batchContext, ids: missing, attempted: [...activeBatch.attempted, ...missing] })}>{loading ? "Loading facts…" : `Load missing game stats (${missing.length})`}</button>}
    <p className="pc-footnote pc-observed-note">{published ? "Published season totals and provider GP supply season averages. Missing players or scoring inputs remain unavailable; partial coverage is not a complete ranking." : "Load missing stats for up to three shown players at a time; search or filter to choose players. Numerical sorts use available actual game data and may not represent complete league-wide rankings."}</p>
    <CoverageNotice summary={loading ? "Checking coverage…" : error ? "Comparison data unavailable" : metric === "name" ? "Player research coverage" : canSort ? "Complete-sample ranking coverage verified" : `${observedPlayers}/${rows.length} shown with ${published ? "published" : "observed"} values · full-pool ranking uncertified`}>
      <p>{error || `${observedPlayers}/${rows.length} shown players have ${published ? "published season" : "observed"} ${coverageMetric} values for ${data?.seasonLabel ?? season}. ${metric !== "name" && canSort ? "Complete-sample ranking coverage is verified for the selected metric and window." : "Available values are not a complete or certified league-wide ranking."}`}</p>
      <p>{data?.coverage.rankablePlayers ?? 0}/{data?.coverage.relevantPlayers ?? 0} source players have a certified complete sample for this metric and window.</p>
      {published && sport === "nfl" && requestMetric === "fantasy_points" && !canSort && <p>Complete NFL fantasy rankings require all scoring inputs, including total fumbles lost. The bulk feed omits total fumbles lost; missing fantasy scores stay unavailable.</p>}
      <p>Coverage can be incomplete because of missing games or fields, stale data or unresolved player identities.</p>
      {!knownEntries && <p>Some draft players have no verified comparison record.</p>}
      <p>Unavailable statistics stay blank, not zero, and sort last in either direction.</p>
    </CoverageNotice>
    <div className="pc-table-scroll" role="region" aria-label="Player research table; scroll for statistics" tabIndex={0}><table className="pc-table pc-pool-table"><thead><tr>
      <th className="pc-sticky">Player</th><th>Position</th><th>{windowLabel[window]}<small>{metric === "name" ? "FP / game" : `${selectedMetric} / game`}</small></th><th>Status</th>
    </tr></thead><tbody>{rows.map(entry => {
      const row = dataById.get(entry.identity.id), value = row?.observedAverage;
      return <tr key={entry.identity.id} data-selected={comparison ? comparison.selectedIds.includes(entry.identity.id) : selectedId === entry.identity.id}>
        <th className="pc-sticky" scope="row"><button type="button" className="draft-player-card pc-player-button" aria-label={`${comparison ? "Compare" : onSelect ? "Select" : "View"} ${entry.identity.name} player profile`} aria-pressed={comparison ? comparison.selectedIds.includes(entry.identity.id) : undefined} disabled={disabled} onClick={() => (comparison?.onToggle ?? onSelect ?? onInspect)(entry.identity)}>
          <PlayerHeadshot nbaPlayerId={entry.identity.nbaPlayerId} nflPlayerId={entry.identity.nflPlayerId} imageUrl={entry.identity.headshotUrl} playerName={entry.identity.name} size="sm" />
          <span>{entry.identity.name}<small>{entry.identity.teamAbbreviation ?? "Player profile"}</small></span></button></th>
        <td>{entry.identity.positionGroup ?? "—"}</td><td className="pc-fp">{formatStat(value)}{row?.metricRelevant === false && <small>Not applicable</small>}</td>
        <td><span className="pc-status">{entry.status ?? (!row ? "Statistics unavailable" : row.player.identity !== "resolved" ? "Mapping unavailable" : row.summary.availableGames ? "Observed games" : "No verified games")}</span>{row?.coverage.freshness === "stale" && <small>Statistics stale</small>}{row?.coverage.freshness === "unavailable" && <small>Statistics unavailable</small>}</td>
      </tr>;
    })}</tbody></table></div>
    {!rows.length && <div className="pc-empty"><strong>{loading ? "Loading player catalog…" : "No players to display"}</strong><p>{error || "Try another search or position. Missing coverage will not be replaced with projections."}</p></div>}
    <p className="pc-footnote">{windowLabel[window]} averages use {published ? "published season totals / GP" : "actual appearances"} in {data?.seasonLabel ?? season}. — means unavailable.{data?.asOf && <> Cutoff {new Date(data.asOf).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}.</>}</p>
  </section>;
}
