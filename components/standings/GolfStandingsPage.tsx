"use client";

import AppNav from "@/components/AppNav";
import TeamProfileModal from "@/components/TeamProfileModal";
import TeamAvatar from "@/components/ui/TeamAvatar";

import {
  useEffect,
  useMemo,
  useState,
} from "react";

type TournamentState =
  | "final"
  | "live"
  | "upcoming";

const GOLF_ROUNDS =
  [1, 2, 3, 4] as const;

type GolfRoundNumber =
  (typeof GOLF_ROUNDS)[number];

type TournamentHistoryRow = {
  slate_id: number;
  tournament_name: string;
  start_date: string;
  state: TournamentState;
  score: number | null;
  finish_position: number | null;
};

type AverageRoundScore = {
  round_number: number;
  average_score: number | null;
  observation_count: number;
};

type GolfStanding = {
  team_id: number;
  name: string;

  wins: number;
  runner_ups: number;
  podiums: number;

  avg_finish: number | null;
  tournaments_played: number;

  total_to_par: number;
  avg_tournament_score:
    | number
    | null;

  best_tournament_score:
    | number
    | null;

  birdies: number;
  eagles_or_better: number;
  pars: number;
  bogeys: number;
  double_bogeys_or_worse: number;
  rounds_under_par: number;

  average_round_scores:
    AverageRoundScore[];

  tournament_history:
    TournamentHistoryRow[];
};

type GolfStandingsResponse = {
  success: boolean;

  selectedSeason:
    | number
    | "all";

  availableSeasons:
    number[];

  finalizedTournaments:
    number;

  liveTournaments:
    number;

  upcomingTournaments:
    number;

  standings:
    GolfStanding[];

  error?: string;
};

function formatScore(
  value:
    | number
    | null
    | undefined,
  digits = 0,
) {
  if (
    value === null ||
    value === undefined
  ) {
    return "—";
  }

  const rounded =
    Number(
      value.toFixed(
        digits,
      ),
    );

  if (rounded === 0) {
    return "E";
  }

  return rounded > 0
    ? `+${rounded}`
    : String(rounded);
}

function formatFinish(
  value:
    | number
    | null
    | undefined,
) {
  if (
    value === null ||
    value === undefined
  ) {
    return "—";
  }

  return Number(
    value,
  ).toFixed(2);
}

function finishLabel(
  value:
    | number
    | null
    | undefined,
) {
  if (
    value === null ||
    value === undefined
  ) {
    return "—";
  }

  const number =
    Number(value);

  if (number === 1) {
    return "🥇 1st";
  }

  if (number === 2) {
    return "🥈 2nd";
  }

  if (number === 3) {
    return "🥉 3rd";
  }

  const remainder100 =
    number % 100;

  const suffix =
    remainder100 >= 11 &&
    remainder100 <= 13
      ? "th"
      : number % 10 === 1
        ? "st"
        : number % 10 === 2
          ? "nd"
          : number % 10 === 3
            ? "rd"
            : "th";

  return `${number}${suffix}`;
}

function rankDisplay(
  index: number,
) {
  if (index === 0) {
    return "🥇";
  }

  if (index === 1) {
    return "🥈";
  }

  if (index === 2) {
    return "🥉";
  }

  return `${index + 1}.`;
}

function tournamentStateBadge(
  state: TournamentState,
) {
  if (
    state === "live"
  ) {
    return {
      label: "LIVE",
      className:
        "border-emerald-500/50 bg-emerald-950 text-emerald-300",
    };
  }

  if (
    state ===
    "upcoming"
  ) {
    return {
      label:
        "UPCOMING",
      className:
        "border-sky-500/40 bg-sky-950 text-sky-300",
    };
  }

  return {
    label: "FINAL",
    className:
      "border-slate-700 bg-slate-900 text-slate-400",
  };
}

export default function GolfStandingsPage() {
  const [
    standings,
    setStandings,
  ] =
    useState<
      GolfStanding[]
    >([]);

  const [
    availableSeasons,
    setAvailableSeasons,
  ] =
    useState<
      number[]
    >([]);

  const [
    selectedSeason,
    setSelectedSeason,
  ] =
    useState<
      number | "all"
    >("all");

  const [
    finalizedTournaments,
    setFinalizedTournaments,
  ] =
    useState(0);

  const [
    liveTournaments,
    setLiveTournaments,
  ] =
    useState(0);

  const [
    upcomingTournaments,
    setUpcomingTournaments,
  ] =
    useState(0);

  const [
    expandedTeamId,
    setExpandedTeamId,
  ] =
    useState<
      number | null
    >(null);

  const [
    isLoading,
    setIsLoading,
  ] =
    useState(true);

  const [
    message,
    setMessage,
  ] =
    useState("");

  const [
    profileTeam,
    setProfileTeam,
  ] =
    useState<{
      id: number;
      name: string;
    } | null>(null);

  const [
    roundSort,
    setRoundSort,
  ] = useState<{
    roundNumber: GolfRoundNumber;
    direction: "best" | "worst";
  } | null>(null);

  async function loadStandings(
    season?:
      | number
      | "all",
  ) {
    try {
      setIsLoading(true);
      setMessage("");

      const query =
        season ===
          undefined
          ? ""
          : `?season=${season}`;

      const response =
        await fetch(
          `/api/golf-standings${query}`,
          {
            cache:
              "no-store",
          },
        );

      const result =
        (await response.json()) as GolfStandingsResponse;

      if (
        !response.ok
      ) {
        setMessage(
          result.error ||
            "Unable to load Golf standings.",
        );

        return;
      }

      setStandings(
        result.standings ??
          [],
      );

      setAvailableSeasons(
        result.availableSeasons ??
          [],
      );

      setSelectedSeason(
        result.selectedSeason ??
          season ??
          "all",
      );

      setFinalizedTournaments(
        Number(
          result.finalizedTournaments ??
            0,
        ),
      );

      setLiveTournaments(
        Number(
          result.liveTournaments ??
            0,
        ),
      );

      setUpcomingTournaments(
        Number(
          result.upcomingTournaments ??
            0,
        ),
      );
    } catch (error) {
      console.error(
        "Unable to load Golf standings",
        error,
      );

      setMessage(
        "Unable to load Golf standings.",
      );
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadStandings();
  }, []);

  const seasonLeader =
    standings[0] ??
    null;

  const mostWins =
    useMemo(
      () =>
        [...standings]
          .filter(
            (row) =>
              row.tournaments_played >
              0,
          )
          .sort(
            (a, b) =>
              b.wins -
                a.wins ||
              b.podiums -
                a.podiums ||
              Number(
                a.avg_finish ??
                  999,
              ) -
                Number(
                  b.avg_finish ??
                    999,
                ),
          )[0] ??
        null,
      [standings],
    );

  const mostPodiums =
    useMemo(
      () =>
        [...standings]
          .filter(
            (row) =>
              row.tournaments_played >
              0,
          )
          .sort(
            (a, b) =>
              b.podiums -
                a.podiums ||
              b.wins -
                a.wins ||
              Number(
                a.avg_finish ??
                  999,
              ) -
                Number(
                  b.avg_finish ??
                    999,
                ),
          )[0] ??
        null,
      [standings],
    );

  const lowestAverage =
    useMemo(
      () =>
        [...standings]
          .filter(
            (row) =>
              row.avg_tournament_score !==
              null,
          )
          .sort(
            (a, b) =>
              Number(
                a.avg_tournament_score,
              ) -
              Number(
                b.avg_tournament_score,
              ),
          )[0] ??
        null,
      [standings],
    );

  const roundComparisonStandings =
    useMemo(() => {
      if (!roundSort) {
        return standings;
      }

      return [...standings].sort(
        (a, b) => {
          const aScore =
            a.average_round_scores.find(
              (round) =>
                round.round_number ===
                roundSort.roundNumber,
            )?.average_score ??
            null;

          const bScore =
            b.average_round_scores.find(
              (round) =>
                round.round_number ===
                roundSort.roundNumber,
            )?.average_score ??
            null;

          if (aScore === null) {
            return bScore === null
              ? 0
              : 1;
          }

          if (bScore === null) {
            return -1;
          }

          return roundSort.direction ===
            "best"
            ? aScore - bScore
            : bScore - aScore;
        },
      );
    }, [roundSort, standings]);

  const overviewCards = [
    {
      eyebrow:
        "Season leader",
      value:
        seasonLeader?.name ??
        "—",
      detail:
        seasonLeader &&
        seasonLeader.tournaments_played >
          0
          ? `${seasonLeader.wins} win${seasonLeader.wins === 1 ? "" : "s"} · ${seasonLeader.podiums} podium${seasonLeader.podiums === 1 ? "" : "s"}`
          : "No finalized tournaments",
      emoji: "🏆",
    },
    {
      eyebrow:
        "Most wins",
      value:
        mostWins?.name ??
        "—",
      detail:
        mostWins
          ? `${mostWins.wins} win${mostWins.wins === 1 ? "" : "s"}`
          : "No finalized tournaments",
      emoji: "🥇",
    },
    {
      eyebrow:
        "Most podiums",
      value:
        mostPodiums?.name ??
        "—",
      detail:
        mostPodiums
          ? `${mostPodiums.podiums} podium${mostPodiums.podiums === 1 ? "" : "s"}`
          : "No finalized tournaments",
      emoji: "🥉",
    },
    {
      eyebrow:
        "Lowest avg score",
      value:
        lowestAverage
          ? formatScore(
              lowestAverage.avg_tournament_score,
              2,
            )
          : "—",
      detail:
        lowestAverage?.name ??
        "No finalized tournaments",
      emoji: "📉",
    },
  ];

  return (
    <main className="min-h-screen bg-slate-950 px-3 py-5 pb-24 text-slate-100 sm:px-4 sm:py-6 sm:pb-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <AppNav />

        <section className="overflow-hidden rounded-3xl border border-emerald-800/60 bg-gradient-to-br from-emerald-950 via-slate-950 to-slate-950 shadow-sm">
          <div className="px-5 py-6 sm:px-6">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <div className="text-xs font-black uppercase tracking-[0.18em] text-emerald-300">
                  Golf season
                </div>

                <h1 className="mt-1 text-3xl font-black sm:text-4xl">
                  Championship Race
                </h1>

                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
                  Finalized tournaments determine wins,
                  podiums, average finish, and season
                  scoring. Live hole stats continue
                  updating as play happens.
                </p>
              </div>

              <label className="block">
                <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  Season
                </span>

                <select
                  value={
                    selectedSeason
                  }
                  onChange={(
                    event,
                  ) => {
                    const value =
                      event
                        .target
                        .value ===
                      "all"
                        ? "all"
                        : Number(
                            event
                              .target
                              .value,
                          );

                    setSelectedSeason(
                      value,
                    );

                    setExpandedTeamId(
                      null,
                    );

                    void loadStandings(
                      value,
                    );
                  }}
                  className="min-w-[150px] rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm font-semibold text-white"
                >
                  <option value="all">
                    All-Time
                  </option>

                  {availableSeasons.map(
                    (
                      season,
                    ) => (
                      <option
                        key={
                          season
                        }
                        value={
                          season
                        }
                      >
                        {
                          season
                        }
                      </option>
                    ),
                  )}
                </select>
              </label>
            </div>

            <div className="mt-5 flex flex-wrap gap-2 text-[10px] font-black uppercase tracking-wider">
              <span className="rounded-full border border-slate-700 bg-slate-900/80 px-3 py-1.5 text-slate-300">
                {
                  finalizedTournaments
                }{" "}
                Final
              </span>

              {liveTournaments >
              0 ? (
                <span className="rounded-full border border-emerald-600/50 bg-emerald-950 px-3 py-1.5 text-emerald-300">
                  {
                    liveTournaments
                  }{" "}
                  Live
                </span>
              ) : null}

              {upcomingTournaments >
              0 ? (
                <span className="rounded-full border border-sky-700/50 bg-sky-950 px-3 py-1.5 text-sky-300">
                  {
                    upcomingTournaments
                  }{" "}
                  Upcoming
                </span>
              ) : null}
            </div>
          </div>
        </section>

        {message ? (
          <section className="rounded-2xl border border-red-800 bg-red-950/50 px-4 py-3 text-sm text-red-200">
            {message}
          </section>
        ) : null}

        {isLoading ? (
          <section className="rounded-3xl border border-slate-800 bg-slate-900 px-5 py-12 text-center text-sm text-slate-400">
            Loading Golf
            standings...
          </section>
        ) : (
          <>
            <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {overviewCards.map(
                (card) => (
                  <div
                    key={
                      card.eyebrow
                    }
                    className="rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">
                        {
                          card.eyebrow
                        }
                      </span>

                      <span className="text-lg">
                        {
                          card.emoji
                        }
                      </span>
                    </div>

                    <strong className="mt-2 block truncate text-lg font-black text-white sm:text-xl">
                      {
                        card.value
                      }
                    </strong>

                    <span className="mt-1 block truncate text-[11px] text-slate-400">
                      {
                        card.detail
                      }
                    </span>
                  </div>
                ),
              )}
            </section>

            <section className="overflow-hidden rounded-3xl border border-slate-800 bg-slate-900 shadow-sm">
              <header className="border-b border-slate-800 px-5 py-4">
                <div className="text-[10px] font-black uppercase tracking-[0.16em] text-emerald-400">
                  Season race
                </div>

                <h2 className="mt-1 text-xl font-black">
                  Team Standings
                </h2>

                <p className="mt-1 text-xs text-slate-500">
                  Only completed
                  tournaments count
                  toward the season
                  standings.
                </p>
              </header>

              <div className="grid gap-3 p-4 sm:hidden">
                {standings.map(
                  (
                    row,
                    index,
                  ) => {
                    const expanded =
                      expandedTeamId ===
                      row.team_id;

                    return (
                      <div
                        key={
                          row.team_id
                        }
                        className={`overflow-hidden rounded-2xl border ${
                          index ===
                          0
                            ? "border-emerald-500 bg-emerald-950/40"
                            : "border-slate-800 bg-slate-950"
                        }`}
                      >
                        <div className="p-4">
                          <div className="flex items-center justify-between gap-3">
                            <button
                              type="button"
                              onClick={() =>
                                setProfileTeam(
                                  {
                                    id: row.team_id,
                                    name: row.name,
                                  },
                                )
                              }
                              className="flex min-w-0 items-center gap-3 text-left"
                            >
                              <span className="text-xl">
                                {rankDisplay(
                                  index,
                                )}
                              </span>

                              <TeamAvatar
                                teamName={
                                  row.name
                                }
                                size="sm"
                              />

                              <strong className="truncate text-base">
                                {
                                  row.name
                                }
                              </strong>
                            </button>

                            <strong className="text-2xl font-black text-emerald-300">
                              {
                                row.wins
                              }{" "}
                              W
                            </strong>
                          </div>

                          <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                            <div className="rounded-xl bg-slate-900 px-2 py-2">
                              <span className="block text-[9px] uppercase text-slate-500">
                                Podiums
                              </span>

                              <strong className="mt-1 block">
                                {
                                  row.podiums
                                }
                              </strong>
                            </div>

                            <div className="rounded-xl bg-slate-900 px-2 py-2">
                              <span className="block text-[9px] uppercase text-slate-500">
                                Avg finish
                              </span>

                              <strong className="mt-1 block">
                                {formatFinish(
                                  row.avg_finish,
                                )}
                              </strong>
                            </div>

                            <div className="rounded-xl bg-slate-900 px-2 py-2">
                              <span className="block text-[9px] uppercase text-slate-500">
                                Avg score
                              </span>

                              <strong className="mt-1 block">
                                {formatScore(
                                  row.avg_tournament_score,
                                  2,
                                )}
                              </strong>
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() =>
                              setExpandedTeamId(
                                expanded
                                  ? null
                                  : row.team_id,
                              )
                            }
                            className="mt-3 w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-bold text-slate-300"
                          >
                            {expanded
                              ? "Hide tournament results"
                              : "Tournament results"}
                          </button>
                        </div>

                        {expanded ? (
                          <TournamentHistory
                            history={
                              row.tournament_history
                            }
                          />
                        ) : null}
                      </div>
                    );
                  },
                )}
              </div>

              <div className="hidden overflow-x-auto sm:block">
                <table className="min-w-[840px] w-full border-collapse text-sm">
                  <thead className="bg-slate-950 text-left text-[10px] uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="px-4 py-3">
                        Rank
                      </th>

                      <th className="px-3 py-3">
                        Team
                      </th>

                      <th className="px-3 py-3 text-center">
                        Wins
                      </th>

                      <th className="px-3 py-3 text-center">
                        Podiums
                      </th>

                      <th className="px-3 py-3 text-center">
                        Avg Finish
                      </th>

                      <th className="px-3 py-3 text-center">
                        Avg Score
                      </th>

                      <th className="px-3 py-3 text-center">
                        Events
                      </th>

                      <th className="px-3 py-3 text-center">
                        Results
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {standings.map(
                      (
                        row,
                        index,
                      ) => {
                        const expanded =
                          expandedTeamId ===
                          row.team_id;

                        return (
                          <FragmentRow
                            key={
                              row.team_id
                            }
                            row={
                              row
                            }
                            index={
                              index
                            }
                            expanded={
                              expanded
                            }
                            onTeam={() =>
                              setProfileTeam(
                                {
                                  id: row.team_id,
                                  name: row.name,
                                },
                              )
                            }
                            onToggle={() =>
                              setExpandedTeamId(
                                expanded
                                  ? null
                                  : row.team_id,
                              )
                            }
                          />
                        );
                      },
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="overflow-hidden rounded-3xl border border-slate-800 bg-slate-900 shadow-sm">
              <header className="border-b border-slate-800 px-5 py-4">
                <div className="text-[10px] font-black uppercase tracking-[0.16em] text-emerald-400">
                  Round comparison
                </div>

                <h2 className="mt-1 text-xl font-black">
                  Average Score by Round
                </h2>

                <p className="mt-1 text-xs text-slate-500">
                  Completed full-team
                  rounds from finalized
                  tournaments.
                </p>
              </header>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[680px] border-collapse text-sm">
                  <thead className="bg-slate-950 text-left text-[10px] uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="sticky left-0 z-10 bg-slate-950 px-4 py-3">
                        Team
                      </th>

                      {GOLF_ROUNDS.map(
                        (roundNumber) => (
                          <th
                            key={
                              roundNumber
                            }
                            aria-sort={
                              roundSort?.roundNumber ===
                              roundNumber
                                ? roundSort.direction ===
                                  "best"
                                  ? "ascending"
                                  : "descending"
                                : "none"
                            }
                            className={`px-3 py-2 text-center ${
                              roundSort?.roundNumber ===
                              roundNumber
                                ? "bg-emerald-950/50 text-emerald-300"
                                : ""
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() =>
                                setRoundSort(
                                  (current) => ({
                                    roundNumber,
                                    direction:
                                      current?.roundNumber ===
                                        roundNumber &&
                                      current.direction ===
                                        "best"
                                        ? "worst"
                                        : "best",
                                  }),
                                )
                              }
                              className="inline-flex min-h-7 items-center justify-center gap-1 rounded-md px-2 font-black hover:bg-slate-800 hover:text-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                            >
                              R{roundNumber}

                              <span
                                aria-hidden="true"
                                className={
                                  roundSort?.roundNumber ===
                                  roundNumber
                                    ? "text-emerald-300"
                                    : "text-slate-600"
                                }
                              >
                                {roundSort?.roundNumber ===
                                roundNumber
                                  ? roundSort.direction ===
                                    "best"
                                    ? "↑"
                                    : "↓"
                                  : "↕"}
                              </span>
                            </button>
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>

                  <tbody>
                    {roundComparisonStandings.map(
                      (row) => (
                        <tr
                          key={
                            row.team_id
                          }
                          className="border-t border-slate-800"
                        >
                          <td className="sticky left-0 z-10 bg-slate-900 px-4 py-3">
                            <button
                              type="button"
                              onClick={() =>
                                setProfileTeam(
                                  {
                                    id: row.team_id,
                                    name: row.name,
                                  },
                                )
                              }
                              className="flex items-center gap-2 font-bold"
                            >
                              <TeamAvatar
                                teamName={
                                  row.name
                                }
                                size="xs"
                              />

                              <span className="max-w-32 truncate">
                                {
                                  row.name
                                }
                              </span>
                            </button>
                          </td>

                          {GOLF_ROUNDS.map(
                            (roundNumber) => {
                              const round =
                                row.average_round_scores.find(
                                  (item) =>
                                    item.round_number ===
                                    roundNumber,
                                );

                              const count =
                                round?.observation_count ??
                                0;

                              return (
                                <td
                                  key={
                                    roundNumber
                                  }
                                  className="px-3 py-3 text-center"
                                >
                                  <strong className="font-black text-emerald-300">
                                    {formatScore(
                                      round?.average_score,
                                      2,
                                    )}
                                  </strong>

                                  <span className="ml-1.5 whitespace-nowrap text-[11px] text-slate-500">
                                    · {count}{" "}
                                    {count ===
                                    1
                                      ? "round"
                                      : "rounds"}
                                  </span>
                                </td>
                              );
                            },
                          )}
                        </tr>
                      ),
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="overflow-hidden rounded-3xl border border-slate-800 bg-slate-900 shadow-sm">
              <header className="border-b border-slate-800 px-5 py-4">
                <div className="text-[10px] font-black uppercase tracking-[0.16em] text-emerald-400">
                  Live performance
                </div>

                <h2 className="mt-1 text-xl font-black">
                  Scoring Totals
                </h2>

                <p className="mt-1 text-xs text-slate-500">
                  Includes current
                  tournament play as it
                  happens.
                </p>
              </header>

              <div className="grid grid-cols-2 gap-3 p-4 sm:hidden">
                {standings.map(
                  (row) => (
                    <div
                      key={
                        row.team_id
                      }
                      className="rounded-2xl border border-slate-800 bg-slate-950 p-4"
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setProfileTeam(
                            {
                              id: row.team_id,
                              name: row.name,
                            },
                          )
                        }
                        className="flex items-center gap-2 text-left"
                      >
                        <TeamAvatar
                          teamName={
                            row.name
                          }
                          size="xs"
                        />

                        <strong className="truncate text-sm">
                          {
                            row.name
                          }
                        </strong>
                      </button>

                      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                        <Stat
                          label="Birdies"
                          value={
                            row.birdies
                          }
                        />

                        <Stat
                          label="Eagles+"
                          value={
                            row.eagles_or_better
                          }
                        />

                        <Stat
                          label="Bogeys"
                          value={
                            row.bogeys
                          }
                        />

                        <Stat
                          label="Double+"
                          value={
                            row.double_bogeys_or_worse
                          }
                        />

                        <Stat
                          label="Under par"
                          value={
                            row.rounds_under_par
                          }
                        />

                        <Stat
                          label="Pars"
                          value={
                            row.pars
                          }
                        />
                      </div>
                    </div>
                  ),
                )}
              </div>

              <div className="hidden overflow-x-auto sm:block">
                <table className="min-w-[760px] w-full border-collapse text-sm">
                  <thead className="bg-slate-950 text-left text-[10px] uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="px-4 py-3">
                        Team
                      </th>

                      <th className="px-3 py-3 text-center">
                        Eagles+
                      </th>

                      <th className="px-3 py-3 text-center">
                        Birdies
                      </th>

                      <th className="px-3 py-3 text-center">
                        Pars
                      </th>

                      <th className="px-3 py-3 text-center">
                        Bogeys
                      </th>

                      <th className="px-3 py-3 text-center">
                        Double+
                      </th>

                      <th className="px-3 py-3 text-center">
                        Under-par rounds
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {standings.map(
                      (row) => (
                        <tr
                          key={
                            row.team_id
                          }
                          className="border-t border-slate-800"
                        >
                          <td className="px-4 py-3">
                            <button
                              type="button"
                              onClick={() =>
                                setProfileTeam(
                                  {
                                    id: row.team_id,
                                    name: row.name,
                                  },
                                )
                              }
                              className="flex items-center gap-3 font-bold"
                            >
                              <TeamAvatar
                                teamName={
                                  row.name
                                }
                                size="sm"
                              />

                              {
                                row.name
                              }
                            </button>
                          </td>

                          <td className="px-3 py-3 text-center font-black text-emerald-300">
                            {
                              row.eagles_or_better
                            }
                          </td>

                          <td className="px-3 py-3 text-center text-emerald-200">
                            {
                              row.birdies
                            }
                          </td>

                          <td className="px-3 py-3 text-center">
                            {
                              row.pars
                            }
                          </td>

                          <td className="px-3 py-3 text-center text-amber-300">
                            {
                              row.bogeys
                            }
                          </td>

                          <td className="px-3 py-3 text-center font-bold text-red-400">
                            {
                              row.double_bogeys_or_worse
                            }
                          </td>

                          <td className="px-3 py-3 text-center">
                            {
                              row.rounds_under_par
                            }
                          </td>
                        </tr>
                      ),
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </div>

      <TeamProfileModal
        team={
          profileTeam
        }
        setTeam={
          setProfileTeam
        }
      />
    </main>
  );
}

function TournamentHistory({
  history,
}: {
  history:
    TournamentHistoryRow[];
}) {
  if (
    history.length ===
    0
  ) {
    return (
      <div className="border-t border-slate-800 px-4 py-4 text-xs text-slate-500">
        No tournament
        history yet.
      </div>
    );
  }

  return (
    <div className="border-t border-slate-800 bg-slate-950/70">
      {history.map(
        (item) => {
          const badge =
            tournamentStateBadge(
              item.state,
            );

          return (
            <div
              key={
                item.slate_id
              }
              className="flex items-center justify-between gap-3 border-b border-slate-800/80 px-4 py-3 last:border-b-0"
            >
              <div className="min-w-0">
                <strong className="block truncate text-sm text-white">
                  {
                    item.tournament_name
                  }
                </strong>

                <div className="mt-1 flex items-center gap-2">
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[9px] font-black tracking-wider ${badge.className}`}
                  >
                    {
                      badge.label
                    }
                  </span>

                  {item.state ===
                  "final" ? (
                    <span className="text-[11px] text-slate-400">
                      {finishLabel(
                        item.finish_position,
                      )}
                    </span>
                  ) : null}
                </div>
              </div>

              <strong className="shrink-0 text-lg font-black text-emerald-300">
                {formatScore(
                  item.score,
                )}
              </strong>
            </div>
          );
        },
      )}
    </div>
  );
}

function FragmentRow({
  row,
  index,
  expanded,
  onTeam,
  onToggle,
}: {
  row: GolfStanding;
  index: number;
  expanded: boolean;
  onTeam: () => void;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        className={`border-t border-slate-800 ${
          index === 0
            ? "bg-emerald-950/30"
            : ""
        }`}
      >
        <td className="px-4 py-3 font-black">
          {rankDisplay(
            index,
          )}
        </td>

        <td className="px-3 py-3">
          <button
            type="button"
            onClick={
              onTeam
            }
            className="flex items-center gap-3 font-bold"
          >
            <TeamAvatar
              teamName={
                row.name
              }
              size="sm"
            />

            {
              row.name
            }
          </button>
        </td>

        <td className="px-3 py-3 text-center font-black">
          {row.wins}
        </td>

        <td className="px-3 py-3 text-center">
          {
            row.podiums
          }
        </td>

        <td className="px-3 py-3 text-center">
          {formatFinish(
            row.avg_finish,
          )}
        </td>

        <td className="px-3 py-3 text-center font-black text-emerald-300">
          {formatScore(
            row.avg_tournament_score,
            2,
          )}
        </td>

        <td className="px-3 py-3 text-center">
          {
            row.tournaments_played
          }
        </td>

        <td className="px-3 py-3 text-center">
          <button
            type="button"
            onClick={
              onToggle
            }
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-[11px] font-bold text-slate-300 hover:border-emerald-600 hover:text-emerald-300"
          >
            {expanded
              ? "Hide"
              : "View"}
          </button>
        </td>
      </tr>

      {expanded ? (
        <tr className="border-t border-slate-800">
          <td
            colSpan={8}
            className="p-0"
          >
            <TournamentHistory
              history={
                row.tournament_history
              }
            />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function Stat({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-slate-500">
        {label}
      </span>

      <strong className="text-white">
        {value}
      </strong>
    </div>
  );
}
