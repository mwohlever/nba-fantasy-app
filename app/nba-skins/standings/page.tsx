"use client";

import AppNav from "@/components/AppNav";
import { useEffect, useMemo, useState } from "react";

type SeasonOption = {
  season: number;
  status: "open" | "locked" | "final";
};

type Pick = {
  id: number;
  nbaTeamAbbreviation: string;
  nbaTeamName: string;
  pickType: "wins" | "losses";
  draftRound: number | null;
  finalPoints: number | null;
  record: {
    wins: number;
    losses: number;
    gamesPlayed: number;
  } | null;
};

type Standing = {
  ownerName: string;
  leagueTeamId: number | null;
  pickCount: number;
  finalTotal: number | null;
  hasCompleteFinalPoints: boolean;
  rank: number | null;
  picks: Pick[];
};

type StandingsResponse = {
  availableSeasons: SeasonOption[];
  selectedSeason: SeasonOption | null;
  standings: Standing[];
  error?: string;
};

function ordinal(value: number) {
  const remainder100 =
    value % 100;

  if (
    remainder100 >= 11 &&
    remainder100 <= 13
  ) {
    return `${value}th`;
  }

  switch (value % 10) {
    case 1:
      return `${value}st`;
    case 2:
      return `${value}nd`;
    case 3:
      return `${value}rd`;
    default:
      return `${value}th`;
  }
}

function rankLabel(rank: number | null) {
  if (rank === null) {
    return "—";
  }

  return ordinal(rank);
}

function formatSeasonLabel(season: number) {
  const end =
    String(season + 1).slice(-2);

  return `${season}-${end}`;
}

export default function NbaSkinsStandingsPage() {
  const [data, setData] =
    useState<StandingsResponse | null>(null);

  const [selectedSeason, setSelectedSeason] =
    useState<number | null>(null);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const query =
          selectedSeason === null
            ? ""
            : `?season=${selectedSeason}`;

        const response =
          await fetch(
            `/api/nba-skins/standings${query}`,
            {
              cache: "no-store",
            },
          );

        const body =
          (await response.json()) as StandingsResponse;

        if (!response.ok) {
          throw new Error(
            body.error ??
              "Failed to load NBA Skins standings.",
          );
        }

        if (cancelled) {
          return;
        }

        setData(body);

        if (
          selectedSeason === null &&
          body.selectedSeason
        ) {
          setSelectedSeason(
            body.selectedSeason.season,
          );
        }
      } catch (loadError) {
        if (cancelled) {
          return;
        }

        setError(
          loadError instanceof Error
            ? loadError.message
            : "Failed to load NBA Skins standings.",
        );
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [selectedSeason]);

  const selectedSeasonData =
    data?.selectedSeason ?? null;

  const isCompleteSeason =
    useMemo(
      () =>
        Boolean(
          data?.standings.length &&
            data.standings.every(
              (standing) =>
                standing.hasCompleteFinalPoints,
            ),
        ),
      [data],
    );

  return (
    <main className="min-h-screen bg-slate-950 px-3 py-5 pb-24 text-slate-100 sm:px-4 sm:py-6 sm:pb-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <AppNav />

        <section className="rounded-3xl border border-blue-500/30 bg-gradient-to-br from-slate-900 via-slate-900 to-blue-950 p-5 shadow-xl sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="text-xs font-black uppercase tracking-[0.2em] text-blue-300">
                NBA Skins
              </div>

              <h1 className="mt-1 text-3xl font-black tracking-tight text-white">
                Standings
              </h1>

              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
                Season results and all seven picks for each player.
              </p>
            </div>

            {data?.availableSeasons.length ? (
              <label className="flex min-w-32 flex-col gap-1">
                <span className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">
                  Season
                </span>

                <select
                  value={
                    selectedSeason ??
                    data.selectedSeason?.season ??
                    ""
                  }
                  onChange={(event) =>
                    setSelectedSeason(
                      Number(
                        event.target.value,
                      ),
                    )
                  }
                  className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-bold text-white outline-none transition focus:border-blue-500"
                >
                  {data.availableSeasons.map(
                    (season) => (
                      <option
                        key={season.season}
                        value={season.season}
                      >
                        {formatSeasonLabel(season.season)}
                      </option>
                    ),
                  )}
                </select>
              </label>
            ) : null}
          </div>
        </section>

        {loading ? (
          <section className="rounded-3xl border border-slate-800 bg-slate-900 p-8 text-center text-sm text-slate-400">
            Loading NBA Skins standings…
          </section>
        ) : error ? (
          <section className="rounded-3xl border border-red-500/30 bg-red-950/20 p-6">
            <div className="font-bold text-red-200">
              Couldn&apos;t load NBA Skins standings
            </div>

            <div className="mt-2 text-sm text-red-300/80">
              {error}
            </div>
          </section>
        ) : !data?.selectedSeason ? (
          <section className="rounded-3xl border border-slate-800 bg-slate-900 p-8 text-center text-sm text-slate-400">
            No NBA Skins seasons found.
          </section>
        ) : (
          <>
            {!isCompleteSeason ? (
              <section className="rounded-2xl border border-blue-500/20 bg-blue-950/20 px-4 py-3 text-sm text-blue-100">
                {selectedSeasonData?.season === 2025
                  ? "2025 picks are imported, but final points are intentionally not populated yet. We’ll derive them from authoritative final NBA records."
                  : selectedSeasonData?.status === "open"
                    ? "This season is open. Final standings will appear as picks and results become available."
                    : "Complete final-point data is not available for this season yet."}
              </section>
            ) : null}

            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {data.standings.map(
                (standing) => (
                  <div
                    key={standing.ownerName}
                    className="rounded-3xl border border-blue-500/25 bg-gradient-to-br from-slate-900 to-blue-950/60 p-4 shadow-sm sm:p-5"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-xs font-black uppercase tracking-[0.16em] text-blue-300">
                          {standing.rank !== null
                            ? rankLabel(
                                standing.rank,
                              )
                            : "NBA Skins"}
                        </div>

                        <div className="mt-1 text-xl font-black text-white">
                          {standing.ownerName}
                        </div>
                      </div>

                      <div className="text-right">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                          Points
                        </div>

                        <div className="mt-1 text-2xl font-black tabular-nums text-white">
                          {standing.finalTotal ??
                            "—"}
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 border-t border-slate-800 pt-3 text-xs text-slate-400">
                      {standing.pickCount}/7 picks
                    </div>
                  </div>
                ),
              )}
            </section>

            <section className="space-y-3">
              {data.standings.map(
                (standing) => (
                  <article
                    key={standing.ownerName}
                    className="overflow-hidden rounded-3xl border border-slate-700 bg-slate-900 shadow-sm"
                  >
                    <div className="flex items-center justify-between gap-4 border-b border-slate-800 px-4 py-3 sm:px-5">
                      <div>
                        <div className="text-lg font-black text-white">
                          {standing.ownerName}
                        </div>

                        <div className="mt-1 text-xs text-slate-500">
                          {standing.pickCount === 0
                            ? "No picks yet"
                            : `${standing.pickCount} of 7 teams`}
                        </div>
                      </div>

                      <div className="text-right">
                        <div className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                          Total
                        </div>

                        <div className="text-xl font-black tabular-nums text-white">
                          {standing.finalTotal ??
                            "—"}
                        </div>
                      </div>
                    </div>

                    {standing.picks.length ===
                    0 ? (
                      <div className="px-5 py-8 text-center text-sm text-slate-500">
                        No teams have been drafted for this season.
                      </div>
                    ) : (
                      <div className="divide-y divide-slate-800">
                        {standing.picks.map(
                          (pick) => (
                            <div
                              key={pick.id}
                              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 sm:grid-cols-[34px_minmax(0,1fr)_125px_64px] sm:px-5 sm:py-2.5"
                            >
                              <div className="hidden text-xs font-bold text-slate-500 sm:block">
                                {pick.draftRound !==
                                null
                                  ? `R${pick.draftRound}`
                                  : "—"}
                              </div>

                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="shrink-0 text-sm font-black text-white">
                                    {
                                      pick.nbaTeamAbbreviation
                                    }
                                  </span>

                                  <span className="truncate text-xs text-slate-500 sm:text-sm">
                                    {
                                      pick.nbaTeamName
                                    }
                                  </span>
                                </div>

                                <div className="mt-1 flex items-center gap-2 sm:hidden">
                                  {pick.draftRound !== null ? (
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                                      Round {pick.draftRound}
                                    </span>
                                  ) : null}

                                  {pick.record ? (
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                                      {pick.record.wins}-{pick.record.losses}
                                    </span>
                                  ) : null}

                                  <span
                                    className={
                                      pick.pickType ===
                                      "wins"
                                        ? "rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-emerald-300"
                                        : "rounded-full border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-rose-300"
                                    }
                                  >
                                    {pick.pickType}
                                  </span>
                                </div>
                              </div>

                              <div className="hidden sm:block">
                                <div className="flex items-center gap-2">
                                  {pick.record ? (
                                    <span className="text-xs font-bold tabular-nums text-slate-500">
                                      {pick.record.wins}-{pick.record.losses}
                                    </span>
                                  ) : null}

                                  <span
                                  className={
                                    pick.pickType ===
                                    "wins"
                                      ? "inline-flex rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-emerald-300"
                                      : "inline-flex rounded-full border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-rose-300"
                                  }
                                >
                                    {pick.pickType}
                                  </span>
                                </div>
                              </div>

                              <div className="text-right">
                                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-600">
                                  Points
                                </div>

                                <div className="text-lg font-black tabular-nums text-white">
                                  {pick.finalPoints ??
                                    "—"}
                                </div>
                              </div>
                            </div>
                          ),
                        )}
                      </div>
                    )}
                  </article>
                ),
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
