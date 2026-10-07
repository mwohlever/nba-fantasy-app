"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
const EMPTY_FAVORITES = new Set<string>();
const line = (game: NbaLiveGame) => { const odds = game.odds; if (!odds) return null; const favorite = odds.favoriteTeamId === game.awayTeam.id ? game.awayTeam.abbreviation : odds.favoriteTeamId === game.homeTeam.id ? game.homeTeam.abbreviation : null; return [favorite && odds.spread !== null ? `${favorite} ${odds.spread}` : "", odds.overUnder !== null ? `O/U ${odds.overUnder}` : ""].filter(Boolean).join(" · ") || null; };

export default function NbaLiveScores({ context = "nba", viewerId }: { context?: NbaLiveContext; viewerId: string }) {
  const scope = useNbaLiveScope(context, viewerId);
  const live = useNbaLiveUrl(context, JSON.stringify(scope));
  const { state } = live;
  const selectedDate = state.date;
  const ready = Boolean(scope && live.routeMatches && state.view === "games");
  // Favorites belong to the authenticated user and real NBA teams, across both app contexts.
  const [favorites, setFavorites] = useState<{ viewerId: string; ids: Set<string> } | null>(null);
  const favoriteTeamIds = favorites?.viewerId === viewerId ? favorites.ids : EMPTY_FAVORITES;
  const [favoritesLoading, setFavoritesLoading] = useState(true);
  const [favoriteError, setFavoriteError] = useState("");
  const favoriteSession = useRef(0);
  const pendingFavorites = useRef(new Set<string>());
  const [pendingTeamIds, setPendingTeamIds] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    if (!ready) return;
    const session = ++favoriteSession.current;
    pendingFavorites.current.clear();
    setPendingTeamIds(new Set());
    setFavoritesLoading(true);
    setFavoriteError("");
    async function loadFavorites() {
      try {
        const response = await fetch("/api/live-scores/nba/favorites", { cache: "no-store" });
        if (!response.ok) throw new Error("Favorites are unavailable.");
        const data = await response.json() as { teamIds?: string[] };
        if (favoriteSession.current === session) setFavorites({ viewerId, ids: new Set(data.teamIds ?? []) });
      } catch {
        if (favoriteSession.current === session) setFavoriteError("Favorites are currently unavailable. Scores still work.");
      } finally {
        if (favoriteSession.current === session) setFavoritesLoading(false);
      }
    }
    void loadFavorites();
    return () => { ++favoriteSession.current; };
  }, [ready, viewerId]);
  async function toggleFavorite(teamId: string) {
    if (favoritesLoading || pendingFavorites.current.has(teamId)) return;
    const session = favoriteSession.current;
    const wasFavorite = favoriteTeamIds.has(teamId);
    pendingFavorites.current.add(teamId);
    setPendingTeamIds(current => new Set(current).add(teamId));
    setFavoriteError("");
    const update = (favorite: boolean) => setFavorites(current => {
      const ids = new Set(current?.viewerId === viewerId ? current.ids : []);
      if (favorite) ids.add(teamId); else ids.delete(teamId);
      return { viewerId, ids };
    });
    update(!wasFavorite);
    try {
      const response = await fetch("/api/live-scores/nba/favorites", {
        method: wasFavorite ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId }),
      });
      if (!response.ok) throw new Error("Unable to update favorite team.");
    } catch {
      if (favoriteSession.current === session) {
        update(wasFavorite);
        setFavoriteError("Favorite could not be saved. Please try again.");
      }
    } finally {
      if (favoriteSession.current === session) {
        pendingFavorites.current.delete(teamId);
        setPendingTeamIds(current => { const next = new Set(current); next.delete(teamId); return next; });
      }
    }
  }
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
  const favoriteGames = ordered.filter(game => favoriteTeamIds.has(game.awayTeam.id) || favoriteTeamIds.has(game.homeTeam.id));
  const card = (game: NbaLiveGame) => <GameCard key={game.espnEventId} game={game} favoriteTeamIds={favoriteTeamIds} favoritesLoading={favoritesLoading} pendingTeamIds={pendingTeamIds} onToggleFavorite={toggleFavorite} onClick={() => live.openGame(game.espnEventId)} />;
  const move = (days: number) => { const date = selectedDate && shiftNbaDate(selectedDate, days); if (date) live.selectDate(date); };
  return <main className="nba-live-page min-h-screen bg-slate-50 px-3 py-5 pb-24 text-slate-900 sm:px-4 sm:py-6 sm:pb-6"><div className="mx-auto max-w-5xl space-y-4"><AppNav />
    {!live.routeMatches ? null : state.view === "detail" ? <NbaGameCenter key={`${viewerId}:${scope?.groupId}:${scope?.leagueId}:${context}:${state.gameId}`} viewerId={viewerId} context={context} eventId={state.gameId} tab={state.tab} onTabChange={live.selectTab} onBack={live.backToGames} onEventDate={live.resolveEventDate}/> : <>
      <LiveViewSelector value={state.view} onChange={live.selectView} />
      {state.view === "standings" ? <><h1 className="text-2xl font-black">{context === "nba-skins" ? "NBA Skins Live" : "NBA Live"}</h1><StandingsPanel sport="nba" scope={scope} selection={state.standingsView} onChange={live.selectStandings} /></> : <>
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-end justify-between gap-3"><div><p className="text-[10px] font-black uppercase tracking-[0.18em] text-sky-600">{context === "nba-skins" ? "NBA Skins" : "NBA"}</p><h1 className="mt-1 text-2xl font-black tracking-tight">Live</h1><p className="mt-1 text-sm text-slate-500">Real-world NBA scores, game action, and box scores.</p></div><button type="button" onClick={() => void load()} disabled={!ready || request.refreshing} className="text-xl text-slate-500 disabled:opacity-40" aria-label="Refresh NBA scores">↻</button></div><div className="mt-4 flex items-center justify-between rounded-xl bg-slate-50 p-1"><button type="button" onClick={() => move(-1)} className="rounded-lg px-3 py-2 text-sm font-bold text-slate-600" aria-label="Previous day">←</button><input type="date" aria-label="NBA schedule date" value={state.date} onChange={event => live.selectDate(event.target.value)} className="min-w-0 bg-transparent px-2 py-2 text-center text-sm font-black text-slate-800" /><button type="button" onClick={() => move(1)} className="rounded-lg px-3 py-2 text-sm font-bold text-slate-600" aria-label="Next day">→</button></div></section>
      {favoriteError ? <p role="status" className="text-xs text-amber-700">{favoriteError}</p> : null}
      {!ready || request.loading ? <p className="py-8 text-center text-sm text-slate-500">Loading NBA games…</p> : request.error ? <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{request.error}</p> : ordered.length ? <section className="space-y-4">
        {favoriteGames.length ? <section aria-label="Favorite NBA games" className="space-y-2"><h2 className="px-1 text-xs font-black uppercase tracking-wider text-amber-600">★ Favorites</h2>{favoriteGames.map(card)}</section> : null}
        <section aria-label="NBA schedule" className="space-y-2">{favoriteGames.length ? <h2 className="px-1 text-xs font-black uppercase tracking-wider text-slate-500">All games</h2> : null}{ordered.map(card)}</section>
      </section> : <p className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">No NBA games scheduled for this date.</p>}
    </>}
    </>}
  </div></main>;
}
function GameCard({ game, onClick, favoriteTeamIds, favoritesLoading, pendingTeamIds, onToggleFavorite }: {
  game: NbaLiveGame; onClick: () => void; favoriteTeamIds: Set<string>; favoritesLoading: boolean; pendingTeamIds: Set<string>; onToggleFavorite: (teamId: string) => void;
}) {
  const started = game.status !== "pre";
  return <article role="button" tabIndex={0} onClick={onClick} onKeyDown={event => {
    if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); onClick(); }
  }} className={`w-full cursor-pointer rounded-xl border bg-white px-3 py-2.5 text-left shadow-sm ${game.status === "in" ? "border-sky-400 ring-1 ring-sky-400/20" : "border-slate-200"}`}>
    <TeamRow team={game.awayTeam} started={started} favorite={favoriteTeamIds.has(game.awayTeam.id)} disabled={favoritesLoading || pendingTeamIds.has(game.awayTeam.id)} onToggleFavorite={onToggleFavorite} />
    <TeamRow team={game.homeTeam} started={started} favorite={favoriteTeamIds.has(game.homeTeam.id)} disabled={favoritesLoading || pendingTeamIds.has(game.homeTeam.id)} onToggleFavorite={onToggleFavorite} />
    <div className="mt-2 flex justify-between gap-3 border-t border-slate-100 pt-2 text-[11px]"><span className={game.status === "in" ? "font-black text-sky-600" : "font-semibold text-slate-500"}>{game.status === "pre" ? new Date(game.startAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : game.statusDetail || (game.completed ? "Final" : "Live")}{game.broadcast?.network ? ` · ${game.broadcast.network}` : ""}</span>{line(game) ? <span className="text-right text-slate-500">{line(game)}</span> : null}</div>
  </article>;
}
function TeamRow({ team, started, favorite, disabled, onToggleFavorite }: {
  team: NbaLiveGame["awayTeam"]; started: boolean; favorite: boolean; disabled: boolean; onToggleFavorite: (teamId: string) => void;
}) {
  return <div className="flex min-w-0 items-center gap-2 py-0.5">
    <div className="flex h-7 w-7 shrink-0 items-center justify-center">{team.logo ? <img src={team.logo} alt="" className="max-h-7 max-w-7 object-contain" /> : null}</div>
    <div className="min-w-0 flex-1"><p className={`truncate text-sm ${team.winner ? "font-black" : "font-bold"}`}>{team.displayName}</p>{team.record ? <p className="text-[11px] text-slate-500">{team.record}</p> : null}</div>
    <button type="button" disabled={disabled} aria-label={favorite ? `Remove ${team.displayName} from favorites` : `Add ${team.displayName} to favorites`} aria-pressed={favorite}
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg leading-none disabled:opacity-40 ${favorite ? "text-amber-500" : "text-slate-300 hover:text-amber-400"}`}
      onClick={event => { event.stopPropagation(); onToggleFavorite(team.id); }}>{favorite ? "★" : "☆"}</button>
    {started ? <span className={`w-9 shrink-0 text-right text-lg tabular-nums ${team.winner ? "font-black" : "font-bold text-slate-600"}`}>{team.score ?? "—"}</span> : null}
  </div>;
}
