"use client";

import {
  useCallback,
  useEffect,
  useState,
} from "react";

import AppNav from "@/components/AppNav";

import TeamAvatar from "@/components/ui/TeamAvatar";

import {
  useSelectedSport,
} from "@/components/providers/SportProvider";

type StandingRow = {
  rank: number;
  teamId: number;
  name: string;
  avatarUrl: string | null;
  correct: number;
  incorrect: number;
  graded: number;
  pickPct: number | null;
  perfectWeeks: number;
  currentStreak: number;
  bestStreak: number;
};

type StandingsPayload = {
  success: boolean;
  viewerTeamId: number;
  seasons: number[];
  selectedSeason: number | null;
  standings: StandingRow[];
  error?: string;
};

function percentage(
  value: number | null,
) {
  if (value === null) {
    return "—";
  }

  return `${Math.round(
    value * 100,
  )}%`;
}

export default function NcaaPickEmStandings() {
  const {
    selectedSport,
    setSelectedSport,
  } =
    useSelectedSport();

  const [
    payload,
    setPayload,
  ] =
    useState<
      StandingsPayload | null
    >(null);

  const [
    season,
    setSeason,
  ] =
    useState<
      number | null
    >(null);

  const [
    loading,
    setLoading,
  ] =
    useState(true);

  const [
    error,
    setError,
  ] =
    useState<
      string | null
    >(null);

  useEffect(() => {
    if (
      selectedSport !==
      "ncaa"
    ) {
      setSelectedSport(
        "ncaa",
      );
    }
  }, [
    selectedSport,
    setSelectedSport,
  ]);

  const loadStandings =
    useCallback(
      async (
        requestedSeason?:
          number | null,
      ) => {
        setLoading(true);
        setError(null);

        try {
          const params =
            new URLSearchParams();

          if (
            requestedSeason
          ) {
            params.set(
              "season",
              String(
                requestedSeason,
              ),
            );
          }

          const response =
            await fetch(
              `/api/ncaa-pickem/standings${
                params.size
                  ? `?${params.toString()}`
                  : ""
              }`,
              {
                cache:
                  "no-store",
              },
            );

          const data =
            await response.json() as
              StandingsPayload;

          if (
            !response.ok
          ) {
            throw new Error(
              data.error ??
                "Unable to load standings.",
            );
          }

          setPayload(data);

          setSeason(
            data.selectedSeason,
          );
        } catch (
          loadError
        ) {
          setError(
            loadError instanceof
              Error
              ? loadError.message
              : "Unable to load standings.",
          );
        } finally {
          setLoading(false);
        }
      },
      [],
    );

  useEffect(() => {
    void loadStandings();
  }, [
    loadStandings,
  ]);

  return (
    <main className="min-h-screen bg-slate-950 px-3 py-5 pb-24 text-slate-100 sm:px-4 sm:py-6 sm:pb-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <AppNav />

        <section className="rounded-3xl border border-blue-500/30 bg-gradient-to-br from-slate-900 via-slate-900 to-blue-950 p-6 shadow-xl sm:p-8">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="text-xs font-bold uppercase tracking-[0.22em] text-blue-300">
                NCAA Pick &apos;Em
              </div>

              <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">
                Standings
              </h1>

              <p className="mt-2 text-slate-400">
                Season-long Pick &apos;Em results,
                accuracy, perfect weeks, and streaks.
              </p>
            </div>

            {payload &&
              payload.seasons.length >
                0 && (
                <label className="block min-w-40">
                  <span className="mb-2 block text-xs font-bold uppercase tracking-wider text-slate-400">
                    Season
                  </span>

                  <select
                    value={
                      season ??
                      ""
                    }
                    onChange={(
                      event,
                    ) => {
                      const next =
                        Number(
                          event
                            .target
                            .value,
                        );

                      setSeason(
                        next,
                      );

                      void loadStandings(
                        next,
                      );
                    }}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 font-bold text-white outline-none focus:border-blue-500"
                  >
                    {payload.seasons.map(
                      (
                        option,
                      ) => (
                        <option
                          key={
                            option
                          }
                          value={
                            option
                          }
                        >
                          {
                            option
                          }
                        </option>
                      ),
                    )}
                  </select>
                </label>
              )}
          </div>
        </section>

        {loading ? (
          <section className="rounded-2xl border border-slate-800 bg-slate-900 p-8 text-center text-slate-400">
            Loading standings…
          </section>
        ) : error ? (
          <section className="rounded-2xl border border-red-500/30 bg-red-950/30 p-6 text-red-200">
            {error}
          </section>
        ) : !payload ||
          payload.standings
            .length === 0 ? (
          <section className="rounded-2xl border border-slate-800 bg-slate-900 p-8 text-center text-slate-400">
            No NCAA Pick &apos;Em standings are available yet.
          </section>
        ) : (
          <>
            <section className="hidden overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 md:block">
              <div className="grid grid-cols-[64px_minmax(180px,1fr)_90px_90px_90px_110px_90px] gap-2 border-b border-slate-800 bg-slate-800/50 px-5 py-3 text-xs font-bold uppercase tracking-wider text-slate-400">
                <div>Rank</div>
                <div>Player</div>
                <div className="text-center">
                  Correct
                </div>
                <div className="text-center">
                  Wrong
                </div>
                <div className="text-center">
                  Pick %
                </div>
                <div className="text-center">
                  Perfect
                </div>
                <div className="text-center">
                  Streak
                </div>
              </div>

              {payload.standings.map(
                (row) => {
                  const viewer =
                    row.teamId ===
                    payload.viewerTeamId;

                  return (
                    <div
                      key={
                        row.teamId
                      }
                      className={`grid grid-cols-[64px_minmax(180px,1fr)_90px_90px_90px_110px_90px] items-center gap-2 border-b border-slate-800 px-5 py-4 last:border-b-0 ${
                        viewer
                          ? "bg-blue-950/35"
                          : ""
                      }`}
                    >
                      <div className="text-xl font-black">
                        #
                        {
                          row.rank
                        }
                      </div>

                      <div className="flex min-w-0 items-center gap-3">
                        <div className="shrink-0">
                          <TeamAvatar
                            teamName={
                              row.name
                            }
                            avatarUrl={
                              row.avatarUrl
                            }
                            size="md"
                          />
                        </div>

                        <div className="min-w-0">
                          <div className="truncate font-bold">
                            {
                              row.name
                            }
                          </div>

                          {viewer && (
                            <div className="text-xs font-bold text-blue-300">
                              You
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="text-center text-lg font-black">
                        {
                          row.correct
                        }
                      </div>

                      <div className="text-center text-lg font-black">
                        {
                          row.incorrect
                        }
                      </div>

                      <div className="text-center text-lg font-black">
                        {percentage(
                          row.pickPct,
                        )}
                      </div>

                      <div className="text-center text-lg font-black">
                        {
                          row.perfectWeeks
                        }
                      </div>

                      <div className="text-center">
                        <div className="text-lg font-black">
                          {
                            row.currentStreak
                          }
                        </div>

                        <div className="text-[10px] uppercase tracking-wider text-slate-500">
                          Best{" "}
                          {
                            row.bestStreak
                          }
                        </div>
                      </div>
                    </div>
                  );
                },
              )}
            </section>

            <section className="space-y-3 md:hidden">
              {payload.standings.map(
                (row) => {
                  const viewer =
                    row.teamId ===
                    payload.viewerTeamId;

                  return (
                    <article
                      key={
                        row.teamId
                      }
                      className={`rounded-2xl border p-4 ${
                        viewer
                          ? "border-blue-500/50 bg-blue-950/35"
                          : "border-slate-800 bg-slate-900"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="text-2xl font-black">
                          #
                          {
                            row.rank
                          }
                        </div>

                        <TeamAvatar
                          teamName={
                            row.name
                          }
                          avatarUrl={
                            row.avatarUrl
                          }
                          size="md"
                        />

                        <div>
                          <div className="font-black">
                            {
                              row.name
                            }
                          </div>

                          {viewer && (
                            <div className="text-xs font-bold text-blue-300">
                              You
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="mt-4 grid grid-cols-4 gap-2">
                        {[
                          [
                            "Correct",
                            String(
                              row.correct,
                            ),
                          ],
                          [
                            "Wrong",
                            String(
                              row.incorrect,
                            ),
                          ],
                          [
                            "Pick %",
                            percentage(
                              row.pickPct,
                            ),
                          ],
                          [
                            "Perfect",
                            String(
                              row.perfectWeeks,
                            ),
                          ],
                        ].map(
                          ([
                            label,
                            value,
                          ]) => (
                            <div
                              key={
                                label
                              }
                              className="rounded-xl bg-slate-950/60 p-3 text-center"
                            >
                              <div className="text-lg font-black">
                                {
                                  value
                                }
                              </div>

                              <div className="mt-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                                {
                                  label
                                }
                              </div>
                            </div>
                          ),
                        )}
                      </div>

                      <div className="mt-3 flex justify-between border-t border-slate-800 pt-3 text-sm text-slate-400">
                        <span>
                          Current streak{" "}
                          <strong className="text-white">
                            {
                              row.currentStreak
                            }
                          </strong>
                        </span>

                        <span>
                          Best{" "}
                          <strong className="text-white">
                            {
                              row.bestStreak
                            }
                          </strong>
                        </span>
                      </div>
                    </article>
                  );
                },
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
