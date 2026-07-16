"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Slate } from "@/components/lineups/types";
import { formatLastUpdated } from "@/components/lineups/utils";

type LineupControlsProps = {
  selectedSlateId: string;
  setSelectedSlateId: (value: string) => void;
  slates: Slate[];
  selectedSlate: Slate | null;
  selectedSlateDisplay: string;
  selectedSlateIdNumber: number | null;
  isRefreshingStats: boolean;
  refreshStatsForSelectedSlate: (
    isSilent?: boolean
  ) => Promise<void>;
  autoRefreshEnabled: boolean;
  setAutoRefreshEnabled: React.Dispatch<
    React.SetStateAction<boolean>
  >;
  compactView: boolean;
  setCompactView: React.Dispatch<
    React.SetStateAction<boolean>
  >;
  hasMounted: boolean;
  isSlateLoading: boolean;
  lastUpdatedAt: string | null;
  seasons: string[];
  selectedSeason: string;
  setSelectedSeason: (value: string) => void;
};

export default function LineupControls({
  selectedSlateId,
  setSelectedSlateId,
  slates,
  selectedSlate,
  selectedSlateDisplay,
  selectedSlateIdNumber,
  isRefreshingStats,
  refreshStatsForSelectedSlate,
  autoRefreshEnabled,
  setAutoRefreshEnabled,
  compactView,
  setCompactView,
  hasMounted,
  isSlateLoading,
  lastUpdatedAt,
  seasons,
  selectedSeason,
  setSelectedSeason,
}: LineupControlsProps) {
  const pathname = usePathname();
  const isDraftPage = pathname === "/lineups/draft";

  void compactView;
  void setCompactView;
  void hasMounted;

  if (isDraftPage) {
    return (
      <section className="draft-compact-controls">
        <div className="draft-compact-controls-main">
          <label className="draft-compact-field">
            <span>Season</span>

            <select
              value={selectedSeason}
              onChange={(event) =>
                setSelectedSeason(event.target.value)
              }
            >
              {seasons.map((season) => (
                <option key={season} value={season}>
                  {season}
                </option>
              ))}
            </select>
          </label>

          <label className="draft-compact-field draft-compact-field--slate">
            <span>Slate</span>

            <select
              value={selectedSlateId}
              onChange={(event) =>
                setSelectedSlateId(event.target.value)
              }
            >
              {slates.map((slate) => (
                <option key={slate.id} value={slate.id}>
                  {slate.label ?? slate.date}
                  {slate.is_locked ? " (Locked)" : ""}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="draft-compact-meta">
          <div className="draft-compact-status">
            <span
              className={`draft-compact-status-dot ${
                selectedSlate?.is_locked
                  ? "draft-compact-status-dot--locked"
                  : "draft-compact-status-dot--open"
              }`}
            />

            <span>
              {isSlateLoading
                ? "Loading slate..."
                : selectedSlate
                  ? selectedSlate.is_locked
                    ? "Slate locked"
                    : "Slate open"
                  : "No slate selected"}
            </span>
          </div>

          <Link
            href="/standings"
            className="draft-compact-standings-link"
          >
            View standings →
          </Link>
        </div>
      </section>
    );
  }

  const slateStatus = isSlateLoading
    ? "Loading"
    : selectedSlate?.is_locked
      ? "Final"
      : selectedSlate
        ? "Live"
        : "No slate";

  const refreshDisabled =
    !selectedSlateIdNumber ||
    isRefreshingStats ||
    Boolean(selectedSlate?.is_locked);

  return (
    <>
      <section className="md:hidden">
        <div className="overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 text-white shadow-sm">
          <div className="px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="min-w-0 truncate text-base font-black">
                {selectedSlateDisplay}
              </h2>

              <span
                className={`rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-wider ${
                  selectedSlate?.is_locked
                    ? "border-slate-600 bg-slate-800 text-slate-300"
                    : "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                }`}
              >
                {slateStatus}
              </span>
            </div>

            <div className="mt-1 text-xs text-slate-400">
              Last updated:{" "}
              {formatLastUpdated(lastUpdatedAt)}
              {autoRefreshEnabled
                ? " • Auto every 30s"
                : ""}
            </div>
          </div>

          <div className="border-t border-slate-700 px-3 py-3">
            {!selectedSlate?.is_locked ? (
              <button
                type="button"
                onClick={() =>
                  void refreshStatsForSelectedSlate(false)
                }
                disabled={refreshDisabled}
                className="flex min-h-10 w-full items-center justify-center rounded-xl border border-sky-500/50 bg-sky-500/10 px-3 text-sm font-bold text-sky-300 transition hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:border-slate-700 disabled:bg-slate-800 disabled:text-slate-500"
              >
                {isRefreshingStats
                  ? "Refreshing..."
                  : "↻ Refresh Scores"}
              </button>
            ) : null}

            <details
              className={`group ${
                selectedSlate?.is_locked ? "" : "mt-2"
              }`}
            >
              <summary className="flex min-h-10 cursor-pointer list-none items-center justify-center rounded-xl border border-slate-600 bg-slate-800 px-3 text-sm font-bold text-slate-200 transition hover:border-sky-500/50 hover:text-white [&::-webkit-details-marker]:hidden">
                Change Slate & Settings

                <span className="ml-1.5 transition group-open:rotate-180">
                  ▾
                </span>
              </summary>

              <div className="mt-3 space-y-3 border-t border-slate-700 pt-3">
                <div className="grid grid-cols-1 gap-3">
                  <label className="block">
                    <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      Season
                    </span>

                    <select
                      value={selectedSeason}
                      onChange={(event) =>
                        setSelectedSeason(
                          event.target.value
                        )
                      }
                      className="h-11 w-full rounded-xl border border-slate-600 bg-slate-800 px-3 text-sm text-white outline-none focus:border-sky-400"
                    >
                      {seasons.map((season) => (
                        <option
                          key={season}
                          value={season}
                        >
                          {season}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block">
                    <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      Slate
                    </span>

                    <select
                      value={selectedSlateId}
                      onChange={(event) =>
                        setSelectedSlateId(
                          event.target.value
                        )
                      }
                      className="h-11 w-full rounded-xl border border-slate-600 bg-slate-800 px-3 text-sm text-white outline-none focus:border-sky-400"
                    >
                      {slates.map((slate) => (
                        <option
                          key={slate.id}
                          value={slate.id}
                        >
                          {slate.label ?? slate.date}
                          {slate.is_locked
                            ? " (Locked)"
                            : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-700 bg-slate-800/70 px-3 py-3">
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-white">
                      Auto Refresh
                    </div>

                    <div className="mt-0.5 text-[10px] leading-4 text-slate-400">
                      Update live scores every 30 seconds
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      setAutoRefreshEnabled(
                        (current) => !current
                      )
                    }
                    disabled={!selectedSlateIdNumber}
                    aria-pressed={autoRefreshEnabled}
                    className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                      autoRefreshEnabled
                        ? "border-emerald-400 bg-emerald-500/20 text-emerald-300"
                        : "border-slate-600 bg-slate-900 text-slate-400"
                    }`}
                  >
                    {autoRefreshEnabled ? "On" : "Off"}
                  </button>
                </div>

                <Link
                  href="/standings"
                  className="flex min-h-11 items-center justify-center rounded-xl border border-slate-600 bg-slate-800 text-sm font-bold text-sky-300"
                >
                  View Standings →
                </Link>
              </div>
            </details>
          </div>
        </div>
      </section>

      <section className="hidden rounded-3xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900 md:block">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="flex flex-col gap-4 lg:flex-row lg:flex-wrap lg:items-end">
            <div>
              <label
                htmlFor="season-select"
                className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500"
              >
                Season
              </label>

              <select
                id="season-select"
                value={selectedSeason}
                onChange={(event) =>
                  setSelectedSeason(event.target.value)
                }
                className="min-w-[120px] rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-300 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
              >
                {seasons.map((season) => (
                  <option key={season} value={season}>
                    {season}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="slate-select"
                className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500"
              >
                Slate / Day
              </label>

              <select
                id="slate-select"
                value={selectedSlateId}
                onChange={(event) =>
                  setSelectedSlateId(event.target.value)
                }
                className="min-w-[210px] rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-300 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
              >
                {slates.map((slate) => (
                  <option key={slate.id} value={slate.id}>
                    {slate.label ?? slate.date}
                    {slate.is_locked ? " (Locked)" : ""}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                Stats
              </label>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() =>
                    void refreshStatsForSelectedSlate(
                      false
                    )
                  }
                  disabled={refreshDisabled}
                  className="rounded-xl border border-emerald-300 bg-emerald-100 px-4 py-3 text-sm font-medium text-emerald-900 transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {selectedSlate?.is_locked
                    ? "Slate Locked"
                    : isRefreshingStats
                      ? "Refreshing..."
                      : "Refresh Stats"}
                </button>

                <button
                  type="button"
                  onClick={() =>
                    setAutoRefreshEnabled(
                      (current) => !current
                    )
                  }
                  disabled={!selectedSlateIdNumber}
                  className={`rounded-xl border px-4 py-3 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
                    autoRefreshEnabled
                      ? "border-sky-300 bg-sky-100 text-sky-900"
                      : "border-slate-200 bg-white text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
                  }`}
                >
                  {autoRefreshEnabled
                    ? "Auto Refresh On"
                    : "Auto Refresh Off"}
                </button>
              </div>
            </div>
          </div>

          <div className="flex flex-col items-start gap-1 text-sm text-slate-600 dark:text-slate-300 xl:items-end">
            <div>
              {isSlateLoading
                ? "Loading slate..."
                : selectedSlate
                  ? `${selectedSlateDisplay}${
                      selectedSlate.is_locked
                        ? " • Locked"
                        : " • Open"
                    }`
                  : "No slate selected"}
            </div>

            <div>
              Last updated:{" "}
              {formatLastUpdated(lastUpdatedAt)}
              {autoRefreshEnabled
                ? " • Auto every 30s"
                : ""}
            </div>

            <Link
              href="/standings"
              className="font-medium text-sky-700 underline underline-offset-2 hover:text-sky-900 dark:text-sky-300"
            >
              View standings
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
