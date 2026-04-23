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
  refreshStatsForSelectedSlate: (isSilent?: boolean) => Promise<void>;
  autoRefreshEnabled: boolean;
  setAutoRefreshEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  compactView: boolean;
  setCompactView: React.Dispatch<React.SetStateAction<boolean>>;
  hasMounted: boolean;
  isSlateLoading: boolean;
  lastUpdatedAt: string | null;
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
}: LineupControlsProps) {
  const pathname = usePathname();
  const isDraftPage = pathname === "/lineups/draft";

  const pillBase =
    "rounded-full border px-3 py-1.5 text-xs font-medium transition";
  const inactivePill =
    "border-slate-200 bg-white text-slate-700 hover:border-sky-200 hover:bg-sky-50";

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
        <div className="flex flex-col gap-4 lg:flex-row lg:flex-wrap lg:items-end">
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
              onChange={(e) => {
                setSelectedSlateId(e.target.value);
              }}
              className="min-w-[210px] rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-300"
            >
              {slates.map((slate) => (
                <option key={slate.id} value={slate.id}>
                  {slate.label ?? slate.date}
                  {slate.is_locked ? " (Locked)" : ""}
                </option>
              ))}
            </select>
          </div>

          {!isDraftPage ? (
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                Stats
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => refreshStatsForSelectedSlate(false)}
                  disabled={
                    !selectedSlateIdNumber ||
                    isRefreshingStats ||
                    !!selectedSlate?.is_locked
                  }
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
                  onClick={() => setAutoRefreshEnabled((prev) => !prev)}
                  disabled={!selectedSlateIdNumber}
                  className={`rounded-xl border px-4 py-3 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
                    autoRefreshEnabled
                      ? "border-sky-300 bg-sky-100 text-sky-900 hover:bg-sky-200"
                      : "border-slate-200 bg-white text-slate-700 hover:border-sky-200 hover:bg-sky-50"
                  }`}
                >
                  {autoRefreshEnabled ? "Auto Refresh On" : "Auto Refresh Off"}
                </button>
              </div>
            </div>
          ) : null}

{!isDraftPage ? (
  <div>
    <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
      View
    </label>
    <button
      type="button"
      onClick={() => setCompactView((prev) => !prev)}
      disabled={!hasMounted}
      className={`${pillBase} ${
        compactView
          ? "border-emerald-300 bg-emerald-100 text-emerald-900"
          : inactivePill
      } disabled:cursor-not-allowed disabled:opacity-60`}
    >
      {hasMounted ? (compactView ? "Compact On" : "Compact Off") : "View"}
    </button>
  </div>
) : null}
        </div>

        <div className="flex flex-col items-start gap-1 text-sm text-slate-600 xl:items-end">
          <div>
            {isSlateLoading
              ? "Loading slate..."
              : selectedSlate
                ? `${selectedSlateDisplay}${selectedSlate.is_locked ? " • Locked" : " • Open"}`
                : "No slate selected"}
          </div>

          {!isDraftPage ? (
            <div>
              Last updated: {formatLastUpdated(lastUpdatedAt)}
              {autoRefreshEnabled ? " • Auto every 30s" : ""}
            </div>
          ) : null}

          <Link
            href="/standings"
            className="font-medium text-sky-700 underline underline-offset-2 hover:text-sky-900"
          >
            View standings
          </Link>
        </div>
      </div>
    </section>
  );
}
