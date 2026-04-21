"use client";

import AppNav from "@/components/AppNav";
import { useEffect, useMemo, useState } from "react";

type StandingRow = {
  season: number;
  team_id: number;
  name: string;
  wins: number;
  runner_ups: number;
  avg_finish: number | null;
  avg_score: number | null;
  high_score: number | null;
  low_score: number | null;
  slates_played: number;
};

type StandingsResponse = {
  success: boolean;
  selectedSeason: number | null;
  availableSeasons: number[];
  standings: StandingRow[];
};

type SortKey =
  | "name"
  | "wins"
  | "runner_ups"
  | "avg_finish"
  | "avg_score"
  | "high_score"
  | "low_score"
  | "slates_played";

type SortDirection = "asc" | "desc";

function formatNumber(value: number | null, digits = 2) {
  if (value === null || value === undefined) return "—";
  return value.toFixed(digits);
}

function compareValues(
  a: string | number | null,
  b: string | number | null,
  direction: SortDirection
) {
  const multiplier = direction === "asc" ? 1 : -1;

  if (typeof a === "string" && typeof b === "string") {
    return a.localeCompare(b) * multiplier;
  }

  const aValue = a === null ? Number.NEGATIVE_INFINITY : Number(a);
  const bValue = b === null ? Number.NEGATIVE_INFINITY : Number(b);

  if (aValue < bValue) return -1 * multiplier;
  if (aValue > bValue) return 1 * multiplier;
  return 0;
}

export default function StandingsPage() {
  const [standings, setStandings] = useState<StandingRow[]>([]);
  const [availableSeasons, setAvailableSeasons] = useState<number[]>([]);
  const [selectedSeason, setSelectedSeason] = useState<number | "">("");
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("wins");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  useEffect(() => {
    void loadStandings();
  }, []);

  async function loadStandings(seasonOverride?: number | "") {
    try {
      setIsLoading(true);
      setErrorMessage("");

      const seasonToUse =
        seasonOverride !== undefined ? seasonOverride : selectedSeason;

      const url =
        seasonToUse === "" || seasonToUse === null
          ? "/api/standings"
          : `/api/standings?season=${seasonToUse}`;

      const response = await fetch(url);
      const result = (await response.json()) as StandingsResponse | { error?: string };

      if (!response.ok) {
        setErrorMessage(
          "error" in result && result.error
            ? result.error
            : "Failed to load standings."
        );
        return;
      }

      const safeResult = result as StandingsResponse;
      setStandings(safeResult.standings ?? []);
      setAvailableSeasons(safeResult.availableSeasons ?? []);
      setSelectedSeason(safeResult.selectedSeason ?? "");
    } catch (error) {
      console.error(error);
      setErrorMessage("Something went wrong while loading standings.");
    } finally {
      setIsLoading(false);
    }
  }

  function handleSort(nextKey: SortKey) {
    if (sortKey === nextKey) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }

    setSortKey(nextKey);
    setSortDirection(nextKey === "name" ? "asc" : "desc");
  }

  function getSortArrow(key: SortKey) {
    if (sortKey !== key) return "";
    return sortDirection === "asc" ? " ↑" : " ↓";
  }

  const sortedStandings = useMemo(() => {
    const copy = [...standings];
    copy.sort((a, b) => compareValues(a[sortKey], b[sortKey], sortDirection));
    return copy;
  }, [standings, sortKey, sortDirection]);

  const headerButtonClass = "font-semibold transition hover:text-slate-900";

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-900">
      <div className="mx-auto max-w-7xl space-y-6">
        <AppNav />

        <section className="rounded-3xl border border-slate-200 bg-white px-5 py-6 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">Season Standings</h1>
              <p className="mt-2 text-sm text-slate-600">
                Year-long team summary from imported season data.
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div>
                <label
                  htmlFor="season-select"
                  className="mb-1 block text-xs font-medium text-slate-600"
                >
                  Season
                </label>
                <select
                  id="season-select"
                  value={selectedSeason}
                  onChange={async (e) => {
                    const nextValue = e.target.value ? Number(e.target.value) : "";
                    setSelectedSeason(nextValue);
                    await loadStandings(nextValue);
                  }}
                  className="min-w-[140px] rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-sky-300"
                >
                  {availableSeasons.map((season) => (
                    <option key={season} value={season}>
                      {season}
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="button"
                onClick={() => void loadStandings()}
                className="rounded-xl border border-sky-300 bg-sky-100 px-4 py-2.5 text-sm font-medium text-sky-900 transition hover:bg-sky-200"
              >
                Refresh Standings
              </button>
            </div>
          </div>
        </section>

        {errorMessage ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 shadow-sm">
            {errorMessage}
          </div>
        ) : null}

        <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          {isLoading ? (
            <div className="px-2 py-6 text-sm text-slate-600">Loading standings...</div>
          ) : sortedStandings.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-500">
              No season summary data found for this season.
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-slate-200">
              <div className="overflow-x-auto">
                <table className="min-w-full border-collapse text-sm">
                  <thead className="bg-slate-100 text-slate-700">
                    <tr className="text-left">
                      <th className="px-3 py-3">
                        <button className={headerButtonClass} onClick={() => handleSort("name")}>
                          Name{getSortArrow("name")}
                        </button>
                      </th>
                      <th className="px-3 py-3">
                        <button className={headerButtonClass} onClick={() => handleSort("wins")}>
                          Wins{getSortArrow("wins")}
                        </button>
                      </th>
                      <th className="px-3 py-3">
                        <button className={headerButtonClass} onClick={() => handleSort("runner_ups")}>
                          Runner-ups{getSortArrow("runner_ups")}
                        </button>
                      </th>
                      <th className="px-3 py-3">
                        <button className={headerButtonClass} onClick={() => handleSort("avg_finish")}>
                          Avg Finish{getSortArrow("avg_finish")}
                        </button>
                      </th>
                      <th className="px-3 py-3">
                        <button className={headerButtonClass} onClick={() => handleSort("avg_score")}>
                          Avg Score{getSortArrow("avg_score")}
                        </button>
                      </th>
                      <th className="px-3 py-3">
                        <button className={headerButtonClass} onClick={() => handleSort("high_score")}>
                          High Score{getSortArrow("high_score")}
                        </button>
                      </th>
                      <th className="px-3 py-3">
                        <button className={headerButtonClass} onClick={() => handleSort("low_score")}>
                          Low Score{getSortArrow("low_score")}
                        </button>
                      </th>
                      <th className="px-3 py-3">
                        <button className={headerButtonClass} onClick={() => handleSort("slates_played")}>
                          Slates Played{getSortArrow("slates_played")}
                        </button>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white text-slate-800">
                    {sortedStandings.map((row, index) => (
                      <tr
                        key={`${row.season}-${row.team_id}`}
                        className={`border-t border-slate-100 ${
                          index === 0 ? "bg-orange-50/50" : ""
                        }`}
                      >
                        <td className="px-3 py-3 font-medium">{row.name}</td>
                        <td className="px-3 py-3">{row.wins}</td>
                        <td className="px-3 py-3">{row.runner_ups}</td>
                        <td className="px-3 py-3">{formatNumber(row.avg_finish, 2)}</td>
                        <td className="px-3 py-3">{formatNumber(row.avg_score, 2)}</td>
                        <td className="px-3 py-3">{formatNumber(row.high_score, 2)}</td>
                        <td className="px-3 py-3">{formatNumber(row.low_score, 2)}</td>
                        <td className="px-3 py-3">{row.slates_played}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
