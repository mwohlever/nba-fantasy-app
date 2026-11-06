"use client";
import { useCallback, useState } from "react";
import { useGroupContext } from "@/components/providers/GroupProvider";
import PlayerHeadshot from "@/components/ui/PlayerHeadshot";
import { getStatColumns } from "@/lib/statColumns";
import { leagueHistoryHref, type LeagueSeason } from "@/lib/player-center/modalContext";
import type { CenterSport } from "@/lib/player-center/types";
import type { CenterIdentity } from "@/lib/player-center/display";
import { useCenterResource } from "./useCenterResource";

type LeagueProfile = {
  sport: CenterSport; scope: { groupId: string; leagueId: string }; selectedSeason: LeagueSeason;
  player: { id: number; name: string };
  summary: {
    timesDrafted: number; wins: number; runnerUps: number; winRate: number | null;
    averageFantasyPoints: number | null; bestFantasyPoints: number | null; worstFantasyPoints: number | null; averageFinish: number | null;
    draftedMostBy: { teamName: string; count: number } | null;
    draftedByBreakdown: { teamName: string; count: number }[];
  };
  recentHistory: { slateId?: number; slateLabel: string; teamName: string; finishPosition: number | null; fantasyPoints: number | null; stats: Record<string, number | null> }[];
};
function fmt(value: number | null | undefined, digits = 1) { return value != null && Number.isFinite(value) ? value.toFixed(digits) : "—"; }
function ordinal(value: number | null) {
  if (value == null) return "—";
  const last = value % 100;
  return `${value}${last >= 11 && last <= 13 ? "th" : ["th", "st", "nd", "rd"][value % 10] ?? "th"}`;
}

/** Saved, Group-scoped league outcomes. No professional-game rescoring or forecast fields. */
export default function PlayerLeagueHistory({ identity, sport, initialSeason }: { identity: CenterIdentity; sport: CenterSport; initialSeason: LeagueSeason }) {
  const [season, setSeason] = useState<LeagueSeason>(initialSeason);
  const { groupContext, isSwitchingGroup, isLoading } = useGroupContext();
  const groupId = groupContext?.group.id, leagueId = groupContext?.leagues.find(league => league.sportKey === sport && league.isEnabled)?.id;
  const load = useCallback(async (signal: AbortSignal): Promise<LeagueProfile> => {
    if (!groupId || !leagueId || isSwitchingGroup || isLoading) throw new Error("Select an enabled Group to view league history.");
    const params = new URLSearchParams({ sport, season: String(season), playerId: String(identity.id) });
    const response = await fetch(`/api/player-league-profile?${params}`, { cache: "no-store", signal });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "111 Sports history is unavailable.");
    if (result.sport !== sport || result.scope?.groupId !== groupId || result.scope?.leagueId !== leagueId ||
      result.player?.id !== identity.id || String(result.selectedSeason) !== String(season) ||
      !result.summary || !Array.isArray(result.summary.draftedByBreakdown) || !Array.isArray(result.recentHistory)) {
      throw new Error("League history does not match the requested player, Group, sport, or season.");
    }
    return result;
  }, [sport, season, identity.id, groupId, leagueId, isSwitchingGroup, isLoading]);
  const { data, error, loading } = useCenterResource(`${groupId}:${leagueId}:${sport}:${identity.id}:${season}:${isSwitchingGroup}:${isLoading}`, load);
  const summary = data?.summary;
  const owners = [...(summary?.draftedByBreakdown ?? [])].sort((a, b) => b.count - a.count);
  const maximum = Math.max(1, ...owners.map(row => row.count));
  const year = new Date().getUTCFullYear();
  const years = [...new Set([year, year - 1, year - 2, year - 3, ...(typeof initialSeason === "number" ? [initialSeason] : [])])].sort((a, b) => b - a);
  return <article className="pc-panel" aria-label={`${identity.name} 111 Sports league history`}>
    <header className="pc-section-title"><div className="flex items-center gap-3">
      <PlayerHeadshot nbaPlayerId={identity.nbaPlayerId} nflPlayerId={identity.nflPlayerId} imageUrl={identity.headshotUrl} playerName={identity.name} size="md" />
      <div className="pc-name"><span className="pc-eyebrow">111 SPORTS · {sport.toUpperCase()} LEAGUE HISTORY</span><h2>{data?.player.name ?? identity.name}</h2></div>
    </div><label>League season<select aria-label="League history season" value={season} onChange={event => setSeason(event.target.value === "all" ? "all" : Number(event.target.value))}>
      {years.map(value => <option key={value} value={value}>{value}</option>)}<option value="all">All-Time</option>
    </select></label></header>
    <p className="pc-footnote">Saved fantasy results and ownership in this Group. League seasons are independent of professional NBA/NFL seasons. Historical scores retain their saved slate results.</p>
    <p className="my-3"><a className="pc-text-button" href={leagueHistoryHref(sport, season, identity.id)}>111 Sports draft history →</a></p>
    {loading ? <p role="status">Loading 111 Sports history…</p> : error ? <p role="alert">{error}</p> : data && summary ? <div className="space-y-5">
      <section aria-label="League performance résumé"><div className="player-modal-section-heading"><div><div className="player-modal-section-kicker">Performance résumé</div><h3>{season === "all" ? "All-Time" : season} League Snapshot</h3></div></div>
        <div className="player-modal-resume">{([
          ["Drafted", fmt(summary.timesDrafted, 0)], ["Wins", fmt(summary.wins, 0)], ["Runner-Ups", fmt(summary.runnerUps, 0)],
          ["Win rate", summary.winRate == null ? "—" : `${fmt(summary.winRate)}%`], ["Avg FP", fmt(summary.averageFantasyPoints)],
        ] as const).map(([name, value]) => <div key={name}><span>{name}</span><strong>{value}</strong></div>)}</div>
      </section>
      <section><div className="player-modal-section-heading"><div><div className="player-modal-section-kicker">Recent league results</div><h3>Recent Drafts</h3></div><span>Swipe →</span></div>
        {!data.recentHistory.length ? <p className="player-modal-empty">No draft history for this view.</p> : <div className="player-modal-history-strip">
          {data.recentHistory.map((row, index) => <article key={`${row.slateId}-${index}`} className={`player-modal-history-card${row.finishPosition === 1 ? " player-modal-history-card--winner" : ""}`}>
            <div className="player-modal-history-date">{row.slateLabel}</div><div className="player-modal-history-score">{fmt(row.fantasyPoints)}<span>FP</span></div>
            <div className="player-modal-history-result"><strong>{ordinal(row.finishPosition)}</strong><span>{row.teamName}</span></div>
            <div className="mt-4 grid grid-cols-3 gap-3 border-t pt-4">{getStatColumns(sport).map(column => <div key={column.key}><span className="block text-xs">{column.label}</span><strong>{fmt(row.stats[column.key])}</strong></div>)}</div>
          </article>)}
        </div>}
      </section>
      <section><div className="player-modal-section-heading"><div><div className="player-modal-section-kicker">Ownership history</div><h3>Drafted By</h3></div></div>
        {!owners.length ? <p className="player-modal-empty">No ownership history yet.</p> : <div className="player-modal-ownership">{owners.map(row => <div key={row.teamName} className="player-modal-owner-row">
          <div className="player-modal-owner-label"><span>{row.teamName}</span><strong>{row.count}</strong></div><div className="player-modal-owner-track"><div style={{ width: `${row.count / maximum * 100}%` }} /></div>
        </div>)}</div>}
      </section>
      <details className="player-modal-details"><summary>More career numbers · 111 Sports league results</summary><div className="player-modal-projection-grid">{([
        ["Average", fmt(summary.averageFantasyPoints)], ["Best", fmt(summary.bestFantasyPoints)], ["Worst", fmt(summary.worstFantasyPoints)],
        ["Avg finish", fmt(summary.averageFinish)], ["Most drafted by", summary.draftedMostBy?.teamName ?? "—"], ["Most-owner drafts", fmt(summary.draftedMostBy?.count, 0)],
      ] as const).map(([name, value]) => <div key={name}><span>{name}</span><strong>{value}</strong></div>)}</div></details>
    </div> : null}
  </article>;
}
