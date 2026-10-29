"use client";
import { useEffect, useState } from "react";
import AppNav from "@/components/AppNav";
import { professionalSeason, seasonLabel, type CenterSport } from "@/lib/player-center/types";
import type { CenterIdentity } from "@/lib/player-center/display";
import ResearchBrowser from "./ResearchBrowser";
import PlayerCenter from "./PlayerCenter";

export default function PlayerHistoryCenter({ sport, onLeagueHistory }: { sport: CenterSport; onLeagueHistory: () => void }) {
  const current = professionalSeason(sport), [season, setSeason] = useState(current);
  const [player, setPlayer] = useState<CenterIdentity | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("sport") && params.get("sport") !== sport) return;
    const id = Number(params.get("playerId"));
    if (Number.isInteger(id) && id > 0) {
      // The authenticated profile endpoint resolves the exact local row, never a name match.
      queueMicrotask(() => setPlayer({ id, name: "Player profile" }));
    }
  }, [sport]);
  const inspect = (identity: CenterIdentity) => {
    setPlayer(identity);
    const url = new URL(window.location.href);
    url.searchParams.set("playerId", String(identity.id));
    window.history.replaceState(window.history.state, "", url);
  };
  return <main className="pc-history-page"><AppNav />
    <header className="pc pc-page-heading" data-sport={sport}><div><span className="pc-eyebrow">111 SPORTS · {sport.toUpperCase()}</span><h1>Player Center</h1><p>Real games. Clear samples. Your scoring rules.</p></div>
      <button className="pc-text-button" onClick={onLeagueHistory}>111 Sports draft history</button></header>
    <div className="pc-history-layout" data-profile-open={!!player}><aside className="pc-history-list"><div className="pc pc-history-season"><label>Research season<select aria-label="Research season" value={season} onChange={e => setSeason(Number(e.target.value))}>{[current, current - 1, current - 2].map(year => <option key={year} value={year}>{seasonLabel(sport, year)}</option>)}</select></label></div>
      <ResearchBrowser sport={sport} season={season} onInspect={inspect} selectedId={player?.id} /></aside>
      <section className="pc-history-detail">{player ? <><button className="pc pc-text-button" onClick={() => { setPlayer(null); const url = new URL(window.location.href); url.searchParams.delete("playerId"); window.history.replaceState(window.history.state, "", url); }}>← Back to players</button><PlayerCenter identity={player} sport={sport} season={season} expanded /></> : <div className="pc pc-empty pc-history-welcome"><span className="pc-eyebrow">PLAYER RESEARCH</span><h2>Get to know your next pick</h2><p>Select a player to explore actual game logs, season statistics, and fantasy scoring. Incomplete coverage stays visible.</p></div>}</section>
    </div>
  </main>;
}
