"use client";

import AppNav from "@/components/AppNav";

import Link from "next/link";

import {
  useEffect,
  useMemo,
  useState,
} from "react";

import { getDefaultNbaSkinsRules } from "@/lib/rules/leagueRules";


const FULL_SEASON_GAMES =
  7 * 82;


const TEAM_HEADSHOTS: Record<
  string,
  string
> = {
  Andy:
    "/team-headshots/andy.jpg",

  Jon:
    "/team-headshots/jon.jpg",

  Josh:
    "/team-headshots/josh.jpg",

  Mark:
    "/team-headshots/mark.jpg",
};


type PickRecord = {
  wins: number;
  losses: number;
  gamesPlayed: number;

  projectedWins:
    | number
    | null;

  projectedLosses:
    | number
    | null;

  projectionSource:
    | string
    | null;
};


type SkinsPick = {
  id: number;
  nbaTeamAbbreviation: string;
  nbaTeamName: string;
  pickType:
    | "wins"
    | "losses";
  draftRound:
    | number
    | null;
  finalPoints:
    | number
    | null;
  record:
    | PickRecord
    | null;
};


type Standing = {
  ownerName: string;

  leagueTeamId:
    | number
    | null;

  avatarUrl:
    | string
    | null;

  pickCount: number;

  finalTotal:
    | number
    | null;

  hasCompleteFinalPoints:
    boolean;

  rank:
    | number
    | null;

  picks:
    SkinsPick[];
};


type StandingsResponse = {
  rules: {
    participantCount: number;
    nbaTeamsPerParticipant: number;
    totalPicks: number;
  };

  availableSeasons:
    Array<{
      season: number;
      status:
        | "open"
        | "locked"
        | "final";
    }>;

  selectedSeason:
    | {
        id: number;
        season: number;
        status:
          | "open"
          | "locked"
          | "final";
        participantCount: number;
        nbaTeamsPerParticipant: number;
        totalPicks: number;
      }
    | null;

  standings:
    Standing[];

  error?: string;
};


type HomeRow = Standing & {
  points: number;
  gamesPlayed: number;
  gamesLeft: number;

  accuracy:
    | number
    | null;

  pace:
    | number
    | null;

  projected:
    | number
    | null;

  possible: number;
};


function seasonLabel(
  season: number,
) {
  return `${season}-${String(
    season + 1,
  ).slice(-2)}`;
}


function roundTo(
  value: number,
  digits = 1,
) {
  return Number(
    value.toFixed(
      digits,
    ),
  );
}


function formatNumber(
  value:
    | number
    | null,
  digits = 0,
) {
  if (value === null) {
    return "—";
  }

  return value.toLocaleString(
    "en-US",
    {
      minimumFractionDigits:
        digits,
      maximumFractionDigits:
        digits,
    },
  );
}


function rowMetrics(
  standing: Standing,
): HomeRow {
  let points = 0;
  let gamesPlayed = 0;

  let projectedPoints =
    0;

  let projectedPickCount =
    0;


  standing.picks.forEach(
    (pick) => {
      if (pick.record) {
        gamesPlayed +=
          Number(
            pick.record.gamesPlayed ??
              0,
          );

        points +=
          pick.pickType ===
          "wins"
            ? Number(
                pick.record.wins ??
                  0,
              )
            : Number(
                pick.record.losses ??
                  0,
              );


        const projectionValue =
          pick.pickType ===
          "wins"
            ? pick.record
                .projectedWins
            : pick.record
                .projectedLosses;


        if (
          projectionValue !==
            null &&
          projectionValue !==
            undefined &&
          Number.isFinite(
            Number(
              projectionValue,
            ),
          )
        ) {
          projectedPoints +=
            Number(
              projectionValue,
            );

          projectedPickCount +=
            1;
        }

        return;
      }

      /*
       * Historical fallback if a finalized pick has its saved
       * points but no per-team record row.
       */
      if (
        pick.finalPoints !==
        null
      ) {
        points +=
          Number(
            pick.finalPoints,
          );
      }
    },
  );


  if (
    gamesPlayed === 0 &&
    standing.hasCompleteFinalPoints &&
    standing.finalTotal !==
      null
  ) {
    points =
      Number(
        standing.finalTotal,
      );

    gamesPlayed =
      FULL_SEASON_GAMES;
  }


  const gamesLeft =
    standing.pickCount === 7
      ? Math.max(
          FULL_SEASON_GAMES -
            gamesPlayed,
          0,
        )
      : 0;


  const accuracy =
    gamesPlayed > 0
      ? (
          points /
          gamesPlayed
        ) *
        100
      : null;


  const pace =
    accuracy !== null
      ? (
          accuracy /
          100
        ) *
        FULL_SEASON_GAMES
      : null;


  /*
   * Projected is intentionally NOT the same as Pace.
   *
   * Pace:
   *   current Skins accuracy extrapolated across all 574
   *   possible team-games.
   *
   * Projected:
   *   sum ESPN BPI projected final wins for each Wins pick
   *   and projected final losses for each Losses pick.
   *
   * A completed season resolves to the actual score.
   */
  const projected =
    gamesLeft === 0 &&
    standing.pickCount === 7
      ? points
      : (
          standing.pickCount ===
            7 &&
          projectedPickCount ===
            7
        )
        ? projectedPoints
        : null;


  return {
    ...standing,

    points,

    gamesPlayed,

    gamesLeft,

    accuracy,

    pace,

    projected,

    possible:
      points +
      gamesLeft,
  };
}


export default function NbaSkinsHomePage() {
  const [
    data,
    setData,
  ] =
    useState<
      StandingsResponse | null
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
    useState("");


  useEffect(() => {
    let cancelled =
      false;

    async function load() {
      try {
        setLoading(true);
        setError("");

        const response =
          await fetch(
            "/api/nba-skins/standings?home=1",
            {
              cache:
                "no-store",
            },
          );

        const result =
          await response.json() as StandingsResponse;

        if (!response.ok) {
          throw new Error(
            result.error ??
              "Failed to load NBA Skins standings.",
          );
        }

        if (!cancelled) {
          setData(
            result,
          );
        }
      } catch (
        loadError
      ) {
        if (!cancelled) {
          setError(
            loadError instanceof
            Error
              ? loadError.message
              : "Failed to load NBA Skins.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(
            false,
          );
        }
      }
    }

    void load();

    return () => {
      cancelled =
        true;
    };
  }, []);


  const rows =
    useMemo(
      () =>
        (
          data?.standings ??
          []
        )
          .filter(
            (standing) =>
              standing.pickCount >
              0,
          )
          .map(
            rowMetrics,
          )
          .sort(
            (a, b) => {
              if (
                b.points !==
                a.points
              ) {
                return (
                  b.points -
                  a.points
                );
              }

              return (
                (
                  b.accuracy ??
                  -1
                ) -
                (
                  a.accuracy ??
                  -1
                )
              );
            },
          ),
      [data],
    );


  const season =
    data?.selectedSeason ??
    null;


  const teamsPerParticipant =
    season?.nbaTeamsPerParticipant ??
    data?.rules.nbaTeamsPerParticipant ??
    getDefaultNbaSkinsRules().nbaTeamsPerParticipant;


  const newestAvailableSeason =
    data?.availableSeasons
      .reduce(
        (
          newest,
          entry,
        ) =>
          Math.max(
            newest,
            entry.season,
          ),
        0,
      ) ??
    0;


  const showingPreviousSeason =
    season !== null &&
    newestAvailableSeason >
      season.season;


  return (
    <main className="min-h-screen bg-slate-950 px-3 py-5 pb-24 text-slate-100 sm:px-4 sm:py-6 sm:pb-6">
      <div className="mx-auto max-w-7xl space-y-5">
        <AppNav />


        <section className="rounded-3xl border border-blue-500/30 bg-gradient-to-br from-slate-900 via-slate-900 to-blue-950 p-5 shadow-xl sm:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="text-xs font-black uppercase tracking-[0.2em] text-blue-300">
                NBA Skins
              </div>

              <h1 className="mt-1 text-3xl font-black tracking-tight text-white">
                Season Standings
              </h1>

              <p className="mt-2 text-sm text-slate-400">
                {showingPreviousSeason
                  ? `Showing ${seasonLabel(
                      season!.season,
                    )} until the ${seasonLabel(
                      newestAvailableSeason,
                    )} draft is saved.`
                  : `Points earned from each participant's ${teamsPerParticipant} Wins / Losses selections.`}
              </p>
            </div>

            {season ? (
              <div className="text-right">
                <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
                  Season
                </div>

                <div className="mt-1 text-lg font-black text-white">
                  {seasonLabel(
                    season.season,
                  )}
                </div>

                <div className="text-xs font-bold capitalize text-blue-300">
                  {season.status}
                </div>
              </div>
            ) : null}
          </div>
        </section>


        {error ? (
          <section className="rounded-3xl border border-red-500/30 bg-red-950/20 p-5 text-sm text-red-200">
            {error}
          </section>
        ) : loading ? (
          <section className="rounded-3xl border border-slate-700 bg-slate-900 p-8 text-center text-sm text-slate-400">
            Loading NBA Skins…
          </section>
        ) : !season ? (
          <section className="rounded-3xl border border-slate-700 bg-slate-900 p-8 text-center text-sm text-slate-400">
            No NBA Skins season exists yet.
          </section>
        ) : rows.length ===
          0 ? (
          <section className="rounded-3xl border border-slate-700 bg-slate-900 p-8 text-center">
            <div className="font-black text-white">
              No draft saved yet
            </div>

            <p className="mt-2 text-sm text-slate-500">
              The standings table will populate as soon as the season&apos;s
              {season.totalPicks} picks are saved.
            </p>
          </section>
        ) : (
          <section className="overflow-hidden rounded-3xl border border-slate-700 bg-slate-900 shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] border-collapse text-sm">
                <thead className="bg-blue-950/60 text-blue-100">
                  <tr>
                    <th className="px-5 py-3 text-left font-bold">
                      Team
                    </th>

                    <th className="px-4 py-3 text-right font-bold">
                      Points
                    </th>

                    <th className="px-4 py-3 text-right font-bold">
                      Accuracy
                    </th>

                    <th className="px-4 py-3 text-right font-bold">
                      Pace
                    </th>

                    <th className="px-4 py-3 text-right font-bold">
                      Projected
                    </th>

                    <th className="px-4 py-3 text-right font-bold">
                      Possible
                    </th>

                    <th className="px-5 py-3 text-right font-bold">
                      Games Left
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {rows.map(
                    (
                      row,
                      index,
                    ) => {
                      const avatar =
                        row.avatarUrl ??
                        TEAM_HEADSHOTS[
                          row.ownerName
                        ] ??
                        null;

                      const profileHref =
                        row.leagueTeamId
                          ? `/nba-skins/profile?teamId=${row.leagueTeamId}`
                          : "/nba-skins/profile";

                      return (
                        <tr
                          key={
                            row.ownerName
                          }
                          className={`border-t border-slate-800 ${
                            index === 0
                              ? "bg-blue-950/45"
                              : "bg-slate-900"
                          }`}
                        >
                          <td className="px-5 py-4">
                            <Link
                              href={
                                profileHref
                              }
                              className="inline-flex items-center gap-3 font-black text-white transition hover:text-blue-300"
                              aria-label={`View ${row.ownerName}'s NBA Skins profile`}
                            >
                              {avatar ? (
                                <img
                                  src={
                                    avatar
                                  }
                                  alt=""
                                  className="h-10 w-10 rounded-full object-cover ring-1 ring-blue-400/20"
                                />
                              ) : (
                                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-950 font-black text-blue-200">
                                  {row.ownerName.slice(
                                    0,
                                    1,
                                  )}
                                </span>
                              )}

                              <span>
                                {
                                  row.ownerName
                                }

                                {index ===
                                0 ? (
                                  <span className="ml-2 text-xs text-blue-300">
                                    ›
                                  </span>
                                ) : (
                                  <span className="ml-2 text-xs text-slate-500">
                                    ›
                                  </span>
                                )}
                              </span>
                            </Link>
                          </td>

                          <td className="px-4 py-4 text-right text-lg font-black tabular-nums text-white">
                            {
                              row.points
                            }
                          </td>

                          <td className="px-4 py-4 text-right font-bold tabular-nums text-slate-200">
                            {row.accuracy ===
                            null
                              ? "—"
                              : `${formatNumber(
                                  row.accuracy,
                                  1,
                                )}%`}
                          </td>

                          <td className="px-4 py-4 text-right font-bold tabular-nums text-blue-200">
                            {formatNumber(
                              row.pace,
                              1,
                            )}
                          </td>

                          <td className="px-4 py-4 text-right font-bold tabular-nums text-slate-300">
                            {formatNumber(
                              row.projected,
                              1,
                            )}
                          </td>

                          <td className="px-4 py-4 text-right font-bold tabular-nums text-slate-200">
                            {
                              row.possible
                            }
                          </td>

                          <td className="px-5 py-4 text-right font-bold tabular-nums text-slate-300">
                            {
                              row.gamesLeft
                            }
                          </td>
                        </tr>
                      );
                    },
                  )}
                </tbody>
              </table>
            </div>


            <div className="border-t border-slate-800 px-5 py-3 text-[11px] leading-5 text-slate-500">
              <strong className="text-slate-400">
                Pace
              </strong>{" "}
              extrapolates current accuracy across all 574 team-games.{" "}
              <strong className="text-slate-400">
                Projected
              </strong>{" "}
              uses ESPN BPI projected final NBA team records for each drafted
              Wins / Losses selection.
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
