"use client";

import { useEffect, useMemo } from "react";
import AppNav from "@/components/AppNav";
import type { NbaLiveGame } from "@/lib/providers/nbaLiveScores";
import { nbaDateKey, shiftNbaDate } from "@/lib/live-scores/nbaDate";
import { nbaLiveContextQuery, type NbaLiveContext } from "@/lib/live-scores/nbaContext";
import { useNbaLiveUrl } from "@/lib/live-scores/useNbaLiveUrl";
import { useLiveRequest } from "@/lib/live-scores/useLiveRequest";
import { useNbaLiveScope } from "@/lib/live-scores/useNbaLiveScope";
import NbaGameCenter from "./NbaGameCenter";
import LiveViewSelector from "./LiveViewSelector";
import StandingsPanel from "./StandingsPanel";

const EMPTY_GAMES: NbaLiveGame[] = [];
const line = (game: NbaLiveGame) => { const odds = game.odds; if (!odds) return null; const favorite = odds.favoriteTeamId === game.awayTeam.id ? game.awayTeam.abbreviation : odds.favoriteTeamId === game.homeTeam.id ? game.homeTeam.abbreviation : null; return [favorite && odds.spread !== null ? `${favorite} ${odds.spread}` : "", odds.overUnder !== null ? `O/U ${odds.overUnder}` : ""].filter(Boolean).join(" · ") || null; };

export default function NbaLiveScores({ context = "nba", viewerId }: { context?: NbaLiveContext; viewerId: string }) {
  const scope = useNbaLiveScope(context, viewerId);
  const live = useNbaLiveUrl(context, JSON.stringify(scope));
  const { state } = live;
  const selectedDate = state.date;
  const ready = Boolean(scope && live.routeMatches && state.view === "games");
  const dateKey = selectedDate ? nbaDateKey(selectedDate) : null;
  const url = ready && scope && dateKey ? `/api/live-scores/nba/scores?date=${dateKey}${nbaLiveContextQuery(context)}&groupId=${encodeURIComponent(scope.groupId)}&leagueId=${encodeURIComponent(scope.leagueId)}&viewerId=${encodeURIComponent(viewerId)}` : null;
  const request = useLiveRequest<{ games: NbaLiveGame[] }>(ready && scope ? { ...scope, resource: selectedDate! } : null, url);
  const games = request.data?.games ?? EMPTY_GAMES;
  const load = request.refresh;
  const hasLive = games.some(game => game.status === "in");
  useEffect(() => { if (!hasLive) return; const interval = window.setInterval(() => void load(), 30000); return () => window.clearInterval(interval); }, [hasLive, load]);
  useEffect(() => {
    if (state.view !== "games") return;
    const refreshOnFocus = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", refreshOnFocus);
    return () => document.removeEventListener("visibilitychange", refreshOnFocus);
  }, [load, state.view]);
  const ordered = useMemo(() => [...games].sort((a, b) => ({ in: 0, pre: 1, post: 2 }[a.status] ?? 1) - ({ in: 0, pre: 1, post: 2 }[b.status] ?? 1) || Date.parse(a.startAt) - Date.parse(b.startAt)), [games]);
  const move = (days: number) => { const date = selectedDate && shiftNbaDate(selectedDate, days); if (date) live.selectDate(date); };
  return <main className="nba-live-page min-h-screen bg-slate-50 px-3 py-5 pb-24 text-slate-900 sm:px-4 sm:py-6 sm:pb-6"><div className="mx-auto max-w-5xl space-y-4"><AppNav />
    {!live.routeMatches ? null : state.view === "detail" ? <NbaGameCenter key={`${viewerId}:${scope?.groupId}:${scope?.leagueId}:${context}:${state.gameId}`} viewerId={viewerId} context={context} eventId={state.gameId} tab={state.tab} onTabChange={live.selectTab} onBack={live.backToGames} onEventDate={live.resolveEventDate}/> : <>
      <LiveViewSelector value={state.view} onChange={live.selectView} />
      {state.view === "standings" ? <><h1 className="text-2xl font-black">{context === "nba-skins" ? "NBA Skins Live" : "NBA Live"}</h1><StandingsPanel sport="nba" scope={scope} selection={state.standingsView} onChange={live.selectStandings} /></> : <>
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-end justify-between gap-3"><div><p className="text-[10px] font-black uppercase tracking-[0.18em] text-sky-600">{context === "nba-skins" ? "NBA Skins" : "NBA"}</p><h1 className="mt-1 text-2xl font-black tracking-tight">Live</h1><p className="mt-1 text-sm text-slate-500">Real-world NBA scores, game action, and box scores.</p></div><button type="button" onClick={() => void load()} disabled={!ready || request.refreshing} className="text-xl text-slate-500 disabled:opacity-40" aria-label="Refresh NBA scores">↻</button></div><div className="mt-4 flex items-center justify-between rounded-xl bg-slate-50 p-1"><button type="button" onClick={() => move(-1)} className="rounded-lg px-3 py-2 text-sm font-bold text-slate-600" aria-label="Previous day">←</button><input type="date" aria-label="NBA schedule date" value={state.date} onChange={event => live.selectDate(event.target.value)} className="min-w-0 bg-transparent px-2 py-2 text-center text-sm font-black text-slate-800" /><button type="button" onClick={() => move(1)} className="rounded-lg px-3 py-2 text-sm font-bold text-slate-600" aria-label="Next day">→</button></div></section>
      {!ready || request.loading ? <p className="py-8 text-center text-sm text-slate-500">Loading NBA games…</p> : request.error ? <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{request.error}</p> : ordered.length ? <section className="space-y-2">{ordered.map(game => <GameCard key={game.espnEventId} game={game} onClick={() => live.openGame(game.espnEventId)} />)}</section> : <p className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">No NBA games scheduled for this date.</p>}
    </>}
    </>}
  </div></main>;
}
function GameCard({ game, onClick }: { game: NbaLiveGame; onClick: () => void }) { const started = game.status !== "pre"; return <button type="button" onClick={onClick} className={`w-full rounded-xl border bg-white px-3 py-2.5 text-left shadow-sm ${game.status === "in" ? "border-sky-400 ring-1 ring-sky-400/20" : "border-slate-200"}`}><TeamRow team={game.awayTeam} started={started} /><TeamRow team={game.homeTeam} started={started} /><div className="mt-2 flex justify-between gap-3 border-t border-slate-100 pt-2 text-[11px]"><span className={game.status === "in" ? "font-black text-sky-600" : "font-semibold text-slate-500"}>{game.status === "pre" ? new Date(game.startAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : game.statusDetail || (game.completed ? "Final" : "Live")}{game.broadcast?.network ? ` · ${game.broadcast.network}` : ""}</span>{line(game) ? <span className="text-right text-slate-500">{line(game)}</span> : null}</div></button>; }
function TeamRow({ team, started }: { team: NbaLiveGame["awayTeam"]; started: boolean }) { return <div className="flex items-center gap-2 py-0.5"><div className="flex h-7 w-7 items-center justify-center">{team.logo ? <img src={team.logo} alt="" className="max-h-7 max-w-7 object-contain" /> : null}</div><div className="min-w-0 flex-1"><p className={`truncate text-sm ${team.winner ? "font-black" : "font-bold"}`}>{team.displayName}</p>{team.record ? <p className="text-[11px] text-slate-500">{team.record}</p> : null}</div>{started ? <span className={`w-9 text-right text-lg tabular-nums ${team.winner ? "font-black" : "font-bold text-slate-600"}`}>{team.score ?? "—"}</span> : null}</div>; }
