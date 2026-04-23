"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AppNav from "@/components/AppNav";
import FunFactCarousel from "@/components/home/FunFactCarousel";

type LatestSlate = {
  id: number;
  date: string;
  start_date: string;
  end_date: string;
  label: string;
  is_locked: boolean;
};

type LatestSlateRow = {
  slate_id: number;
  team_id: number;
  teamName: string;
  fantasy_points: number | null;
  finish_position: number | null;
  games_completed: number | null;
  games_in_progress: number | null;
  games_remaining: number | null;
};

type SeasonSnapshotRow = {
  team_id: number;
  name: string;
  wins: number;
  runner_ups: number;
  avg_finish: number | null;
  avg_score: number | null;
  slates_played: number;
};

type FunFact = {
  label: string;
  value: string;
  detail?: string;
};

type HomeSummaryResponse = {
  success: boolean;
  latestSlate: LatestSlate | null;
  latestSlateRows: LatestSlateRow[];
  seasonSnapshot: SeasonSnapshotRow[];
  funFacts: FunFact[];
  latestSeason: number;
};

function roundTo(value: number, digits = 1) {
  return Number(value.toFixed(digits));
}

export default function HomePage() {
  const [data, setData] = useState<HomeSummaryResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState("");

  async function loadHomeSummary() {
    try {
      setIsLoading(true);
      setMessage("");

      const response = await fetch("/api/home-summary", { cache: "no-store" });
      const result = await response.json();

      if (!response.ok) {
        setMessage(result.error || "Failed to load home summary.");
        return;
      }

      setData(result);
    } catch (error) {
      console.error(error);
      setMessage("Something went wrong while loading the home page.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadHomeSummary();
  }, []);

  const latestSlate = data?.latestSlate ?? null;
  const latestSlateRows = data?.latestSlateRows ?? [];
  const seasonSnapshot = data?.seasonSnapshot ?? [];
  const funFacts = data?.funFacts ?? [];
  const latestSeason = data?.latestSeason ?? new Date().getFullYear();

  const leader = latestSlateRows[0] ?? null;

  const hasLiveGames = latestSlateRows.some(
    (row) => Number(row.games_in_progress ?? 0) > 0
  );

  const hasCompletedGames = latestSlateRows.some(
    (row) => Number(row.games_completed ?? 0) > 0
  );

  const hasRemainingGames = latestSlateRows.some(
    (row) => Number(row.games_remaining ?? 0) > 0
  );

  const slateHeading = hasLiveGames
    ? "Live Slate"
    : hasCompletedGames && !hasRemainingGames
      ? "Latest Results"
      : "Current Slate";

  const slateBadge = hasLiveGames
    ? "LIVE"
    : hasCompletedGames && !hasRemainingGames
      ? "FINAL"
      : null;

  const leaderLabel =
    hasCompletedGames && !hasRemainingGames ? "Winner" : "Leader";

  const slateStatusLabel = hasLiveGames
    ? "Live"
    : hasCompletedGames && !hasRemainingGames
      ? "Final"
      : latestSlate?.is_locked
        ? "Locked"
        : "Open";

  const teamsTrackedLabel = hasLiveGames
    ? "Live slate leaderboard"
    : hasCompletedGames && !hasRemainingGames
      ? "Completed slate results"
      : "Upcoming slate overview";

  return (
    <main className="min-h-screen bg-slate-50 px-3 py-5 text-slate-900 sm:px-4 sm:py-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <AppNav />

        <section className="rounded-3xl border border-slate-200 bg-white px-5 py-6 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm font-medium uppercase tracking-wide text-sky-700">
                League Dashboard
              </p>
              <h1 className="mt-2 text-3xl font-bold tracking-tight">
                NBA Fantasy Playoffs
              </h1>
              <p className="mt-2 text-sm text-slate-600">
                Quick pulse check for the current slate, season snapshot, and a
                rotating fun fact.
              </p>
            </div>

            <button
              type="button"
              onClick={() => void loadHomeSummary()}
              className="rounded-xl border border-sky-300 bg-sky-100 px-4 py-3 text-sm font-medium text-sky-900 transition hover:bg-sky-200"
            >
              Refresh Home
            </button>
          </div>
        </section>

        {message ? (
          <section className="rounded-3xl border border-orange-200 bg-orange-50 px-5 py-4 text-sm text-orange-800 shadow-sm">
            {message}
          </section>
        ) : null}

        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-2xl font-semibold text-slate-900">
                  {slateHeading}
                </h2>

                {slateBadge === "LIVE" ? (
                  <span className="flex items-center gap-1 text-xs font-medium text-red-600">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-red-500"></span>
                    LIVE
                  </span>
                ) : slateBadge === "FINAL" ? (
                  <span className="text-xs font-medium text-slate-500">
                    FINAL
                  </span>
                ) : null}
              </div>

              <div className="mt-1 text-sm text-slate-500">
                {latestSlate ? latestSlate.label : "No slate available"}
              </div>
            </div>

            <Link
              href="/lineups/scores"
              className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:border-sky-200 hover:bg-sky-50"
            >
              Open Scores
            </Link>
          </div>

          {isLoading ? (
            <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-500">
              Loading current slate...
            </div>
          ) : latestSlateRows.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-500">
              No current slate data available yet.
            </div>
          ) : (
            <>
              <div className="mb-4 grid gap-3 md:grid-cols-3">
                <div className="rounded-2xl border border-orange-200 bg-orange-50 p-4">
                  <div className="text-xs uppercase tracking-wide text-orange-700">
                    {leaderLabel}
                  </div>
                  <div className="mt-2 text-2xl font-bold text-slate-900">
                    {leader ? leader.teamName : "—"}
                  </div>
                  <div className="mt-1 text-sm text-slate-600">
                    {leader
                      ? `${roundTo(Number(leader.fantasy_points ?? 0))} pts`
                      : "—"}
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs uppercase tracking-wide text-slate-500">
                    Slate Window
                  </div>
                  <div className="mt-2 text-xl font-semibold text-slate-900">
                    {latestSlate
                      ? `${latestSlate.start_date} → ${latestSlate.end_date}`
                      : "—"}
                  </div>
                  <div className="mt-1 text-sm text-slate-600">
                    {slateStatusLabel}
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs uppercase tracking-wide text-slate-500">
                    Teams Tracked
                  </div>
                  <div className="mt-2 text-2xl font-bold text-slate-900">
                    {latestSlateRows.length}
                  </div>
                  <div className="mt-1 text-sm text-slate-600">
                    {teamsTrackedLabel}
                  </div>
                </div>
              </div>

              <div className="overflow-hidden rounded-2xl border border-slate-200">
                <div className="overflow-x-auto -mx-4 px-4">
                  <table className="min-w-full border-collapse text-sm">
                    <thead className="bg-slate-100 text-slate-700">
                      <tr className="text-left">
                        <th className="px-4 py-3 font-semibold">Player</th>
                        <th className="px-4 py-3 font-semibold">Score</th>
                        <th className="px-4 py-3 font-semibold">Completed</th>
                        <th className="px-4 py-3 font-semibold">In Progress</th>
                        <th className="px-4 py-3 font-semibold">Remaining</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white text-slate-800">
                      {latestSlateRows.map((row, index) => (
                        <tr
                          key={`${row.slate_id}-${row.team_id}`}
                          className={`border-t border-slate-100 ${
                            index === 0 ? "bg-orange-50/50" : ""
                          }`}
                        >
                          <td className="px-4 py-3 font-medium">
                            {row.teamName}
                          </td>
                          <td className="px-4 py-3">
                            {roundTo(Number(row.fantasy_points ?? 0))}
                          </td>
                          <td className="px-4 py-3">
                            {row.games_completed ?? 0}
                          </td>
                          <td className="px-4 py-3">
                            {row.games_in_progress ?? 0}
                          </td>
                          <td className="px-4 py-3">
                            {row.games_remaining ?? 0}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-end justify-between gap-3">
              <div>
                <h2 className="text-2xl font-semibold text-slate-900">
                  Season Snapshot
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  {latestSeason} quick leaderboard
                </p>
              </div>

              <Link
                href="/standings"
                className="text-sm font-medium text-sky-700 underline underline-offset-2 hover:text-sky-900"
              >
                Full standings
              </Link>
            </div>

            {isLoading ? (
              <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-500">
                Loading season snapshot...
              </div>
            ) : seasonSnapshot.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-500">
                No season snapshot available yet.
              </div>
            ) : (
              <div className="space-y-3">
                {seasonSnapshot.map((row, index) => (
                  <div
                    key={row.team_id}
                    className={`rounded-2xl border px-4 py-3 ${
                      index === 0
                        ? "border-sky-200 bg-sky-50"
                        : "border-slate-200 bg-white"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="font-semibold text-slate-900">
                          {row.name}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          {row.wins} wins • Avg finish {row.avg_finish ?? "—"}
                        </div>
                      </div>

                      <div className="text-right">
                        <div className="text-sm font-semibold text-slate-900">
                          {row.avg_score ?? "—"}
                        </div>
                        <div className="text-xs text-slate-500">Avg score</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4">
              <h2 className="text-2xl font-semibold text-slate-900">
                Fun Fact
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                Tap through some extra stats.
              </p>
            </div>

            <FunFactCarousel facts={funFacts} />
          </section>
        </section>
      </div>
    </main>
  );
}
