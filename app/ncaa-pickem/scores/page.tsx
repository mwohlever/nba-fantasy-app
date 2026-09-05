"use client";

import { useEffect, useMemo, useState } from "react";

import AppNav from "@/components/AppNav";
import NcaaScoreCard from "@/components/ncaa/NcaaScoreCard";
import NcaaGameCenterModal from "@/components/ncaa/NcaaGameCenterModal";

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
  const [season, setSeason] = useState(2026);
  const [week, setWeek] = useState(1);
  const [filter, setFilter] = useState("top25");
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
        const response = await fetch("/api/ncaa-pickem/favorites", {
          cache: "no-store",
        });

        const data = (await response.json()) as {
          teamIds?: string[];
        };

        if (!response.ok) return;

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
      setFavoriteTeamIds((current) => {
        const next = new Set(current);

        if (wasFavorite) {
          next.add(teamId);
        } else {
          next.delete(teamId);
        }

        return next;
      });
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function loadScores() {
      setLoading(true);
      setError("");

      try {
        const response = await fetch(
          `/api/ncaa-pickem/scores?season=${season}&week=${week}`,
          { cache: "no-store" },
        );

        const data = (await response.json()) as ScoresResponse;

        if (!response.ok) {
          throw new Error(data.error || "Unable to load NCAA scores.");
        }

        if (!cancelled) {
          setGames(data.games ?? []);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Unable to load NCAA scores.",
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
  }, [season, week]);

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
    <main className="min-h-screen bg-slate-50 px-3 py-5 pb-24 text-slate-900 sm:px-4 sm:py-6 sm:pb-6">
      <div className="mx-auto max-w-5xl space-y-4">
        <AppNav />

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-sky-600">
                NCAA Football
              </div>
              <h1 className="mt-1 text-2xl font-black tracking-tight">
                Scores
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
                    setWeek(Number(event.target.value));
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
                      onClick={() => setSelectedGame(game)}
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
        <NcaaGameCenterModal
          game={selectedGame}
          onClose={() => setSelectedGame(null)}
        />
      ) : null}
    </main>
  );
}
