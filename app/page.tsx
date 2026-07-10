"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import AppNav from "@/components/AppNav";
import FunFactCarousel from "@/components/home/FunFactCarousel";
import TeamProfileModal from "@/components/TeamProfileModal";
import PlayerHeadshot from "@/components/ui/PlayerHeadshot";
import SeasonAwards from "@/components/home/SeasonAwards";

type LatestSlate = {
  id: number;
  date: string;
  start_date: string;
  end_date: string;
  label: string;
  is_locked: boolean;
  first_game_start_time: string | null;
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
  projected_points?: number | null;
  win_probability?: number | null;
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

type SeasonAwardsResponse = {
  success: boolean;
  awards: Array<{
    title: string;
    emoji: string;
    winner: string;
    detail: string;
  }>;
  firstTeam: {
    guards: any[];
    frontcourt: any[];
  };
};

type HomeSummaryResponse = {
  success: boolean;
  latestSlate: LatestSlate | null;
  nextSlate: LatestSlate | null;
  latestSlateRows: LatestSlateRow[];
  seasonSnapshot: SeasonSnapshotRow[];
  funFacts: FunFact[];
  latestSeason: number;
};

type SlateRosterModalState = {
  slateId: number;
  teamId: number;
  teamName: string;
  slateLabel: string;
} | null;

type SlateRosterRow = {
  playerId: number;
  name: string;
  nbaPlayerId: number | null;
  positionGroup: string | null;
  points: number;
  rebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
  fantasyPoints: number;
};

function roundTo(value: number, digits = 1) {
  return Number(value.toFixed(digits));
}



export default function HomePage() {
  const [data, setData] = useState<HomeSummaryResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [profileTeam, setProfileTeam] = useState<{ id: number; name: string } | null>(null);
  const [slateRosterModal, setSlateRosterModal] =
    useState<SlateRosterModalState>(null);
  const [slateRosterRows, setSlateRosterRows] = useState<SlateRosterRow[]>([]);
  const [slateRosterTotal, setSlateRosterTotal] = useState(0);
  const [seasonAwards, setSeasonAwards] = useState<SeasonAwardsResponse | null>(null);

  function parseStatusTextMinutesRemaining(statusText?: string | null) {
    if (!statusText) return null;

    const trimmed = statusText.trim();

    if (/final/i.test(trimmed)) return 0;

    const match = trimmed.match(/^Q(\d+)\s+(?:(\d*)?:)?(\d+(?:\.\d+)?)$/i);

    if (!match) return null;

    const period = Number(match[1]);
    const minutes = Number(match[2] || 0);
    const seconds = Number(match[3] ?? 0);

    const clockMinutes = minutes + seconds / 60;
    const periodsRemainingAfterCurrent = Math.max(4 - period, 0);

    return periodsRemainingAfterCurrent * 12 + clockMinutes;
  }

  function getProjectedFantasyPoints(row: any) {
    const current = Number(row.fantasyPoints ?? 0);
    const baseline = Number(row.projection ?? row.averageProjection ?? 30);

    const remainingMinutes = parseStatusTextMinutesRemaining(
      row.gameStatusText
    );

    if (remainingMinutes === 0) return current;

    if (remainingMinutes === null) return baseline;

    return current + baseline * (remainingMinutes / 48);
  }

  function getPlayerStatusLabel(row: any) {
    const text = row.gameStatusText;

    if (!text) return "Pregame";

    if (/final/i.test(text)) return "Final";

    return text;
  }
  const [isSlateRosterLoading, setIsSlateRosterLoading] = useState(false);
  const [isRefreshingHomeStats, setIsRefreshingHomeStats] = useState(false);
  const autoRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);



  async function refreshSlateStatsById(slateId: number) {
    try {
      setIsRefreshingHomeStats(true);
      setMessage("");

      const response = await fetch("/api/refresh-stats", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ slateId }),
      });

      const result = await response.json();

      if (!response.ok) {
        setMessage(result.error || "Failed to refresh stats.");
        return;
      }

      await loadHomeSummary();
    } catch (err) {
      console.error("Failed to refresh stats", err);
      setMessage("Failed to refresh stats.");
    } finally {
      setIsRefreshingHomeStats(false);
    }
  }

  async function handleRefreshStats() {
    if (!latestSlate?.id) {
      setMessage("No active slate found to refresh.");
      return;
    }

    await refreshSlateStatsById(latestSlate.id);
  }

  async function loadHomeSummary() {
    try {
      setIsLoading(true);
      setMessage("");

      const [response, awardsResponse] = await Promise.all([
        fetch("/api/home-summary", { cache: "no-store" }),
        fetch("/api/season-awards", { cache: "no-store" }),
      ]);

      const result = await response.json();
      const awardsResult = await awardsResponse.json();

      if (!response.ok) {
        setMessage(result.error || "Failed to load home summary.");
        return;
      }

      setData(result);

      if (awardsResponse.ok) {
        setSeasonAwards(awardsResult);
      } else {
        console.error("Failed to load season awards", awardsResult);
        setSeasonAwards(null);
      }
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



  useEffect(() => {
    if (!slateRosterModal) {
      setSlateRosterRows([]);
      setSlateRosterTotal(0);
      return;
    }

    let isActive = true;
    const activeSlateRosterModal = slateRosterModal;

    async function loadSlateRoster() {
      try {
        setIsSlateRosterLoading(true);

        const response = await fetch(
          `/api/team-slate-roster?slateId=${activeSlateRosterModal.slateId}&teamId=${activeSlateRosterModal.teamId}`,
          { cache: "no-store" }
        );

        const result = await response.json();

        if (!isActive) return;

        if (!response.ok) {
          console.error(result.error || "Failed to load slate roster.");
          setSlateRosterRows([]);
          setSlateRosterTotal(0);
          return;
        }

        setSlateRosterRows(result.roster ?? []);
        setSlateRosterTotal(Number(result.total ?? 0));
      } catch (error) {
        console.error(error);
        if (!isActive) return;
        setSlateRosterRows([]);
        setSlateRosterTotal(0);
      } finally {
        if (isActive) setIsSlateRosterLoading(false);
      }
    }

    void loadSlateRoster();

    return () => {
      isActive = false;
    };
  }, [slateRosterModal]);



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

  const nextSlate = data?.nextSlate ?? null;

  useEffect(() => {
    if (!nextSlate?.id || !nextSlate.first_game_start_time) return;

    const tipoffMs = new Date(nextSlate.first_game_start_time).getTime();
    const delayMs = tipoffMs - Date.now();

    if (delayMs <= 0) return;

    if (autoRefreshTimerRef.current) {
      clearTimeout(autoRefreshTimerRef.current);
    }

    autoRefreshTimerRef.current = setTimeout(() => {
      void refreshSlateStatsById(nextSlate.id);
    }, delayMs);

    return () => {
      if (autoRefreshTimerRef.current) {
        clearTimeout(autoRefreshTimerRef.current);
      }
    };
  }, [nextSlate?.id, nextSlate?.first_game_start_time]);


  const nextSlateStartTime = nextSlate?.first_game_start_time
    ? new Date(nextSlate.first_game_start_time)
    : null;

  const activeSlateStartTime = latestSlate?.first_game_start_time
    ? new Date(latestSlate.first_game_start_time)
    : null;

  const hasSlateStarted =
    activeSlateStartTime !== null && activeSlateStartTime.getTime() <= Date.now();

  const shouldShowRefreshStats =
    Boolean(latestSlate) && hasSlateStarted && !latestSlate?.is_locked;

  const latestSlateIsFinal = latestSlate?.is_locked === true;

  const shouldShowTipoff =
    Boolean(nextSlateStartTime) &&
    !shouldShowRefreshStats &&
    !hasLiveGames &&
    latestSlateIsFinal;

  const tipoffTime = shouldShowTipoff && nextSlateStartTime
    ? nextSlateStartTime.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        timeZone: "America/New_York",
      })
    : null;

  const tipoffLabel = shouldShowTipoff && nextSlate
    ? `Next slate ${nextSlate.label}`
    : null;

  const slateStatusLabel = hasLiveGames
    ? "Live"
    : hasCompletedGames && !hasRemainingGames
      ? "Final"
      : latestSlate?.is_locked
        ? "Locked"
        : "Open";

  const slateDateLabel = latestSlate
    ? latestSlate.start_date === latestSlate.end_date
      ? latestSlate.start_date
      : `${latestSlate.start_date} → ${latestSlate.end_date}`
    : "No slate";

  return (
<main className="min-h-screen bg-slate-50 px-3 py-5 pb-24 text-slate-900 sm:px-4 sm:py-6 sm:pb-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <AppNav />

        <section className="rounded-3xl border border-slate-200 bg-white px-5 py-6 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm font-medium uppercase tracking-wide text-sky-700">
                League Dashboard
              </p>
              <h1 className="mt-2 text-3xl font-bold tracking-tight">
                111 NBA Fantasy Playoffs
              </h1>
              <p className="mt-2 text-sm text-slate-600">
                Quickly check scores, standings, and what’s happening in today’s slate.
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
              <div className="relative mb-4 rounded-2xl border border-orange-200 bg-orange-50 p-4">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="text-xs uppercase tracking-wide text-orange-700">
                      {leaderLabel}
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        leader &&
                        setProfileTeam({
                          id: leader.team_id,
                          name: leader.teamName,
                        })
                      }
                      className="mt-2 text-2xl font-bold text-slate-900 hover:text-sky-700 hover:underline"
                    >
                      {leader ? leader.teamName : "—"}
                    </button>
                    <div className="mt-1 text-sm text-slate-600">
                      {leader
                        ? `${roundTo(Number(leader.fantasy_points ?? 0))} pts`
                        : "—"}
                    </div>
                  </div>

                  {shouldShowRefreshStats ? (
  <button
    type="button"
    onClick={handleRefreshStats}
    className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-white px-2.5 py-1 text-xs font-semibold text-emerald-700 shadow-sm hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60 sm:static sm:text-sm"
    disabled={isRefreshingHomeStats}
  >
    {isRefreshingHomeStats ? "Refreshing..." : "🔄 Refresh"}
  </button>
) : tipoffTime ? (
                    <div className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-full border border-sky-200 bg-white px-2.5 py-1 shadow-sm sm:static sm:block sm:min-w-[150px] sm:rounded-xl sm:px-3 sm:py-2 sm:text-center">
                      <div className="text-[9px] font-semibold uppercase tracking-wide text-sky-700 sm:text-xs">
                        Tip-off
                      </div>
                      <div className="text-xs font-bold text-slate-900 sm:mt-0.5 sm:text-2xl">
                        {tipoffTime} ET
                      </div>
                      {tipoffLabel ? (
                        <div className="mt-0.5 hidden text-[10px] font-medium text-slate-500 sm:block">
                          {tipoffLabel}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-slate-600">
                <span>{slateDateLabel}</span>
                <span className="text-slate-400">•</span>
                <span>{slateStatusLabel}</span>
                <span className="text-slate-400">•</span>
                <span>{latestSlateRows.length} Teams</span>
              </div>

              <div className="overflow-hidden rounded-2xl border border-slate-200">
                <div className="-mx-4 overflow-x-auto px-4">
                  <table className="min-w-full border-collapse text-sm">
                    <thead className="bg-slate-100 text-slate-700">
                      <tr className="text-left">
                        <th className="px-4 py-3 font-semibold">Player</th>
                        <th className="px-4 py-3 font-semibold">Score</th>
                        <th className="px-4 py-3 font-semibold">Projected</th>
                        <th className="px-4 py-3 font-semibold">Win %</th>
                        <th className="px-4 py-3 font-semibold">
                          <div>Games</div>
                          <div className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
                            C/IP/R
                          </div>
                        </th>
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
                            <button
                              type="button"
                              onClick={() =>
                                setProfileTeam({
                                  id: row.team_id,
                                  name: row.teamName,
                                })
                              }
                              className="hover:text-sky-700 hover:underline"
                            >
                              {row.teamName}
                            </button>
                          </td>
                          <td className="px-4 py-3">
                            <button
                              type="button"
                              onClick={() =>
                                setSlateRosterModal({
                                  slateId: row.slate_id,
                                  teamId: row.team_id,
                                  teamName: row.teamName,
                                  slateLabel: latestSlate?.label ?? String(row.slate_id),
                                })
                              }
                              className="font-medium text-sky-700 hover:underline"
                            >
                              {roundTo(Number(row.fantasy_points ?? 0))}
                            </button>
                          </td>
                          <td className="px-4 py-3 font-semibold text-sky-700">
                            {row.projected_points !== null && row.projected_points !== undefined
                              ? roundTo(Number(row.projected_points))
                              : "—"}
                          </td>
                          <td className="px-4 py-3">
                            {row.win_probability !== null && row.win_probability !== undefined ? (
                              <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-100">
                                {roundTo(Number(row.win_probability), 0)}%
                              </span>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="px-4 py-3 font-semibold tabular-nums">
                            {row.games_completed ?? 0} / {row.games_in_progress ?? 0} / {row.games_remaining ?? 0}
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

        {seasonAwards ? (
          <SeasonAwards
            awards={seasonAwards.awards}
            guards={seasonAwards.firstTeam.guards}
            frontcourt={seasonAwards.firstTeam.frontcourt}
          />
        ) : null}

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
                    <div>
                      <div>
                        <button
                          type="button"
                          onClick={() =>
                            setProfileTeam({
                              id: row.team_id,
                              name: row.name,
                            })
                          }
                          className="font-semibold text-slate-900 hover:text-sky-700 hover:underline"
                        >
                          {row.name}
                        </button>
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
                Fun Facts
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                Tap through some extra stats.
              </p>
            </div>

            <FunFactCarousel facts={funFacts} />
          </section>
        </section>
      </div>


      {slateRosterModal ? (
        <div
          className="mobile-modal-safe fixed inset-0 z-50 flex items-end justify-center bg-slate-950/60 px-3 py-4 sm:items-center"
          onClick={() => setSlateRosterModal(null)}
        >
          <div
            className="mobile-modal-panel-safe flex max-h-[90dvh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="shrink-0 border-b border-slate-200 px-5 py-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-sky-700">
                    Slate Roster
                  </div>
                  <h3 className="mt-1 text-2xl font-bold text-slate-900">
                    {slateRosterModal.teamName}
                  </h3>
                  <p className="mt-1 text-sm text-slate-500">
                    {slateRosterModal.slateLabel} • Total {slateRosterTotal.toFixed(1)}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setSlateRosterModal(null)}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                >
                  Close
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              {isSlateRosterLoading ? (
                <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-500">
                  Loading roster...
                </div>
              ) : slateRosterRows.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-500">
                  No roster found for this slate.
                </div>
              ) : (
                <div>
                  <div className="space-y-2 sm:hidden">
                    {slateRosterRows.map((row) => (
                      <div
                        key={row.playerId}
                        className="rounded-2xl border border-slate-200 bg-white px-4 py-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-center gap-3">
                            <PlayerHeadshot
                              nbaPlayerId={row.nbaPlayerId}
                              playerName={row.name}
                              size="sm"
                            />

                            <div>
                              <div className="text-xs font-semibold text-slate-500">
                                {row.positionGroup ?? "—"}
                              </div>
                              <div className="text-base font-semibold text-slate-900">
                                {row.name}
                              </div>
                            </div>
                          </div>
                          <div className="text-right text-base font-bold text-slate-900">
                            {Number(row.fantasyPoints ?? 0).toFixed(1)}
                          </div>
                        </div>

                        <div className="mt-2 text-xs leading-relaxed text-slate-600">
                          {row.points} pts • {row.rebounds} reb • {row.assists} ast • {row.steals} stl • {row.blocks} blk • {row.turnovers} TO
                        </div>

                        <div className="mt-2 flex items-center justify-between text-xs">
                          <div className="font-semibold text-sky-700">
                            Proj: {getProjectedFantasyPoints(row).toFixed(1)}
                          </div>

                          <div className="rounded-full bg-slate-100 px-2 py-1 text-slate-600">
                            {getPlayerStatusLabel(row)}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="hidden overflow-x-auto rounded-2xl border border-slate-200 sm:block">
                  <table className="min-w-[720px] w-full text-sm">
                    <thead className="bg-slate-100 text-slate-700">
                      <tr className="text-left">
                        <th className="px-3 py-2">Pos</th>
                        <th className="px-3 py-2">Player</th>
                        <th className="px-3 py-2 text-right">PTS</th>
                        <th className="px-3 py-2 text-right">REB</th>
                        <th className="px-3 py-2 text-right">AST</th>
                        <th className="px-3 py-2 text-right">STL</th>
                        <th className="px-3 py-2 text-right">BLK</th>
                        <th className="px-3 py-2 text-right">TO</th>
                        <th className="px-3 py-2 text-right">Total</th>
                        <th className="px-3 py-2 text-right">Proj</th>
                        <th className="px-3 py-2 text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {slateRosterRows.map((row) => (
                        <tr key={row.playerId} className="border-t border-slate-100">
                          <td className="px-3 py-2 font-medium">
                            {row.positionGroup ?? "—"}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2 font-medium text-slate-900">
                              <PlayerHeadshot
                                nbaPlayerId={row.nbaPlayerId}
                                playerName={row.name}
                                size="xs"
                              />
                              <span>{row.name}</span>
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right">{row.points}</td>
                          <td className="px-3 py-2 text-right">{row.rebounds}</td>
                          <td className="px-3 py-2 text-right">{row.assists}</td>
                          <td className="px-3 py-2 text-right">{row.steals}</td>
                          <td className="px-3 py-2 text-right">{row.blocks}</td>
                          <td className="px-3 py-2 text-right">{row.turnovers}</td>
                          <td className="px-3 py-2 text-right font-semibold">
                            {Number(row.fantasyPoints ?? 0).toFixed(1)}
                          </td>

                          <td className="px-3 py-2 text-right font-semibold text-sky-700">
                            {getProjectedFantasyPoints(row).toFixed(1)}
                          </td>

                          <td className="px-3 py-2 text-right text-xs font-medium text-slate-500">
                            {getPlayerStatusLabel(row)}
                          </td>
                        </tr>
                      ))}
                      <tr className="border-t border-slate-200 bg-slate-50 font-semibold">
                        <td className="px-3 py-2" />
                        <td className="px-3 py-2">Total</td>
                        <td className="px-3 py-2 text-right" colSpan={6} />
                        <td className="px-3 py-2 text-right">
                          {slateRosterTotal.toFixed(1)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                  </div>
                </div>              )}
            </div>
          </div>
        </div>
      ) : null}

      <TeamProfileModal team={profileTeam} setTeam={setProfileTeam} />
    </main>
  );
}
