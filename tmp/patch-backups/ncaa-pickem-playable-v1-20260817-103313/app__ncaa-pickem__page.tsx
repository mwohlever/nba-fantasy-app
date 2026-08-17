"use client";

import AppNav from "@/components/AppNav";
import {
  useEffect,
  useMemo,
  useState,
} from "react";
import { useSelectedSport } from "@/components/providers/SportProvider";

type PickEmWeek = {
  id: number;
  season: number;
  week_number: number;
  label: string;
  lock_at: string | null;
  status: "open" | "locked" | "final";
};

type PickEmGame = {
  id: number;
  espn_event_id: string;
  kickoff_at: string;

  away_team_name: string;
  away_team_abbreviation: string | null;
  away_team_logo_url: string | null;
  away_rank: number | null;
  away_record: string | null;
  away_score: number | null;

  home_team_name: string;
  home_team_abbreviation: string | null;
  home_team_logo_url: string | null;
  home_rank: number | null;
  home_record: string | null;
  home_score: number | null;

  status: string;
  status_detail: string | null;
};

type WeekResponse = {
  success: boolean;
  viewer?: {
    teamId: number;
    displayName: string;
    avatarUrl: string | null;
  };
  weeks: PickEmWeek[];
  week: PickEmWeek | null;
  games: PickEmGame[];
  picks: Array<{
    game_id: number;
    picked_team_id: string;
  }>;
  locked: boolean;
  error?: string;
};

function formatKickoff(
  value: string,
) {
  return new Date(value).toLocaleString(
    "en-US",
    {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: "America/New_York",
    },
  );
}

function teamLabel(
  rank: number | null,
  name: string,
) {
  return rank
    ? `#${rank} ${name}`
    : name;
}

export default function NcaaPickEmHome() {
  const {
    selectedSport,
    setSelectedSport,
  } = useSelectedSport();

  const [data, setData] =
    useState<WeekResponse | null>(null);

  const [isLoading, setIsLoading] =
    useState(true);

  const [error, setError] =
    useState("");

  const [selectedSeason, setSelectedSeason] =
    useState<number | null>(null);

  const [selectedWeek, setSelectedWeek] =
    useState<number | null>(null);

  useEffect(() => {
    if (selectedSport !== "ncaa") {
      setSelectedSport("ncaa");
    }
  }, [
    selectedSport,
    setSelectedSport,
  ]);

  useEffect(() => {
    let active = true;

    async function loadWeek() {
      try {
        setIsLoading(true);
        setError("");

        const params =
          new URLSearchParams();

        if (selectedSeason !== null) {
          params.set(
            "season",
            String(selectedSeason),
          );
        }

        if (selectedWeek !== null) {
          params.set(
            "week",
            String(selectedWeek),
          );
        }

        const suffix =
          params.toString()
            ? `?${params.toString()}`
            : "";

        const response =
          await fetch(
            `/api/ncaa-pickem/week${suffix}`,
            {
              cache: "no-store",
            },
          );

        const result =
          (await response.json()) as WeekResponse;

        if (!active) return;

        if (!response.ok) {
          setError(
            result.error ||
              "Failed to load NCAA Pick 'Em.",
          );
          setData(null);
          return;
        }

        setData(result);

        if (
          selectedSeason === null &&
          result.week
        ) {
          setSelectedSeason(
            result.week.season,
          );
        }

        if (
          selectedWeek === null &&
          result.week
        ) {
          setSelectedWeek(
            result.week.week_number,
          );
        }
      } catch (loadError) {
        console.error(loadError);

        if (active) {
          setError(
            "Unable to load NCAA Pick 'Em.",
          );
          setData(null);
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    }

    void loadWeek();

    return () => {
      active = false;
    };
  }, [
    selectedSeason,
    selectedWeek,
  ]);

  const seasons =
    useMemo(
      () =>
        Array.from(
          new Set(
            (data?.weeks ?? []).map(
              (week) => week.season,
            ),
          ),
        ).sort((a, b) => b - a),
      [data?.weeks],
    );

  const weeksForSeason =
    useMemo(
      () =>
        (data?.weeks ?? [])
          .filter(
            (week) =>
              selectedSeason === null ||
              week.season ===
                selectedSeason,
          )
          .sort(
            (a, b) =>
              a.week_number -
              b.week_number,
          ),
      [
        data?.weeks,
        selectedSeason,
      ],
    );

  return (
    <main className="min-h-screen bg-slate-950 px-3 py-5 pb-24 text-slate-100 sm:px-4 sm:py-6 sm:pb-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <AppNav />

        <section className="overflow-hidden rounded-3xl border border-blue-500/30 bg-gradient-to-br from-slate-900 via-slate-900 to-blue-950 shadow-xl">
          <div className="border-b border-slate-700/80 px-5 py-6 sm:px-7">
            <div className="text-xs font-bold uppercase tracking-[0.22em] text-blue-300">
              111 Sports
            </div>

            <div className="mt-2 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h1 className="text-3xl font-black tracking-tight sm:text-4xl">
                  NCAA Pick &apos;Em
                </h1>

                <p className="mt-2 max-w-2xl text-sm text-slate-300 sm:text-base">
                  Pick the winner of every
                  Top-25-vs-Top-25 matchup.
                  The entire weekly card locks
                  when the first eligible game
                  kicks off.
                </p>
              </div>

              {data?.week ? (
                <div className="rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    Card status
                  </div>

                  <div className="mt-1 font-bold">
                    {data.locked
                      ? "🔒 Locked"
                      : "🟢 Open"}
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <div className="grid gap-3 px-5 py-4 sm:grid-cols-2 sm:px-7">
            <label className="space-y-1">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Season
              </span>

              <select
                value={
                  selectedSeason ?? ""
                }
                onChange={(event) => {
                  const value =
                    Number(
                      event.target.value,
                    );

                  setSelectedSeason(
                    Number.isFinite(value)
                      ? value
                      : null,
                  );

                  setSelectedWeek(null);
                }}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-semibold text-slate-100"
              >
                {seasons.length === 0 ? (
                  <option value="">
                    No seasons yet
                  </option>
                ) : null}

                {seasons.map((season) => (
                  <option
                    key={season}
                    value={season}
                  >
                    {season}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Week
              </span>

              <select
                value={
                  selectedWeek ?? ""
                }
                onChange={(event) => {
                  const value =
                    Number(
                      event.target.value,
                    );

                  setSelectedWeek(
                    Number.isFinite(value)
                      ? value
                      : null,
                  );
                }}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-semibold text-slate-100"
              >
                {weeksForSeason.length ===
                0 ? (
                  <option value="">
                    No weeks yet
                  </option>
                ) : null}

                {weeksForSeason.map(
                  (week) => (
                    <option
                      key={week.id}
                      value={
                        week.week_number
                      }
                    >
                      {week.label}
                    </option>
                  ),
                )}
              </select>
            </label>
          </div>
        </section>

        {error ? (
          <div className="rounded-2xl border border-red-500/40 bg-red-950/40 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        ) : null}

        {isLoading ? (
          <section className="rounded-3xl border border-slate-800 bg-slate-900 p-8 text-center text-slate-400">
            Loading NCAA Pick &apos;Em…
          </section>
        ) : null}

        {!isLoading &&
        !error &&
        !data?.week ? (
          <section className="rounded-3xl border border-slate-800 bg-slate-900 p-8 text-center">
            <div className="text-4xl">
              🏈
            </div>

            <h2 className="mt-3 text-xl font-bold">
              NCAA Pick &apos;Em is ready
            </h2>

            <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-slate-400">
              The foundation is installed.
              No weekly games have been
              imported yet. The next step is
              ESPN Top 25 schedule ingestion.
            </p>
          </section>
        ) : null}

        {!isLoading &&
        data?.week ? (
          <>
            <section className="space-y-3">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <div className="text-xs font-bold uppercase tracking-[0.18em] text-blue-300">
                    {data.week.season}
                  </div>

                  <h2 className="mt-1 text-2xl font-black">
                    {data.week.label}
                  </h2>
                </div>

                {data.week.lock_at ? (
                  <div className="text-sm text-slate-400">
                    Locks{" "}
                    {formatKickoff(
                      data.week.lock_at,
                    )}
                  </div>
                ) : null}
              </div>

              {data.games.length === 0 ? (
                <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 text-sm text-slate-400">
                  No eligible Top 25
                  matchups are loaded for
                  this week.
                </div>
              ) : null}

              {data.games.map((game) => (
                <article
                  key={game.id}
                  className="rounded-2xl border border-slate-800 bg-slate-900 p-4"
                >
                  <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    {formatKickoff(
                      game.kickoff_at,
                    )}
                  </div>

                  <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
                    <div className="font-bold">
                      {teamLabel(
                        game.away_rank,
                        game.away_team_name,
                      )}
                    </div>

                    <div className="text-sm font-bold text-slate-500">
                      at
                    </div>

                    <div className="font-bold sm:text-right">
                      {teamLabel(
                        game.home_rank,
                        game.home_team_name,
                      )}
                    </div>
                  </div>

                  <div className="mt-3 text-xs text-slate-500">
                    Pick controls, expandable
                    team stats, live scores,
                    and revealed group picks
                    arrive in the next build
                    phase.
                  </div>
                </article>
              ))}
            </section>

            <button
              type="button"
              disabled
              className="w-full rounded-2xl bg-blue-600 px-5 py-3 font-bold text-white opacity-50"
            >
              Save Picks
            </button>
          </>
        ) : null}
      </div>
    </main>
  );
}
