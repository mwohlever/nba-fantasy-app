"use client";

import { Suspense, useEffect, useMemo, useState } from "react";

import AppNav from "@/components/AppNav";
import LiveViewSelector from "@/components/live-scores/LiveViewSelector";
import StandingsPanel from "@/components/live-scores/StandingsPanel";
import { useNcaaLiveUrl } from "@/lib/live-scores/useNcaaLiveUrl";
import { useNcaaStandingsScope } from "@/lib/live-scores/useNcaaStandingsScope";
import NcaaScoreCard from "@/components/ncaa/NcaaScoreCard";
import NcaaGameCenter from "@/components/ncaa/NcaaGameCenter";
import { useLiveRequest } from "@/lib/live-scores/useLiveRequest";

type Team = {
  id: string;
  displayName: string;
  abbreviation: string | null;
  logo: string | null;
  rank: number | null;
  record: string | null;
  conferenceId: string | null;
  score: number | null;
  winner: boolean;
};

type Odds = {
  favoriteTeamId: string | null;
  spread: number | null;
  overUnder: number | null;
  provider: string | null;
};

type Game = {
  espnEventId: string;
  name: string;
  shortName: string | null;
  kickoffAt: string;
  awayTeam: Team;
  homeTeam: Team;
  status: string;
  statusDetail: string | null;
  completed: boolean;
  winnerTeamId: string | null;
  odds: Odds | null;
};

type ScoresResponse = {
  success?: boolean;
  season?: number;
  week?: number;
  label?: string;
  games?: Game[];
  error?: string;
};

const EMPTY_GAMES: Game[] = [];
const EMPTY_FAVORITES = new Set<string>();

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

const CONFERENCES = [
  { id: "top25", label: "Top 25" },
  { id: "1", label: "ACC" },
  { id: "151", label: "American" },
  { id: "4", label: "Big 12" },
  { id: "5", label: "Big Ten" },
  { id: "12", label: "Conference USA" },
  { id: "15", label: "MAC" },
  { id: "17", label: "Mountain West" },
  { id: "8", label: "SEC" },
  { id: "37", label: "Sun Belt" },
  { id: "18", label: "Independents" },
];

export default function NcaaScoresPage() {
  return <Suspense fallback={<main className="min-h-screen bg-slate-50 p-4 pb-24 text-sm text-slate-500">Loading NCAA scores…</main>}><NcaaScoresContent /></Suspense>;
}

function NcaaScoresContent() {
  const { scope, waitingForScope } = useNcaaStandingsScope();
  const live = useNcaaLiveUrl(JSON.stringify(scope));
  const gamesView = live.routeMatches && live.state.view !== "standings";
  const { season, week } = live.state.calendar ?? { season: 2026, week: 1 };
  const initialized = Boolean(live.state.calendar);
  const [filter, setFilter] = useState("top25");
  const calendarKey = initialized ? `season=${season}&week=${week}` : "";
  const request = useLiveRequest<ScoresResponse>(scope ? { ...scope, resource: `scores:${calendarKey || "current"}` } : null,
    gamesView && scope ? `/api/ncaa-pickem/scores${calendarKey ? `?${calendarKey}` : ""}` : null);
  const games = request.data?.games ?? EMPTY_GAMES;
  const loading = waitingForScope || request.loading || (gamesView && Boolean(scope) && !initialized && !request.error);
  const error = request.error || (!waitingForScope && !scope ? "NCAA Pick 'Em is not enabled for this Group." : "");
  const favoritesKey = JSON.stringify(scope);
  const favoritesReady = gamesView && Boolean(scope);
  const [favorites, setFavorites] = useState<{ key: string; ids: Set<string> } | null>(null);
  const favoriteTeamIds = favorites?.key === favoritesKey ? favorites.ids : EMPTY_FAVORITES;
  const gameId = live.state.view === "detail" ? live.state.gameId : null;
  const selectedGame = gameId && scope && !loading && !error
    ? games.find(game => game.espnEventId === gameId) ?? null : null;

  useEffect(() => {
    if (request.data && !initialized && request.data.season && request.data.week) {
      live.resolveCalendar({ season: request.data.season, week: request.data.week });
    }
  }, [request.data, initialized, live]);

  useEffect(() => {
    if (live.state.view !== "detail") return;
    if (!/^\d+$/.test(live.state.gameId) || (request.data && initialized && !loading && !error && !selectedGame)) live.clearDetail();
  }, [live, request.data, initialized, loading, error, selectedGame]);

  useEffect(() => {
    if (!favoritesReady) return;
    let cancelled = false;

    async function loadFavorites() {
      try {
        const response = await fetch("/api/ncaa-pickem/favorites", {
          cache: "no-store",
        });

        const data = (await response.json()) as {
          teamIds?: string[];
        };

        if (!response.ok) return;

        if (!cancelled) {
          setFavorites({ key: favoritesKey, ids: new Set(data.teamIds ?? []) });
        }
      } catch {
        // Favorites are optional UI state; scores should still load normally.
      }
    }

    void loadFavorites();

    return () => {
      cancelled = true;
    };
  }, [favoritesReady, favoritesKey]);

  async function toggleFavorite(teamId: string) {
    const wasFavorite = favoriteTeamIds.has(teamId);

    setFavorites((current) => {
      const next = new Set(current?.key === favoritesKey ? current.ids : []);

      if (wasFavorite) {
        next.delete(teamId);
      } else {
        next.add(teamId);
      }

      return { key: favoritesKey, ids: next };
    });

    try {
      const response = await fetch("/api/ncaa-pickem/favorites", {
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
      setFavorites((current) => {
        if (current?.key !== favoritesKey) return current;
        const next = new Set(current.ids);

        if (wasFavorite) {
          next.add(teamId);
        } else {
          next.delete(teamId);
        }

        return { key: favoritesKey, ids: next };
      });
    }
  }

  const filteredGames = useMemo(() => {
    if (filter === "top25") {
      return games.filter(
        (game) =>
          game.awayTeam.rank !== null ||
          game.homeTeam.rank !== null,
      );
    }

    return games.filter(
      (game) =>
        game.awayTeam.conferenceId === filter ||
        game.homeTeam.conferenceId === filter,
    );
  }, [filter, games]);

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

  const filterLabel =
    CONFERENCES.find((item) => item.id === filter)?.label ?? "Scores";

  return (
    <main className={`${live.state.view === "standings" ? "ncaa-standings-page " : live.state.view === "detail" ? "ncaa-live-page " : ""}min-h-screen bg-slate-50 px-3 py-5 pb-24 text-slate-900 sm:px-4 sm:py-6 sm:pb-6`}>
      <div className="mx-auto max-w-5xl space-y-4">
        <AppNav />
        {live.state.view === "detail" ? selectedGame && scope ? <NcaaGameCenter
          key={`${scope.viewerId}:${scope.groupId}:${scope.leagueId}:${selectedGame.espnEventId}`}
          game={selectedGame} scope={scope} tab={live.state.tab} period={live.state.period} statsTeam={live.state.statsTeam}
          onDetailChange={live.selectDetail} onBack={live.backToGames}
        /> : <section className="bg-white p-4">
          <button type="button" onClick={live.backToGames} className="text-xs font-bold text-sky-700">← Back to games</button>
          {error ? <p role="alert" className="mt-4 text-sm text-rose-700">{error}</p> : <p className="py-8 text-center text-sm text-slate-500">Loading NCAA scores…</p>}
        </section> : <>
        <LiveViewSelector value={live.state.view} onChange={view => live.selectView(view, initialized ? { season, week } : null)} />
        {live.state.view === "standings" ? <><h1 className="text-2xl font-black">NCAA Football Live</h1><StandingsPanel sport="ncaa" scope={scope} waitingForScope={waitingForScope} selection={live.state.selection} onChange={live.selectStandings} /></> : <>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-sky-600">
                NCAA Football
              </div>
              <h1 className="mt-1 text-2xl font-black tracking-tight">
                NCAA Football Live
              </h1>
              <p className="mt-1 text-sm text-slate-500">
                Live scores and schedules from around college football.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  View
                </span>
                <select
                  value={filter}
                  onChange={(event) => {
                    setFilter(event.target.value);
                    event.currentTarget.blur();
                  }}
                  className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold"
                >
                  {CONFERENCES.map((conference) => (
                    <option key={conference.id} value={conference.id}>
                      {conference.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  Week
                </span>
                <select
                  value={week}
                  onChange={(event) => {
                    live.selectCalendar({ season, week: Number(event.target.value) });
                    event.currentTarget.blur();
                  }}
                  className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold"
                >
                  {Array.from({ length: 15 }, (_, index) => index + 1).map(
                    (value) => (
                      <option key={value} value={value}>
                        Week {value}
                      </option>
                    ),
                  )}
                </select>
              </label>
            </div>
          </div>
        </section>

        {loading ? (
          <section className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 shadow-sm">
            Loading NCAA scores…
          </section>
        ) : error ? (
          <section className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
            {error}
          </section>
        ) : (
          <section className="space-y-4">
            <div className="px-1 text-xs font-semibold text-slate-500">
              {filterLabel} · Week {week} · {filteredGames.length} game
              {filteredGames.length === 1 ? "" : "s"}
            </div>

            {favoriteGames.length > 0 ? (
              <div className="space-y-2">
                <div className="px-1 text-xs font-black uppercase tracking-wider text-amber-600">
                  ★ Favorites
                </div>

                <div className="grid gap-2 lg:grid-cols-2">
                  {favoriteGames.map((game) => (
                    <NcaaScoreCard
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

            {groupedGames.map((group) => (
              <div key={group.key} className="space-y-2">
                <div className="px-1 text-xs font-black uppercase tracking-wider text-slate-500">
                  {group.label}
                </div>

                <div className="grid gap-2 lg:grid-cols-2">
                  {group.games.map((game) => (
                    <NcaaScoreCard
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
        </>}
      </div>
    </main>
  );
}
