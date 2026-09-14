"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePullToRefresh } from "@/lib/client/usePullToRefresh";
import type { RefreshOutcome } from "@/lib/client/refreshOutcome";
import PullToRefreshIndicator from "@/components/ui/PullToRefreshIndicator";
import { useGroupContext } from "@/components/providers/GroupProvider";

import { canAddGolfSalaryCapPlayer } from "@/lib/golf/salaryCap";
import { formatGolfMoney, golfCentsToMoney, golfMoneyToCents } from "@/lib/golf/money";

type PeriodKey = "full_tournament" | "opening" | "weekend";
type Golfer = {
  playerId: number;
  name: string;
  country: string | null;
  owgrRank: number | null;
  fieldStatus: string | null;
  teeTime: string | null;
  isAmateur: boolean;
  effectiveSalary: string | null;
  priced: boolean;
  eligible: boolean;
};
type Board = {
  slate: { id: number; name: string };
  period: { key: PeriodKey; state: "open" | "locked" | "unavailable"; lockReason: string | null };
  periods: Array<{ key: PeriodKey; state: "open" | "locked" | "unavailable" }>;
  priceSet: { status: "generated" | "frozen" } | null;
  budget: string;
  rosterSize: number;
  golfers: Golfer[];
  lineup: { revision: number; totalSalary: string; playerIds: number[] } | null;
};

function periodLabel(period: PeriodKey) {
  return period === "full_tournament" ? "Full Tournament" : period === "opening" ? "Opening" : "Weekend";
}

function dollars(value: string | number) {
  return `$${formatGolfMoney(value)}`;
}

export default function GolfSalaryCapBuilder({
  slates,
  initialSlateId,
}: {
  slates: Array<{ id: number; label: string }>;
  initialSlateId: number;
}) {
  const { groupContext, isLoading: groupLoading, isSwitchingGroup } = useGroupContext();
  const [slateId, setSlateId] = useState(initialSlateId);
  const [period, setPeriod] = useState<PeriodKey | null>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [saved, setSaved] = useState<number[]>([]);
  const [golferSearch, setGolferSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revisionConflict, setRevisionConflict] = useState(false);
  const surfaceRef = useRef<HTMLElement | null>(null);
  const pendingRef = useRef(false);
  const requestRef = useRef(0);
  const draftRef = useRef({ selected, saved, board });
  draftRef.current = { selected, saved, board };
  useEffect(() => { setSlateId(initialSlateId); setPeriod(null); }, [initialSlateId]);

  const load = useCallback(async (nextPeriod?: PeriodKey | null, preserveDraft = false): Promise<RefreshOutcome> => {
    if (groupLoading || isSwitchingGroup) return { status: "skipped" };
    if (preserveDraft && pendingRef.current) return { status: "skipped" };
    pendingRef.current = true;
    const request = ++requestRef.current;
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams({ slateId: String(slateId) });
      if (nextPeriod) query.set("period", nextPeriod);
      const response = await fetch(`/api/golf/salary-cap?${query}`, { cache: "no-store" });
      const result = await response.json();
      if (request !== requestRef.current) return { status: "skipped" };
      if (!response.ok) throw new Error(result.error ?? "Salary Cap board could not be loaded.");
      const next = result as Board;
      const ids = next.lineup?.playerIds ?? [];
      setBoard(next);
      setPeriod(next.period.key);
      const draft = draftRef.current;
      const dirty = JSON.stringify(draft.selected) !== JSON.stringify(draft.saved);
      if (preserveDraft && dirty && draft.board?.slate.id === next.slate.id && draft.board.period.key === next.period.key) {
        const previousRevision = draft.board.lineup?.revision ?? null;
        setRevisionConflict(previous => previous || previousRevision !== (next.lineup?.revision ?? null));
      } else {
        setSelected(ids);
        setSaved(ids);
        setRevisionConflict(false);
      }
      setMessage(null);
      return { status: "success" };
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Salary Cap board could not be loaded.";
      if (request === requestRef.current) {
        if (!preserveDraft) setBoard(null);
        setError(message);
      }
      return { status: "error", message };
    } finally {
      if (request === requestRef.current) { setLoading(false); pendingRef.current = false; }
    }
  }, [slateId, groupContext?.group.id, groupLoading, isSwitchingGroup]);

  useEffect(() => { void load(period); return () => { requestRef.current += 1; }; }, [load]); // period changes use the explicit tab handler.
  const pull = usePullToRefresh({ targetRef: surfaceRef, onRefresh: () => load(period, true),
    enabled: Boolean(board) && !saving && !loading && !groupLoading && !isSwitchingGroup, isRefreshing: loading,
    scopeKey: `${groupContext?.group.id}:${slateId}:${period}` });

  const golferById = useMemo(() => new Map((board?.golfers ?? []).map(golfer => [golfer.playerId, golfer])), [board]);
  const usedCents = selected.reduce((total, id) => total + (golfMoneyToCents(golferById.get(id)?.effectiveSalary) ?? 0), 0);
  const budgetCents = board ? golfMoneyToCents(board.budget)! : 0;
  const used = golfCentsToMoney(usedCents);
  const unsaved = selected.length !== saved.length || selected.some((id, index) => saved[index] !== id);
  const invalid = selected.filter(id => !golferById.get(id)?.eligible || !golferById.get(id)?.priced);
  const prices = (board?.golfers ?? []).map(golfer => ({
    playerId: golfer.playerId,
    effectiveSalary: golfer.effectiveSalary,
    eligible: golfer.eligible,
    isAmateur: golfer.isAmateur,
  }));
  const visibleGolfers = useMemo(() => {
    const query = golferSearch.trim().toLocaleLowerCase();
    return query ? (board?.golfers ?? []).filter(golfer => golfer.name.toLocaleLowerCase().includes(query)) : board?.golfers ?? [];
  }, [board?.golfers, golferSearch]);

  function disabledReason(golfer: Golfer) {
    if (!board || loading || saving) return "Loading lineup";
    if (selected.includes(golfer.playerId)) return null;
    if (board?.period.state !== "open") return board?.period.state === "unavailable" ? "Period unavailable" : "Period locked";
    if (!golfer.eligible) return "Not eligible for this period";
    if (!golfer.priced || golfer.effectiveSalary === null) return "Unpriced";
    if (selected.length >= board.rosterSize) return "Roster full";
    if (!canAddGolfSalaryCapPlayer({ selectedPlayerIds: selected, candidatePlayerId: golfer.playerId, prices, rosterSize: board.rosterSize, salaryCap: board.budget })) {
      return usedCents + golfMoneyToCents(golfer.effectiveSalary)! > budgetCents ? "Over cap" : "Cannot complete roster under cap";
    }
    return null;
  }

  async function saveLineup() {
    if (!board || !period || saving || pendingRef.current || revisionConflict || invalid.length || usedCents > budgetCents) return;
    pendingRef.current = true;
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
      pendingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <section ref={surfaceRef} className="mx-auto w-full max-w-5xl space-y-4">
      <PullToRefreshIndicator pull={pull} feedback={loading ? "Refreshing…" : ""} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-300">Golf · Salary Cap</p>
          <h1 className="text-2xl font-bold tracking-tight text-white">Build your lineup</h1>
        </div>
        <label className="text-xs font-semibold text-slate-300">
          Tournament
          <select className="mt-1 block w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white" value={slateId}
            onChange={event => { setPeriod(null); setSlateId(Number(event.target.value)); }}>
            {slates.map(slate => <option key={slate.id} value={slate.id}>{slate.label}</option>)}
          </select>
        </label>
      </div>

      {board && board.periods.length > 1 && (
        <div className="flex gap-2" role="tablist" aria-label="Roster period">
          {board.periods.map(item => (
            <button key={item.key} type="button" role="tab" aria-selected={period === item.key}
              className={`rounded-full px-3 py-1.5 text-sm font-semibold ${period === item.key ? "bg-emerald-500 text-slate-950" : "bg-slate-800 text-slate-300"}`}
              onClick={() => { setPeriod(item.key); void load(item.key); }}>
              {periodLabel(item.key)}{item.state === "unavailable" ? " · Soon" : item.state === "locked" ? " · Locked" : ""}
            </button>
          ))}
        </div>
      )}

      {loading && <div className="rounded-xl border border-slate-800 bg-slate-900 p-6 text-sm text-slate-400">Loading Salary Cap board…</div>}
      {error && <div className="rounded-xl border border-red-900 bg-red-950/50 px-4 py-3 text-sm text-red-200">{error}</div>}
      {invalid.length > 0 && <p role="alert" className="text-sm text-red-300">Selected golfers are now ineligible or unpriced: {invalid.map(id => golferById.get(id)?.name ?? `Golfer ${id}`).join(", ")}. Your selections have been retained; remove them before saving.</p>}
      {revisionConflict && <p role="alert" className="text-sm text-amber-300">The saved lineup changed elsewhere. Your unsaved selections are retained. <button type="button" className="underline" onClick={() => void load(period)}>Discard local selections and reload saved lineup</button></p>}

      {board && !loading && !groupLoading && !isSwitchingGroup && (
        <>
          <div className="sticky top-2 z-10 rounded-2xl border border-slate-700 bg-slate-900/95 p-3 shadow-sm backdrop-blur">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {Array.from({ length: board.rosterSize }, (_, index) => {
                const golfer = golferById.get(selected[index]);
                return (
                  <button key={index} type="button" disabled={saving || !selected[index] || board.period.state !== "open"}
                    onClick={() => setSelected(current => current.filter(id => id !== selected[index]))}
                    className={`min-h-16 rounded-xl border px-3 py-2 text-left ${golfer ? "border-emerald-700 bg-emerald-950/50" : "border-dashed border-slate-700 bg-slate-950"}`}>
                    <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-400">Golfer {index + 1}</span>
                    <span className="mt-1 block truncate text-sm font-bold text-white">{golfer?.name ?? (selected[index] ? `Unavailable golfer ${selected[index]}` : "Open slot")}</span>
                    <span className="block text-xs text-slate-300">{golfer?.effectiveSalary === null || golfer?.effectiveSalary === undefined ? "—" : dollars(golfer.effectiveSalary)}</span>
                  </button>
                );
              })}
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 pt-3">
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-200">
                <span>Cap: <strong>{dollars(board.budget)}</strong></span>
                <span>Used: <strong>{dollars(used)}</strong></span>
                <span>Remaining: <strong>{dollars(golfCentsToMoney(budgetCents - usedCents))}</strong></span>
                <span className={unsaved ? "text-amber-700" : "text-emerald-700"}>{unsaved ? "Unsaved" : board.lineup ? "Saved" : "Not saved"}</span>
              </div>
              <button type="button" onClick={saveLineup}
                disabled={saving || revisionConflict || invalid.length > 0 || usedCents > budgetCents || board.period.state !== "open" || selected.length !== board.rosterSize || !unsaved || board.priceSet?.status !== "frozen"}
                className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-bold text-slate-950 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400">
                {saving ? "Saving…" : "Save Lineup"}
              </button>
            </div>
            {message && <p className="mt-2 text-sm font-medium text-emerald-300">{message}</p>}
            {board.period.state !== "open" && <p className="mt-2 text-sm text-slate-300">{board.period.state === "unavailable" ? "This roster period is not open yet." : "This roster period is read-only."}</p>}
            {board.priceSet?.status !== "frozen" && <p className="mt-2 text-sm text-amber-300">A commissioner must generate and freeze tournament salaries.</p>}
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-700 bg-slate-900">
            <div className="border-b border-slate-800 bg-slate-950 px-3 py-2">
              <input aria-label="Search golfers" type="search" value={golferSearch} onChange={event => setGolferSearch(event.target.value)}
                placeholder="Search golfers..." className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-500" />
            </div>
            <div className="grid grid-cols-[1fr_auto_auto] gap-3 border-b border-slate-700 bg-slate-950 px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">
              <span>Golfer</span><span>Status</span><span>Salary</span>
            </div>
            <div className="divide-y divide-slate-800">
              {visibleGolfers.map(golfer => {
                const chosen = selected.includes(golfer.playerId);
                const reason = disabledReason(golfer);
                return (
                  <button key={golfer.playerId} type="button" disabled={!chosen && Boolean(reason)}
                    onClick={() => setSelected(current => chosen ? current.filter(id => id !== golfer.playerId) : [...current, golfer.playerId])}
                    title={reason ?? undefined}
                    className={`grid w-full grid-cols-[1fr_auto_auto] items-center gap-3 px-3 py-3 text-left ${chosen ? "bg-emerald-950/60" : reason ? "cursor-not-allowed opacity-45" : "hover:bg-slate-800"}`}>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-white">{golfer.name}{golfer.isAmateur ? " (a)" : ""}</span>
                      <span className="block truncate text-xs text-slate-400">{golfer.owgrRank ? `OWGR ${golfer.owgrRank}` : golfer.country ?? "Tournament field"}{reason && !chosen ? ` · ${reason}` : ""}</span>
                    </span>
                    <span className="text-xs capitalize text-slate-400">{golfer.fieldStatus?.replaceAll("_", " ") ?? "field"}</span>
                    <span className="text-sm font-bold tabular-nums text-white">{golfer.effectiveSalary === null ? "—" : dollars(golfer.effectiveSalary)}</span>
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
