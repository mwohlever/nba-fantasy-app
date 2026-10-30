"use client";

import { useCallback, useId, useState } from "react";
import PlayerHeadshot from "@/components/ui/PlayerHeadshot";
import { useGroupContext } from "@/components/providers/GroupProvider";
import { professionalSeason, seasonLabel, type CenterSport, type CenterWindow } from "@/lib/player-center/types";
import { formatStat, gameCell, gameColumns, gameIdentifier, gameStatus, statLabels, venueLabel, windowLabel, type CenterIdentity } from "@/lib/player-center/display";
import type { CenterProfile } from "@/lib/player-center/presentation";
import { realCenterLoader, type CenterLoader } from "./data";
import { useCenterResource } from "./useCenterResource";
import SeasonStats from "./SeasonStats";
import FantasyStats from "./FantasyStats";
import CoverageNotice from "./CoverageNotice";

export type PlayerCenterProps = { identity: CenterIdentity; sport: CenterSport; season?: number; slateId?: number | null;
  loader?: CenterLoader; fixture?: boolean; expanded?: boolean };
const date = (value: string) => new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
function average(profile: CenterProfile, window: CenterWindow, key: string) {
  const summary = profile.windows[window];
  return summary?.metricComparable[key] ? summary.averages[key] : null;
}

export default function PlayerCenter(props: PlayerCenterProps) {
  return <PlayerCenterBody key={`${props.sport}:${props.identity.id}:${props.season ?? "current"}`} {...props} />;
}

function PlayerCenterBody({ identity, sport, season: initialSeason, slateId, loader = realCenterLoader, fixture = false, expanded = false }: PlayerCenterProps) {
  const panelId = useId();
  const current = professionalSeason(sport), [season, setSeason] = useState(initialSeason ?? current);
  const [tab, setTab] = useState<"log" | "season" | "fantasy">("log"), [window, setWindow] = useState<CenterWindow>("season");
  const [revision, setRevision] = useState(0), [showAll, setShowAll] = useState(expanded);
  const { groupContext } = useGroupContext();
  const scope = groupContext?.group.id ?? "none";
  const key = `${scope}:${sport}:${identity.id}:${season}:${slateId ?? "league"}:${revision}`;
  const load = useCallback(async (signal: AbortSignal) => {
    const profile = await loader.profile({ sport, playerId: identity.id, season, slateId }, signal);
    if (profile.player.playerId !== identity.id || profile.player.sport !== sport || profile.season !== season) throw new Error("The statistics returned for a different player or season.");
    const responseScope = profile as CenterProfile & { groupId?: string };
    if (!fixture && scope !== "none" && responseScope.groupId !== scope) throw new Error("Your Group changed. Reopen this player profile.");
    return profile;
  }, [loader, sport, identity.id, season, slateId, fixture, scope]);
  const { data, loading, error } = useCenterResource(key, load);
  const cutoff = Date.parse(data?.asOf ?? new Date().toISOString());
  const games = [...(data?.games ?? [])].sort((a, b) => {
    const futureA = Date.parse(a.gameAt) > cutoff, futureB = Date.parse(b.gameAt) > cutoff;
    if (futureA !== futureB) return futureA ? 1 : -1;
    return futureA ? a.gameAt.localeCompare(b.gameAt) : b.gameAt.localeCompare(a.gameAt);
  });
  const completed = games.filter(g => g.status === "final" && g.participation === "played" && Date.parse(g.gameAt) <= cutoff);
  const latest = completed[0], position = data?.player.position ?? identity.positionGroup ?? "";
  const columns = gameColumns(sport, position), summary = data?.windows[window];
  const basis = data?.scoringBasis === "slate_snapshot" ? "Frozen slate scoring" : data?.scoringBasis === "legacy_defaults" ? "Legacy default scoring" : "Current Group scoring";
  const team = latest?.team ?? identity.teamAbbreviation;
  const years = [...new Set([current, current - 1, current - 2, initialSeason ?? current])].sort((a, b) => b - a);
  const coverage = data?.coverage;
  const nativeId = data?.player.nativePlayerId ? Number(data.player.nativePlayerId) : null;
  const needed = window === "last5" ? 5 : window === "last3" ? 3 : window === "last1" ? 1 : null;
  const metrics = sport === "nba" ? ["points", "rebounds", "assists", "minutes"] : position === "K" ? ["field_goals_made", "field_goals_attempted", "extra_points_made", "kicking_points"]
    : position === "D/ST" ? ["sacks", "interceptions", "pointsAllowed", "yardsAllowed"] : position === "QB" ? ["passing_yards", "passing_tds", "rushing_yards", "fumbles_lost"] : ["receptions", "receiving_yards", "rushing_yards", "receiving_tds"];
  const reason = fixture && coverage?.issues.includes("season_not_in_fixture_capture") ? "This season was not included in the fixture capture. Choose a captured season to inspect its verified statistics."
    : fixture && coverage?.issues.includes("simulated_missing_data_QA_scenario") ? "Simulated missing-data QA scenario. Restore captured data above to inspect the verified games."
    : data?.player.identity !== "resolved" ? "A verified provider mapping is not available for this player."
    : coverage?.kind === "unavailable" ? "The provider did not return a usable game log."
      : "No verified appearances were returned for this season. Missing rows do not establish DNP or zero production.";

  return <article className="pc pc-profile" data-sport={sport} aria-label={`${identity.name} statistics`}>
    {fixture && <div className="pc-fixture">VERIFIED FIXTURE PREVIEW · captured data · no live draft or production writes</div>}
    <header className="pc-header">
      <div className="pc-identity">
        <PlayerHeadshot nbaPlayerId={identity.nbaPlayerId ?? (sport === "nba" ? nativeId : null)} nflPlayerId={identity.nflPlayerId ?? (sport === "nfl" ? nativeId : null)} imageUrl={identity.headshotUrl} playerName={data?.player.name ?? identity.name} size="xl" className="pc-headshot" />
        <div className="pc-name"><span className="pc-eyebrow">{sport.toUpperCase()} · PLAYER CENTER</span><h2>{data?.player.name ?? identity.name}</h2>
          <p>{[team, position, identity.jerseyNumber ? `#${identity.jerseyNumber}` : null].filter(Boolean).join(" · ") || sport.toUpperCase()}</p>
          {latest && <p className="pc-recent">Last game · {metrics.slice(0, 3).map(metric => `${formatStat(latest.stats[metric])} ${statLabels[metric] ?? metric}`).join(" · ")}</p>}
        </div>
      </div>
      <div className="pc-season-control"><label>Season<select aria-label="Profile season" value={season} onChange={e => { setSeason(Number(e.target.value)); setWindow("season"); }}>
        {years.map(year => <option key={year} value={year}>{seasonLabel(sport, year)}</option>)}</select></label><span>Regular season</span></div>
    </header>
    <div className="pc-summary" aria-label="Actual performance summary">
      <div><span>Last game FP</span><strong>{latest && data ? formatStat(data.gameFantasyPoints[latest.eventId]) : "—"}</strong><small>{latest ? `${date(latest.gameAt)} ${venueLabel(latest)} ${latest.opponent ?? "Opponent unavailable"}` : "Completed games only"}</small></div>
      <div><span>{windowLabel[window]} FP / game</span><strong>{data ? formatStat(average(data, window, "fantasy_points")) : "—"}</strong><small>{summary ? `${summary.sampleSize} completed · ${position === "K" ? "Scoring not configured" : needed && summary.sampleSize < needed && data?.windows.season.seasonVerified ? `Need ${needed} games` : summary.metricComparable.fantasy_points ? "verified average" : "Coverage incomplete"}` : "Actual fantasy scoring"}</small></div>
      <div><span>Games observed</span><strong>{data ? completed.length : "—"}<em>{coverage?.expectedGames != null ? ` / ${coverage.expectedGames}` : ""}</em></strong><small>{data ? coverage?.expectedGames == null ? "Season GP unverified" : coverage.kind === "team_schedule" ? "Final team games" : "Independent provider GP" : "Season appearances"}</small></div>
    </div>
    <div className="pc-tabs" role="tablist" aria-label="Player statistics sections">
      {([["log", "Game log"], ["season", "Season stats"], ["fantasy", "Fantasy"]] as const).map(([value, label]) => <button key={value} role="tab" tabIndex={tab === value ? 0 : -1} aria-selected={tab === value} aria-controls={`${panelId}-panel`} id={`${panelId}-${value}`} onClick={() => setTab(value)} onKeyDown={event => {
        const tabs = ["log", "season", "fantasy"] as const;
        const next = event.key === "ArrowRight" ? tabs[(tabs.indexOf(value) + 1) % 3] : event.key === "ArrowLeft" ? tabs[(tabs.indexOf(value) + 2) % 3] : event.key === "Home" ? "log" : event.key === "End" ? "fantasy" : null;
        if (next) { event.preventDefault(); setTab(next); document.getElementById(`${panelId}-${next}`)?.focus(); }
      }}>{label}</button>)}
    </div>
    <div className="pc-panel" role="tabpanel" id={`${panelId}-panel`} aria-labelledby={`${panelId}-${tab}`}>
      {loading ? <div className="pc-loading" role="status"><span /><span /><span />Loading verified statistics…</div> : error ? <div className="pc-empty" role="alert"><strong>Statistics unavailable</strong><p>{error}</p><button onClick={() => setRevision(v => v + 1)}>Try again</button></div> : data ? <>
        <div className="pc-source"><span className={`pc-dot pc-dot-${coverage?.freshness}`} />{fixture ? "Captured ESPN fixture" : "ESPN"} · {seasonLabel(sport, season)} · {coverage?.freshness === "fresh" ? "Fetched" : coverage?.freshness === "stale" ? "Stale data · fetched" : "Source unavailable"} {coverage?.fetchedAt ? new Date(coverage.fetchedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "time unknown"}</div>
        {(coverage?.freshness !== "fresh" || !data.windows.season.seasonVerified || data.coverage.issues.length > 0) && <CoverageNotice summary={coverage?.freshness === "unavailable" ? "Statistics unavailable" : coverage?.freshness === "stale" ? "Statistics stale" : !data.windows.season.seasonVerified ? "Season coverage unverified" : "Some game statistics incomplete"}>
          <p>Only verified values are shown. Incomplete windows have no comparison average; missing statistics stay unavailable.</p>
          {data.coverage.issues.length > 0 && <ul>{data.coverage.issues.map(issue => <li key={issue}>{issue.replaceAll("_", " ")}</li>)}</ul>}
        </CoverageNotice>}
        {tab === "log" && <>
          <WindowControl value={window} onChange={setWindow} />
          <div className="pc-metrics">{metrics.map(metric => <div key={metric}><span>{statLabels[metric]}</span><strong>{formatStat(average(data, window, metric))}</strong><small>{windowLabel[window]} / game · n={summary?.metricSamples[metric] ?? 0}</small></div>)}</div>
          <div className="pc-section-title"><h3>Game log</h3><span>{completed.length} completed · recent games first</span></div>
          {games.length ? <div className="pc-table-scroll" tabIndex={0} role="region" aria-label="Player game log; scroll horizontally for all statistics"><table className="pc-table pc-game-log"><thead><tr><th className="pc-sticky">Game / opponent</th><th>Status</th><th>FP</th>{columns.map(key => <th key={key}>{statLabels[key] ?? key}</th>)}</tr></thead><tbody>
            {(showAll ? games : games.slice(0, 10)).map(game => <tr key={game.eventId} data-game-status={gameStatus(game)}><th scope="row" className="pc-sticky"><span className="pc-game-identifier">{gameIdentifier(game, sport)}</span></th>
              <td><span className={`pc-status pc-status-${game.status}`}>{gameStatus(game)}</span></td><td className="pc-fp">{formatStat(data.gameFantasyPoints[game.eventId])}{game.status === "final" && game.participation === "played" && data.gameFantasyPoints[game.eventId] == null && position !== "K" && <small>Incomplete</small>}</td>
              {columns.map(key => <td key={key}>{game.participation === "dnp" ? "—" : gameCell(game, key)}</td>)}</tr>)}
          </tbody></table></div> : <div className="pc-empty"><strong>Game log unavailable</strong><p>{reason}</p></div>}
          {games.length > 10 && <button className="pc-text-button" onClick={() => setShowAll(v => !v)}>{showAll ? "Show recent 10 games" : `View all ${games.length} games`}</button>}
          {games.some(game => Date.parse(game.gameAt) > cutoff) && <p className="pc-footnote">Upcoming games follow the observed game log, nearest date first. They have no actual fantasy score.</p>}
          {data.byeWeeks && <p className="pc-footnote">Verified bye {data.byeWeeks.length > 1 ? "weeks" : "week"}: {data.byeWeeks.join(", ")}. Bye weeks have no player-game fantasy score.</p>}
          <p className="pc-footnote">DNP appears only with explicit provider evidence. Missing appearances may be inactive, unavailable, or absent provider data.</p>
        </>}
        {tab === "season" && <SeasonStats stats={data.seasonStats} sport={sport} position={position} season={season} />}
        {tab === "fantasy" && <FantasyStats key={`${scope}:${sport}:${identity.id}:${season}`} profile={data} position={position} basis={basis} />}
      </> : null}
    </div>
  </article>;
}

export function WindowControl({ value, onChange }: { value: CenterWindow; onChange: (value: CenterWindow) => void }) {
  return <div className="pc-window" aria-label="Observation window">{(["last1", "last3", "last5", "season"] as const).map(window => <button key={window} type="button" aria-pressed={value === window} onClick={() => onChange(window)}>{windowLabel[window]}</button>)}</div>;
}
