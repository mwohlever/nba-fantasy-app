"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { canAddGolfSalaryCapPlayer } from "@/lib/golf/salaryCap";

type PeriodKey = "full_tournament" | "opening" | "weekend";
type Golfer = {
  playerId: number;
  name: string;
  country: string | null;
  owgrRank: number | null;
  fieldStatus: string | null;
  teeTime: string | null;
  isAmateur: boolean;
  effectiveSalary: number | null;
  priced: boolean;
  eligible: boolean;
};
type Board = {
  slate: { id: number; name: string };
  period: { key: PeriodKey; state: "open" | "locked" | "unavailable"; lockReason: string | null };
  periods: Array<{ key: PeriodKey; state: "open" | "locked" | "unavailable" }>;
  priceSet: { status: "generated" | "frozen" } | null;
  budget: number;
  rosterSize: number;
  golfers: Golfer[];
  lineup: { revision: number; totalSalary: number; playerIds: number[] } | null;
};

function periodLabel(period: PeriodKey) {
  return period === "full_tournament" ? "Full Tournament" : period === "opening" ? "Opening" : "Weekend";
}

function dollars(value: number) {
  return `$${value}`;
}

export default function GolfSalaryCapBuilder({
  slates,
  initialSlateId,
}: {
  slates: Array<{ id: number; label: string }>;
  initialSlateId: number;
}) {
  const [slateId, setSlateId] = useState(initialSlateId);
  const [period, setPeriod] = useState<PeriodKey | null>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [saved, setSaved] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (nextPeriod?: PeriodKey | null) => {
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams({ slateId: String(slateId) });
      if (nextPeriod) query.set("period", nextPeriod);
      const response = await fetch(`/api/golf/salary-cap?${query}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Salary Cap board could not be loaded.");
      const next = result as Board;
      const ids = next.lineup?.playerIds ?? [];
      setBoard(next);
      setPeriod(next.period.key);
      setSelected(ids);
      setSaved(ids);
      setMessage(null);
    } catch (caught) {
      setBoard(null);
      setError(caught instanceof Error ? caught.message : "Salary Cap board could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [slateId]);

  useEffect(() => { void load(period); }, [load]); // period changes use the explicit tab handler.

  const golferById = useMemo(() => new Map((board?.golfers ?? []).map(golfer => [golfer.playerId, golfer])), [board]);
  const used = selected.reduce((total, id) => total + (golferById.get(id)?.effectiveSalary ?? 0), 0);
  const unsaved = selected.length !== saved.length || selected.some((id, index) => saved[index] !== id);
  const prices = (board?.golfers ?? []).map(golfer => ({
    playerId: golfer.playerId,
    effectiveSalary: golfer.effectiveSalary,
    eligible: golfer.eligible,
    isAmateur: golfer.isAmateur,
  }));

  function disabledReason(golfer: Golfer) {
    if (selected.includes(golfer.playerId)) return null;
    if (board?.period.state !== "open") return board?.period.state === "unavailable" ? "Period unavailable" : "Period locked";
    if (!golfer.eligible) return "Not eligible for this period";
    if (!golfer.priced || golfer.effectiveSalary === null) return "Unpriced";
    if (selected.length >= (board?.rosterSize ?? 4)) return "Roster full";
    if (!canAddGolfSalaryCapPlayer({ selectedPlayerIds: selected, candidatePlayerId: golfer.playerId, prices, rosterSize: board?.rosterSize ?? 4, salaryCap: board?.budget ?? 100 })) {
      return used + golfer.effectiveSalary > (board?.budget ?? 100) ? "Over cap" : "Cannot complete roster under cap";
    }
    return null;
  }

  async function saveLineup() {
    if (!board || !period) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/golf/salary-cap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slateId,
          period,
          playerIds: selected,
          expectedRevision: board.lineup?.revision ?? null,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Lineup could not be saved.");
      await load(period);
      setMessage("Lineup saved.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Lineup could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mx-auto w-full max-w-5xl space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">Golf · Salary Cap</p>
          <h1 className="text-2xl font-bold tracking-tight text-slate-950">Build your lineup</h1>
        </div>
        <label className="text-xs font-semibold text-slate-600">
          Tournament
          <select className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900" value={slateId}
            onChange={event => { setPeriod(null); setSlateId(Number(event.target.value)); }}>
            {slates.map(slate => <option key={slate.id} value={slate.id}>{slate.label}</option>)}
          </select>
        </label>
      </div>

      {board && board.periods.length > 1 && (
        <div className="flex gap-2" role="tablist" aria-label="Roster period">
          {board.periods.map(item => (
            <button key={item.key} type="button" role="tab" aria-selected={period === item.key}
              className={`rounded-full px-3 py-1.5 text-sm font-semibold ${period === item.key ? "bg-slate-950 text-white" : "bg-slate-200 text-slate-700"}`}
              onClick={() => { setPeriod(item.key); void load(item.key); }}>
              {periodLabel(item.key)}{item.state === "unavailable" ? " · Soon" : item.state === "locked" ? " · Locked" : ""}
            </button>
          ))}
        </div>
      )}

      {loading && <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">Loading Salary Cap board…</div>}
      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {board && !loading && (
        <>
          <div className="sticky top-2 z-10 rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-sm backdrop-blur">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {Array.from({ length: board.rosterSize }, (_, index) => {
                const golfer = golferById.get(selected[index]);
                return (
                  <button key={index} type="button" disabled={!golfer || board.period.state !== "open"}
                    onClick={() => golfer && setSelected(current => current.filter(id => id !== golfer.playerId))}
                    className={`min-h-16 rounded-xl border px-3 py-2 text-left ${golfer ? "border-emerald-200 bg-emerald-50" : "border-dashed border-slate-300 bg-slate-50"}`}>
                    <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Golfer {index + 1}</span>
                    <span className="mt-1 block truncate text-sm font-bold text-slate-900">{golfer?.name ?? "Open slot"}</span>
                    <span className="block text-xs text-slate-600">{golfer?.effectiveSalary === null || golfer?.effectiveSalary === undefined ? "—" : dollars(golfer.effectiveSalary)}</span>
                  </button>
                );
              })}
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
              <div className="flex gap-5 text-sm">
                <span>Used: <strong>{dollars(used)}</strong></span>
                <span>Remaining: <strong>{dollars(board.budget - used)}</strong></span>
                <span className={unsaved ? "text-amber-700" : "text-emerald-700"}>{unsaved ? "Unsaved" : board.lineup ? "Saved" : "Not saved"}</span>
              </div>
              <button type="button" onClick={saveLineup}
                disabled={saving || board.period.state !== "open" || selected.length !== board.rosterSize || !unsaved || board.priceSet?.status !== "frozen"}
                className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300">
                {saving ? "Saving…" : "Save Lineup"}
              </button>
            </div>
            {message && <p className="mt-2 text-sm font-medium text-emerald-700">{message}</p>}
            {board.period.state !== "open" && <p className="mt-2 text-sm text-slate-600">{board.period.state === "unavailable" ? "This roster period is not open yet." : "This roster period is read-only."}</p>}
            {board.priceSet?.status !== "frozen" && <p className="mt-2 text-sm text-amber-700">A commissioner must generate and freeze tournament salaries.</p>}
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="grid grid-cols-[1fr_auto_auto] gap-3 border-b border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">
              <span>Golfer</span><span>Status</span><span>Salary</span>
            </div>
            <div className="divide-y divide-slate-100">
              {board.golfers.map(golfer => {
                const chosen = selected.includes(golfer.playerId);
                const reason = disabledReason(golfer);
                return (
                  <button key={golfer.playerId} type="button" disabled={!chosen && Boolean(reason)}
                    onClick={() => setSelected(current => chosen ? current.filter(id => id !== golfer.playerId) : [...current, golfer.playerId])}
                    title={reason ?? undefined}
                    className={`grid w-full grid-cols-[1fr_auto_auto] items-center gap-3 px-3 py-3 text-left ${chosen ? "bg-emerald-50" : reason ? "cursor-not-allowed opacity-45" : "hover:bg-slate-50"}`}>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-slate-900">{golfer.name}{golfer.isAmateur ? " (a)" : ""}</span>
                      <span className="block truncate text-xs text-slate-500">{golfer.owgrRank ? `OWGR ${golfer.owgrRank}` : golfer.country ?? "Tournament field"}{reason && !chosen ? ` · ${reason}` : ""}</span>
                    </span>
                    <span className="text-xs capitalize text-slate-500">{golfer.fieldStatus?.replaceAll("_", " ") ?? "field"}</span>
                    <span className="text-sm font-bold tabular-nums text-slate-900">{golfer.effectiveSalary === null ? "—" : dollars(golfer.effectiveSalary)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
