"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import AppNav from "@/components/AppNav";
import LiveScoreCard from "@/components/live-scores/LiveScoreCard";
import GameCenterModal from "@/components/live-scores/GameCenterModal";

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

export default function NflLiveScores() {
  const [season, setSeason] = useState(new Date().getFullYear());
  const [week, setWeek] = useState(1);
  const [seasonType, setSeasonType] = useState(2);
  const [calendar, setCalendar] = useState<import("@/lib/providers/nflLiveScores").NflCalendar>([]);
  const [initialized, setInitialized] = useState(false);
  const pendingFavorites = useRef(new Set<string>());
  const [favoriteError, setFavoriteError] = useState("");
  const [games, setGames] = useState<Game[]>([]);
  const [favoriteTeamIds, setFavoriteTeamIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedGame, setSelectedGame] = useState<Game | null>(null);

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

  useEffect(() => {
    let cancelled = false;

    async function loadScores() {
      setLoading(true);
      setError("");

      try {
        const response = await fetch(
          initialized ? `/api/live-scores/nfl/scores?season=${season}&seasonType=${seasonType}&week=${week}` : "/api/live-scores/nfl/scores",
          { cache: "no-store" },
        );

        const data = (await response.json()) as ScoresResponse;

        if (!response.ok) {
          throw new Error(data.error || "Unable to load NFL scores.");
        }

        if (!cancelled) {
          setGames(data.games ?? []);
          setCalendar(data.calendar ?? []);
          if (!initialized) {
            setSeason(data.season ?? season);
            setSeasonType(data.seasonType ?? 2);
            setWeek(data.week ?? 1);
            setInitialized(true);
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Unable to load NFL scores.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadScores();

    return () => {
      cancelled = true;
    };
  }, [season, seasonType, week, initialized]);

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
  function changeContext(change: () => void) { setSelectedGame(null); setGames([]); change(); }

  return (
    <main className="min-h-screen bg-slate-50 px-3 py-5 pb-24 text-slate-900 sm:px-4 sm:py-6 sm:pb-6">
      <div className="mx-auto max-w-5xl space-y-4">
        <AppNav />

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
                <select aria-label="Season" value={season} onChange={(event) => changeContext(() => { setSeason(Number(event.target.value)); setWeek(1); })} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold">
                  {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i).map((year) => <option key={year} value={year}>{year}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs font-bold text-slate-500">
                Season type
                <select aria-label="Season type" value={seasonType} onChange={(event) => changeContext(() => { setSeasonType(Number(event.target.value)); setWeek(1); })} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold">
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
                    changeContext(() => setWeek(Number(event.target.value)));
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
                      onClick={() => setSelectedGame(game)}
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
                      onClick={() => setSelectedGame(game)}
                      favoriteTeamIds={favoriteTeamIds}
                      onToggleFavorite={toggleFavorite}
                    />
                  ))}
                </div>
              </div>
            ))}
          </section>
        )}
      </div>
      {selectedGame ? (
        <GameCenterModal
          key={selectedGame.espnEventId}
          apiBase="/api/live-scores/nfl"
          game={selectedGame}
          onClose={() => setSelectedGame(null)}
        />
      ) : null}
    </main>
  );
}
