"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import AppNav from "@/components/AppNav";
import LiveScoreCard from "@/components/live-scores/LiveScoreCard";
import NflGameCenter from "./NflGameCenter";
import { useNflLiveUrl } from "@/lib/live-scores/useNflLiveUrl";
import { useNflLiveScope } from "@/lib/live-scores/useNflLiveScope";
import { useLiveRequest } from "@/lib/live-scores/useLiveRequest";
import { parseNflCalendar } from "@/lib/live-scores/urlState";

type Game = import("./LiveScoreCard").LiveScoreGame;

type ScoresResponse = {
  success?: boolean;
  season?: number;
  week?: number;
  label?: string;
  seasonType?: number;
  calendar?: import("@/lib/providers/nflLiveScores").NflCalendar;
  games?: Game[];
  error?: string;
};

function validateScores(body: ScoresResponse) {
  return parseNflCalendar(new URLSearchParams({ season: String(body.season), seasonType: String(body.seasonType), week: String(body.week) }))
    ? null : "NFL schedule context is unavailable. Please try again.";
}

function gameDateKey(game: Game) {
  return new Date(game.kickoffAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function gameDateLabel(game: Game) {
  return new Date(game.kickoffAt).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

export default function NflLiveScores({ viewerId }: { viewerId: string }) {
  const scope = useNflLiveScope(viewerId);
  const live = useNflLiveUrl(JSON.stringify(scope));
  const { state } = live;
  const ready = live.routeMatches && state.view === "games" && Boolean(scope);
  const params = state.calendar ? new URLSearchParams(Object.entries(state.calendar).map(([key, value]) => [key, String(value)])) : null;
  const url = ready && scope ? `/api/live-scores/nfl/scores?${params ? `${params}&` : ""}groupId=${encodeURIComponent(scope.groupId)}&leagueId=${encodeURIComponent(scope.leagueId)}&viewerId=${encodeURIComponent(viewerId)}` : null;
  const request = useLiveRequest<ScoresResponse>(scope ? { ...scope, resource: `scores:${params ?? "current"}` } : null, url, validateScores);
  const games = request.data?.games ?? [];
  const calendar = request.data?.calendar ?? [];
  const loading = request.loading || (ready && !state.calendar && !request.error);
  const error = request.error;
  const { season, seasonType, week } = state.calendar ?? { season: new Date().getFullYear(), seasonType: 2, week: 1 };
  const pendingFavorites = useRef(new Set<string>());
  const [favoriteError, setFavoriteError] = useState("");
  const [favoriteTeamIds, setFavoriteTeamIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (!request.data || state.calendar || !ready) return;
    const { season, seasonType, week } = request.data;
    const calendar = parseNflCalendar(new URLSearchParams({ season: String(season), seasonType: String(seasonType), week: String(week) }));
    if (calendar) live.resolveCalendar(calendar);
  }, [request.data, state.calendar, ready, live]);

  useEffect(() => {
    let cancelled = false;

    async function loadFavorites() {
      try {
        const response = await fetch("/api/live-scores/nfl/favorites", {
          cache: "no-store",
        });

        const data = (await response.json()) as {
          teamIds?: string[];
        };

        if (!response.ok) { if (!cancelled) setFavoriteError("Favorites are currently unavailable. Scores still work."); return; }

        if (!cancelled) {
          setFavoriteTeamIds(new Set(data.teamIds ?? []));
        }
      } catch {
        // Favorites are optional UI state; scores should still load normally.
      }
    }

    void loadFavorites();

    return () => {
      cancelled = true;
    };
  }, []);

  async function toggleFavorite(teamId: string) {
    if (pendingFavorites.current.has(teamId)) return;
    pendingFavorites.current.add(teamId);
    setFavoriteError("");
    const wasFavorite = favoriteTeamIds.has(teamId);

    setFavoriteTeamIds((current) => {
      const next = new Set(current);

      if (wasFavorite) {
        next.delete(teamId);
      } else {
        next.add(teamId);
      }

      return next;
    });

    try {
      const response = await fetch("/api/live-scores/nfl/favorites", {
        method: wasFavorite ? "DELETE" : "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ teamId }),
      });

      if (!response.ok) {
        throw new Error("Unable to update favorite team.");
      }
    } catch {
      setFavoriteError("Favorite could not be saved. Please try again.");
      setFavoriteTeamIds((current) => {
        const next = new Set(current);

        if (wasFavorite) {
          next.add(teamId);
        } else {
          next.delete(teamId);
        }

        return next;
      });
    } finally {
      pendingFavorites.current.delete(teamId);
    }
  }

  const filteredGames = games;

  const favoriteGames = useMemo(() => {
    const statusOrder = { in: 0, pre: 1, post: 2 } as Record<string, number>;

    return filteredGames
      .filter(
        (game) =>
          favoriteTeamIds.has(game.awayTeam.id) ||
          favoriteTeamIds.has(game.homeTeam.id),
      )
      .sort((a, b) => {
        const statusDifference =
          (statusOrder[a.status] ?? 1) -
          (statusOrder[b.status] ?? 1);

        if (statusDifference !== 0) return statusDifference;

        return (
          new Date(a.kickoffAt).getTime() -
          new Date(b.kickoffAt).getTime()
        );
      });
  }, [filteredGames, favoriteTeamIds]);

  const groupedGames = useMemo(() => {
    const statusOrder = { in: 0, pre: 1, post: 2 } as Record<string, number>;
    const sortedGames = [...filteredGames].sort((a, b) => {
      const statusDifference =
        (statusOrder[a.status] ?? 1) - (statusOrder[b.status] ?? 1);

      if (statusDifference !== 0) return statusDifference;

      return new Date(a.kickoffAt).getTime() - new Date(b.kickoffAt).getTime();
    });

    const groups: { key: string; label: string; games: Game[] }[] = [];

    for (const game of sortedGames) {
      const key = gameDateKey(game);
      const existing = groups.find((group) => group.key === key);

      if (existing) {
        existing.games.push(game);
      } else {
        groups.push({
          key,
          label: gameDateLabel(game),
          games: [game],
        });
      }
    }

    groups.sort((a, b) => {
      const priority = (group: { games: Game[] }) => {
        if (group.games.some((game) => game.status === "in")) return 0;
        if (group.games.some((game) => game.status === "pre")) return 1;
        return 2;
      };

      const priorityDifference = priority(a) - priority(b);
      if (priorityDifference !== 0) return priorityDifference;

      return (
        new Date(a.games[0].kickoffAt).getTime() -
        new Date(b.games[0].kickoffAt).getTime()
      );
    });

    return groups;
  }, [filteredGames]);

  const filterLabel = calendar.find((part) => Number(part.value) === seasonType)?.label ?? "NFL";
  const weeks = calendar.find((part) => Number(part.value) === seasonType)?.entries ?? [];
  const weekLabel = weeks.find((entry) => Number(entry.value) === week)?.label ?? `Week ${week}`;


  return (
    <main className="nfl-live-page min-h-screen bg-slate-50 px-3 py-5 pb-24 text-slate-900 sm:px-4 sm:py-6 sm:pb-6">
      <div className="mx-auto max-w-5xl space-y-4">
        <AppNav />

        {!live.routeMatches ? null : state.view === "detail" ? <NflGameCenter
          key={`${viewerId}:${scope?.groupId}:${scope?.leagueId}:${state.gameId}`}
          viewerId={viewerId} eventId={state.gameId} tab={state.tab} period={state.period} statsTeam={state.statsTeam}
          onDetailChange={live.selectDetail} onBack={live.backToGames} onCalendar={live.resolveCalendar}
        /> : <>
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-sky-600">
                NFL
              </div>
              <h1 className="mt-1 text-2xl font-black tracking-tight">
                Live Scores
              </h1>
              <p className="mt-1 text-sm text-slate-500">
                Live scores and schedules from around the NFL.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <label className="flex flex-col gap-1 text-xs font-bold text-slate-500">
                Season
                <select aria-label="Season" value={season} onChange={(event) => live.selectCalendar({ season: Number(event.target.value), seasonType, week: 1 })} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold">
                  {Array.from(new Set([season, ...Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i)])).sort((a, b) => b - a).map((year) => <option key={year} value={year}>{year}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs font-bold text-slate-500">
                Season type
                <select aria-label="Season type" value={seasonType} onChange={(event) => live.selectCalendar({ season, seasonType: Number(event.target.value), week: 1 })} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold">
                  {calendar.map((part) => <option key={part.value} value={part.value}>{part.label}</option>)}
                </select>
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  Week
                </span>
                <select
                  value={week}
                  onChange={(event) => {
                    live.selectCalendar({ season, seasonType, week: Number(event.target.value) });
                    event.currentTarget.blur();
                  }}
                  className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold"
                >
                  {weeks.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
                </select>
              </label>
            </div>
          </div>
        </section>

        {favoriteError ? <p role="status" className="text-xs text-amber-700">{favoriteError}</p> : null}
        {loading ? (
          <section className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 shadow-sm">
            Loading NFL scores…
          </section>
        ) : error ? (
          <section className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
            {error}
          </section>
        ) : (
          <section className="space-y-4">
            <div className="px-1 text-xs font-semibold text-slate-500">
              {filterLabel} · {weekLabel} · {filteredGames.length} game
              {filteredGames.length === 1 ? "" : "s"}
            </div>

            {favoriteGames.length > 0 ? (
              <div className="space-y-2">
                <div className="px-1 text-xs font-black uppercase tracking-wider text-amber-600">
                  ★ Favorites
                </div>

                <div className="grid gap-2 lg:grid-cols-2">
                  {favoriteGames.map((game) => (
                    <LiveScoreCard
                      key={`favorite-${game.espnEventId}`}
                      game={game}
                      onClick={() => live.openGame(game.espnEventId)}
                      favoriteTeamIds={favoriteTeamIds}
                      onToggleFavorite={toggleFavorite}
                    />
                  ))}
                </div>
              </div>
            ) : null}

            {games.length === 0 ? <p className="p-4 text-center text-sm text-slate-500">No NFL games in this week.</p> : null}
            {groupedGames.map((group) => (
              <div key={group.key} className="space-y-2">
                <div className="px-1 text-xs font-black uppercase tracking-wider text-slate-500">
                  {group.label}
                </div>

                <div className="grid gap-2 lg:grid-cols-2">
                  {group.games.map((game) => (
                    <LiveScoreCard
                      key={game.espnEventId}
                      game={game}
                      onClick={() => live.openGame(game.espnEventId)}
                      favoriteTeamIds={favoriteTeamIds}
                      onToggleFavorite={toggleFavorite}
                    />
                  ))}
                </div>
              </div>
            ))}
          </section>
        )}
        </>}
      </div>
    </main>
  );
}
