"use client";

import AppNav from "@/components/AppNav";
import TeamProfileModal from "@/components/TeamProfileModal";
import TeamAvatar from "@/components/ui/TeamAvatar";
import {
  useEffect,
  useState,
} from "react";

type GolfStanding = {
  team_id: number;
  name: string;
  wins: number;
  runner_ups: number;
  avg_finish: number | null;
  tournaments_played: number;
  total_to_par: number;
  avg_tournament_score: number | null;
  best_tournament_score: number | null;
  birdies: number;
  eagles_or_better: number;
  pars: number;
  bogeys: number;
  double_bogeys_or_worse: number;
  rounds_under_par: number;
};

type GolfStandingsResponse = {
  success: boolean;
  selectedSeason: number | "all";
  availableSeasons: number[];
  standings: GolfStanding[];
  error?: string;
};

function formatScore(
  value: number | null | undefined,
  digits = 0,
) {
  if (value === null || value === undefined) {
    return "—";
  }

  const rounded = Number(value.toFixed(digits));

  if (rounded === 0) return "E";

  return rounded > 0
    ? `+${rounded}`
    : String(rounded);
}

function formatFinish(
  value: number | null | undefined,
) {
  if (value === null || value === undefined) {
    return "—";
  }

  return Number(value).toFixed(2);
}

export default function GolfStandingsPage() {
  const [standings, setStandings] =
    useState<GolfStanding[]>([]);

  const [
    availableSeasons,
    setAvailableSeasons,
  ] = useState<number[]>([]);

  const [
    selectedSeason,
    setSelectedSeason,
  ] = useState<number | "all">("all");

  const [isLoading, setIsLoading] =
    useState(true);

  const [message, setMessage] =
    useState("");

  const [profileTeam, setProfileTeam] =
    useState<{
      id: number;
      name: string;
    } | null>(null);

  async function loadStandings(
    season: number | "all" = selectedSeason,
  ) {
    try {
      setIsLoading(true);
      setMessage("");

      const response = await fetch(
        `/api/golf-standings?season=${season}`,
        {
          cache: "no-store",
        },
      );

      const result =
        (await response.json()) as GolfStandingsResponse;

      if (!response.ok) {
        setMessage(
          result.error ||
            "Unable to load Golf standings.",
        );
        return;
      }

      setStandings(result.standings ?? []);
      setAvailableSeasons(
        result.availableSeasons ?? [],
      );
      setSelectedSeason(
        result.selectedSeason ?? season,
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
    void loadStandings("all");
  }, []);

  return (
    <main className="min-h-screen bg-slate-950 px-3 py-5 pb-24 text-slate-100 sm:px-4 sm:py-6 sm:pb-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <AppNav />

        <section className="rounded-3xl border border-emerald-800/60 bg-gradient-to-br from-emerald-950 to-slate-950 px-5 py-5 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="text-xs font-black uppercase tracking-[0.18em] text-emerald-300">
                Golf season
              </div>

              <h1 className="mt-1 text-3xl font-black">
                Standings
              </h1>

              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
                Tournament results and cumulative
                hole-by-hole scoring for every fantasy
                team.
              </p>
            </div>

            <label className="block">
              <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">
                Season
              </span>

              <select
                value={selectedSeason}
                onChange={(event) => {
                  const value =
                    event.target.value === "all"
                      ? "all"
                      : Number(
                          event.target.value,
                        );

                  setSelectedSeason(value);
                  void loadStandings(value);
                }}
                className="min-w-[150px] rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm font-semibold text-white"
              >
                <option value="all">
                  All-Time
                </option>

                {availableSeasons.map(
                  (season) => (
                    <option
                      key={season}
                      value={season}
                    >
                      {season}
                    </option>
                  ),
                )}
              </select>
            </label>
          </div>
        </section>

        {message ? (
          <section className="rounded-2xl border border-red-800 bg-red-950/50 px-4 py-3 text-sm text-red-200">
            {message}
          </section>
        ) : null}

        {isLoading ? (
          <section className="rounded-3xl border border-slate-800 bg-slate-900 px-5 py-12 text-center text-sm text-slate-400">
            Loading Golf standings...
          </section>
        ) : (
          <>
            <section className="overflow-hidden rounded-3xl border border-slate-800 bg-slate-900 shadow-sm">
              <header className="border-b border-slate-800 px-5 py-4">
                <div className="text-[10px] font-black uppercase tracking-[0.16em] text-emerald-400">
                  Team performance
                </div>

                <h2 className="mt-1 text-xl font-black">
                  Tournament Standings
                </h2>
              </header>

              <div className="grid gap-3 p-4 sm:hidden">
                {standings.map(
                  (row, index) => (
                    <button
                      key={row.team_id}
                      type="button"
                      onClick={() =>
                        setProfileTeam({
                          id: row.team_id,
                          name: row.name,
                        })
                      }
                      className={`rounded-2xl border p-4 text-left ${
                        index === 0
                          ? "border-emerald-500 bg-emerald-950/60"
                          : "border-slate-800 bg-slate-950"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <span className="text-xl">
                            {index === 0
                              ? "🥇"
                              : index === 1
                                ? "🥈"
                                : index === 2
                                  ? "🥉"
                                  : `${index + 1}.`}
                          </span>

                          <TeamAvatar
                            teamName={row.name}
                            size="sm"
                          />

                          <strong className="truncate text-base">
                            {row.name}
                          </strong>
                        </div>

                        <strong className="text-2xl font-black text-emerald-300">
                          {row.wins} W
                        </strong>
                      </div>

                      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                        <div className="rounded-xl bg-slate-900 px-2 py-2">
                          <span className="block text-[9px] uppercase text-slate-500">
                            Total
                          </span>

                          <strong className="mt-1 block">
                            {formatScore(
                              row.total_to_par,
                            )}
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
                            Events
                          </span>

                          <strong className="mt-1 block">
                            {
                              row.tournaments_played
                            }
                          </strong>
                        </div>
                      </div>
                    </button>
                  ),
                )}
              </div>

              <div className="hidden overflow-x-auto sm:block">
                <table className="min-w-[900px] w-full border-collapse text-sm">
                  <thead className="bg-slate-950 text-left text-[10px] uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="px-4 py-3">
                        Team
                      </th>
                      <th className="px-3 py-3 text-center">
                        Wins
                      </th>
                      <th className="px-3 py-3 text-center">
                        2nd
                      </th>
                      <th className="px-3 py-3 text-center">
                        Avg finish
                      </th>
                      <th className="px-3 py-3 text-center">
                        Events
                      </th>
                      <th className="px-3 py-3 text-center">
                        Total to par
                      </th>
                      <th className="px-3 py-3 text-center">
                        Avg event
                      </th>
                      <th className="px-3 py-3 text-center">
                        Best event
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {standings.map(
                      (row, index) => (
                        <tr
                          key={row.team_id}
                          className={`border-t border-slate-800 ${
                            index === 0
                              ? "bg-emerald-950/30"
                              : ""
                          }`}
                        >
                          <td className="px-4 py-3">
                            <button
                              type="button"
                              onClick={() =>
                                setProfileTeam({
                                  id: row.team_id,
                                  name: row.name,
                                })
                              }
                              className="flex items-center gap-3 font-bold"
                            >
                              <span>
                                {index === 0
                                  ? "🥇"
                                  : index === 1
                                    ? "🥈"
                                    : index === 2
                                      ? "🥉"
                                      : `${index + 1}.`}
                              </span>

                              <TeamAvatar
                                teamName={row.name}
                                size="sm"
                              />

                              {row.name}
                            </button>
                          </td>

                          <td className="px-3 py-3 text-center font-black">
                            {row.wins}
                          </td>

                          <td className="px-3 py-3 text-center">
                            {row.runner_ups}
                          </td>

                          <td className="px-3 py-3 text-center">
                            {formatFinish(
                              row.avg_finish,
                            )}
                          </td>

                          <td className="px-3 py-3 text-center">
                            {
                              row.tournaments_played
                            }
                          </td>

                          <td className="px-3 py-3 text-center font-black text-emerald-300">
                            {formatScore(
                              row.total_to_par,
                            )}
                          </td>

                          <td className="px-3 py-3 text-center">
                            {formatScore(
                              row.avg_tournament_score,
                              2,
                            )}
                          </td>

                          <td className="px-3 py-3 text-center">
                            {formatScore(
                              row.best_tournament_score,
                            )}
                          </td>
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
                  Scoring
                </div>

                <h2 className="mt-1 text-xl font-black">
                  Hole Results
                </h2>
              </header>

              <div className="overflow-x-auto">
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
                    {standings.map((row) => (
                      <tr
                        key={row.team_id}
                        className="border-t border-slate-800"
                      >
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() =>
                              setProfileTeam({
                                id: row.team_id,
                                name: row.name,
                              })
                            }
                            className="flex items-center gap-3 font-bold"
                          >
                            <TeamAvatar
                              teamName={row.name}
                              size="sm"
                            />

                            {row.name}
                          </button>
                        </td>

                        <td className="px-3 py-3 text-center font-black text-emerald-300">
                          {
                            row.eagles_or_better
                          }
                        </td>

                        <td className="px-3 py-3 text-center text-emerald-200">
                          {row.birdies}
                        </td>

                        <td className="px-3 py-3 text-center">
                          {row.pars}
                        </td>

                        <td className="px-3 py-3 text-center text-red-300">
                          {row.bogeys}
                        </td>

                        <td className="px-3 py-3 text-center font-bold text-red-400">
                          {
                            row.double_bogeys_or_worse
                          }
                        </td>

                        <td className="px-3 py-3 text-center">
                          {row.rounds_under_par}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </div>

      <TeamProfileModal
        team={profileTeam}
        setTeam={setProfileTeam}
      />
    </main>
  );
}
