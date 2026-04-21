"use client";

import { useEffect, useMemo, useState } from "react";
import AppNav from "@/components/AppNav";

type PlayerHistoryRow = {
  player_id: number;
  player_name: string;
  times_drafted: number;
  avg_score: number;
  high_score: number;
  low_score: number;
  winning_lineups: number;
  runner_up_lineups: number;
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

type ApiResponse = {
  success: boolean;
  season: number;
  playerHistory: PlayerHistoryRow[];
};

export default function PlayerHistoryPage() {
  const [rows, setRows] = useState<PlayerHistoryRow[]>([]);
  const [season, setSeason] = useState<number>(2026);
  const [searchTerm, setSearchTerm] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("times_drafted");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  useEffect(() => {
    void loadPlayerHistory();
  }, []);

  async function loadPlayerHistory() {
    try {
      setIsLoading(true);
      setMessage("");

      const response = await fetch("/api/player-history?season=2026");
      const result = (await response.json()) as ApiResponse | { error?: string };

      if (!response.ok) {
        setMessage(
          "error" in result && result.error
            ? result.error
            : "Failed to load player history."
        );
        return;
      }

      const safeResult = result as ApiResponse;
      setRows(safeResult.playerHistory ?? []);
      setSeason(safeResult.season ?? 2026);
    } catch (error) {
      console.error(error);
      setMessage("Something went wrong while loading player history.");
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

  const filteredRows = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();

    const filtered = rows.filter((row) => {
      if (!normalizedSearch) return true;
      return row.player_name.toLowerCase().includes(normalizedSearch);
    });

    filtered.sort((a, b) => {
      let comparison = 0;

      switch (sortKey) {
        case "player_name":
          comparison = a.player_name.localeCompare(b.player_name);
          break;
        case "times_drafted":
          comparison = a.times_drafted - b.times_drafted;
          break;
        case "avg_score":
          comparison = a.avg_score - b.avg_score;
          break;
        case "high_score":
          comparison = a.high_score - b.high_score;
          break;
        case "low_score":
          comparison = a.low_score - b.low_score;
          break;
        case "winning_lineups":
          comparison = a.winning_lineups - b.winning_lineups;
          break;
        case "runner_up_lineups":
          comparison = a.runner_up_lineups - b.runner_up_lineups;
          break;
      }

      if (comparison === 0) {
        comparison = a.player_name.localeCompare(b.player_name);
      }

      return sortDirection === "asc" ? comparison : -comparison;
    });

    return filtered;
  }, [rows, searchTerm, sortKey, sortDirection]);

  function sortIndicator(key: SortKey) {
    if (sortKey !== key) return "";
    return sortDirection === "asc" ? " ↑" : " ↓";
  }

  function headerButton(label: string, key: SortKey) {
    return (
      <button
        type="button"
        onClick={() => handleSort(key)}
        className="font-semibold text-left transition hover:text-sky-700"
      >
        {label}
        {sortIndicator(key)}
      </button>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-900">
      <div className="mx-auto max-w-7xl space-y-6">
        <AppNav />

        <section className="rounded-3xl border border-slate-200 bg-white px-5 py-6 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm font-medium uppercase tracking-wide text-sky-700">
                Player History
              </p>
              <h1 className="mt-2 text-3xl font-bold tracking-tight">
                2026 Player Results
              </h1>
              <p className="mt-2 text-sm text-slate-600">
                Live-calculated from saved lineups and slate results.
              </p>
            </div>

            <button
              type="button"
              onClick={() => void loadPlayerHistory()}
              className="rounded-xl border border-sky-300 bg-sky-100 px-4 py-3 text-sm font-medium text-sky-900 transition hover:bg-sky-200"
            >
              Refresh Player History
            </button>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
            <div>
              <label
                htmlFor="player-search"
                className="mb-2 block text-sm font-medium text-slate-700"
              >
                Search players
              </label>
              <input
                id="player-search"
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search by player name"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-300"
              />
            </div>

            <div className="text-sm text-slate-500">
              Season: <span className="font-medium text-slate-900">{season}</span>
            </div>
          </div>

          {message ? (
            <div className="mt-4 rounded-2xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-800">
              {message}
            </div>
          ) : null}
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          {isLoading ? (
            <div className="rounded-xl border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-500">
              Loading player history...
            </div>
          ) : filteredRows.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-500">
              No player history found.
            </div>
          ) : (
            <div className="overflow-x-auto -mx-4 px-4">
              <table className="min-w-full border-collapse text-sm">
                <thead className="bg-slate-100 text-slate-700">
                  <tr className="text-left">
                    <th className="px-4 py-3">{headerButton("Player", "player_name")}</th>
                    <th className="px-4 py-3">{headerButton("Times Drafted", "times_drafted")}</th>
                    <th className="px-4 py-3">{headerButton("Avg Score", "avg_score")}</th>
                    <th className="px-4 py-3">{headerButton("High Score", "high_score")}</th>
                    <th className="px-4 py-3">{headerButton("Low Score", "low_score")}</th>
                    <th className="px-4 py-3">{headerButton("Winning Lineups", "winning_lineups")}</th>
                    <th className="px-4 py-3">{headerButton("Runner-up Lineups", "runner_up_lineups")}</th>
                  </tr>
                </thead>
                <tbody className="bg-white text-slate-800">
                  {filteredRows.map((row) => (
                    <tr key={row.player_id} className="border-t border-slate-100">
                      <td className="px-4 py-3 font-medium">{row.player_name}</td>
                      <td className="px-4 py-3">{row.times_drafted}</td>
                      <td className="px-4 py-3">{row.avg_score.toFixed(2)}</td>
                      <td className="px-4 py-3">{row.high_score.toFixed(2)}</td>
                      <td className="px-4 py-3">{row.low_score.toFixed(2)}</td>
                      <td className="px-4 py-3">{row.winning_lineups}</td>
                      <td className="px-4 py-3">{row.runner_up_lineups}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
