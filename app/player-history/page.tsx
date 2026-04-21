"use client";

import AppNav from "@/components/AppNav";
import { useEffect, useMemo, useState } from "react";

type PlayerHistoryRow = {
  player_id: number;
  player_name: string;
  times_drafted: number;
  avg_score: number | null;
  high_score: number | null;
  low_score: number | null;
  winning_lineups: number;
  runner_up_lineups: number;
};

type PlayerHistoryResponse = {
  success: boolean;
  playerHistory: PlayerHistoryRow[];
};

type SortKey =
  | "player_name"
  | "times_drafted"
  | "avg_score"
  | "high_score"
  | "low_score"
  | "winning_lineups"
  | "runner_up_lineups";

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

export default function PlayerHistoryPage() {
  const [rows, setRows] = useState<PlayerHistoryRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("times_drafted");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  useEffect(() => {
    void loadPlayerHistory();
  }, []);

  async function loadPlayerHistory() {
    try {
      setIsLoading(true);
      setErrorMessage("");

      const response = await fetch("/api/player-history");
      const result = (await response.json()) as
        | PlayerHistoryResponse
        | { error?: string };

      if (!response.ok) {
        setErrorMessage(
          "error" in result && result.error
            ? result.error
            : "Failed to load player history."
        );
        return;
      }

      const safeResult = result as PlayerHistoryResponse;
      setRows(safeResult.playerHistory ?? []);
    } catch (error) {
      console.error(error);
      setErrorMessage("Something went wrong while loading player history.");
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
    setSortDirection(nextKey === "player_name" ? "asc" : "desc");
  }

  function getSortArrow(key: SortKey) {
    if (sortKey !== key) return "";
    return sortDirection === "asc" ? " ↑" : " ↓";
  }

  const sortedRows = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => compareValues(a[sortKey], b[sortKey], sortDirection));
    return copy;
  }, [rows, sortKey, sortDirection]);

  const headerButtonClass = "font-semibold transition hover:text-slate-900";

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-900">
      <div className="mx-auto max-w-7xl space-y-6">
        <AppNav />

        <section className="rounded-3xl border border-slate-200 bg-white px-5 py-6 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">Drafted Player History</h1>
              <p className="mt-2 text-sm text-slate-600">
                Season-long stats for players used in lineups this year.
              </p>
            </div>

            <button
              type="button"
              onClick={() => void loadPlayerHistory()}
              className="rounded-xl border border-sky-300 bg-sky-100 px-4 py-2.5 text-sm font-medium text-sky-900 transition hover:bg-sky-200"
            >
              Refresh
            </button>
          </div>
        </section>

        {errorMessage ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 shadow-sm">
            {errorMessage}
          </div>
        ) : null}

        <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          {isLoading ? (
            <div className="px-2 py-6 text-sm text-slate-600">Loading player history...</div>
          ) : sortedRows.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-500">
              No drafted player history yet.
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-slate-200">
              <div className="overflow-x-auto">
                <table className="min-w-full border-collapse text-sm">
                  <thead className="bg-slate-100 text-slate-700">
                    <tr className="text-left">
                      <th className="px-3 py-3">
                        <button className={headerButtonClass} onClick={() => handleSort("player_name")}>
                          Player{getSortArrow("player_name")}
                        </button>
                      </th>
                      <th className="px-3 py-3">
                        <button className={headerButtonClass} onClick={() => handleSort("times_drafted")}>
                          Times Drafted{getSortArrow("times_drafted")}
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
                        <button className={headerButtonClass} onClick={() => handleSort("winning_lineups")}>
                          Winning Lineups{getSortArrow("winning_lineups")}
                        </button>
                      </th>
                      <th className="px-3 py-3">
                        <button className={headerButtonClass} onClick={() => handleSort("runner_up_lineups")}>
                          Runner-up Lineups{getSortArrow("runner_up_lineups")}
                        </button>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white text-slate-800">
                    {sortedRows.map((row) => (
                      <tr key={row.player_id} className="border-t border-slate-100">
                        <td className="px-3 py-3 font-medium">{row.player_name}</td>
                        <td className="px-3 py-3">{row.times_drafted}</td>
                        <td className="px-3 py-3">{formatNumber(row.avg_score, 2)}</td>
                        <td className="px-3 py-3">{formatNumber(row.high_score, 2)}</td>
                        <td className="px-3 py-3">{formatNumber(row.low_score, 2)}</td>
                        <td className="px-3 py-3">{row.winning_lineups}</td>
                        <td className="px-3 py-3">{row.runner_up_lineups}</td>
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
