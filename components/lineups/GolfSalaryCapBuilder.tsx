"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePullToRefresh } from "@/lib/client/usePullToRefresh";
import type { RefreshOutcome } from "@/lib/client/refreshOutcome";
import PullToRefreshIndicator from "@/components/ui/PullToRefreshIndicator";
import { useGroupContext } from "@/components/providers/GroupProvider";
import PlayerResearchModal, { type GolfSalaryCapProfileContext, type ResearchPlayer } from "@/components/lineups/PlayerResearchModal";
import GolfCompareModal from "@/components/lineups/GolfCompareModal";
import PlayerHeadshot from "@/components/ui/PlayerHeadshot";

import { canAddGolfSalaryCapPlayer } from "@/lib/golf/salaryCap";
import { formatGolfMoney, golfCentsToMoney, golfMoneyToCents } from "@/lib/golf/money";

type PeriodKey = "full_tournament" | "opening" | "weekend";
type Golfer = {
  playerId: number;
  name: string;
  espnPlayerId: string | null;
  headshotUrl: string | null;
  country: string | null;
  owgrRank: number | null;
  fieldStatus: string | null;
  teeTime: string | null;
  isAmateur: boolean;
  suggestedSalary: string | null;
  overrideSalary: string | null;
  valueBasis: string | null;
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
  const [detailGolfer, setDetailGolfer] = useState<Golfer | null>(null);
  const [compareMode, setCompareMode] = useState(false);
  const [comparePlayerIds, setComparePlayerIds] = useState<number[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);
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
  const compareGolfers = comparePlayerIds.map(id => golferById.get(id)).filter((golfer): golfer is Golfer => Boolean(golfer));
  function toggleComparePlayer(playerId: number) {
    setComparePlayerIds(current => current.includes(playerId) ? current.filter(id => id !== playerId) : current.length >= 3 ? current : [...current, playerId]);
  }

  const detailPlayer: ResearchPlayer | null = detailGolfer ? {
    id: detailGolfer.playerId, name: detailGolfer.name,
    espnGolfPlayerId: detailGolfer.espnPlayerId, headshotUrl: detailGolfer.headshotUrl,
    country: detailGolfer.country, owgrRank: detailGolfer.owgrRank,
  } : null;
  const detailSalaryCapContext: GolfSalaryCapProfileContext | null = detailGolfer ? {
    effectiveSalary: detailGolfer.effectiveSalary, suggestedSalary: detailGolfer.suggestedSalary,
    overrideSalary: detailGolfer.overrideSalary, valueBasis: detailGolfer.valueBasis,
    selected: selected.includes(detailGolfer.playerId),
    remainingBudget: golfCentsToMoney(budgetCents - usedCents),
  } : null;

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
            <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-2 border-b border-slate-700 bg-slate-950 px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">
              <span>Golfer</span><span>Status</span><span>Salary</span><span className="sr-only">Roster action</span>
            </div>
            <div className="divide-y divide-slate-800">
              {visibleGolfers.map(golfer => {
                const chosen = selected.includes(golfer.playerId);
                const reason = disabledReason(golfer);
                return (
                  <div key={golfer.playerId} onClick={compareMode ? () => toggleComparePlayer(golfer.playerId) : undefined} className={`grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-2 px-3 py-2 ${compareMode && comparePlayerIds.includes(golfer.playerId) ? "bg-emerald-800 ring-1 ring-emerald-300" : chosen ? "bg-emerald-950/60" : "hover:bg-slate-800"}`}>
                    <span className="flex min-w-0 items-center gap-2">
                      <button type="button" aria-label={`View ${golfer.name}`} onClick={() => !compareMode && setDetailGolfer(golfer)} className="shrink-0 rounded-full focus:outline-none focus:ring-2 focus:ring-emerald-400">
                        <PlayerHeadshot espnGolfPlayerId={golfer.espnPlayerId} imageUrl={golfer.headshotUrl} playerName={golfer.name} size="sm" className="border-slate-600 bg-slate-800" />
                      </button>
                      <button type="button" onClick={() => !compareMode && setDetailGolfer(golfer)} className="min-w-0 text-left focus:outline-none focus:ring-2 focus:ring-emerald-400">
                        <span className="block truncate text-sm font-semibold text-white">{golfer.name}{golfer.isAmateur ? " (a)" : ""}</span>
                        <span className="block truncate text-xs text-slate-400">{golfer.owgrRank ? `OWGR ${golfer.owgrRank}` : golfer.country ?? "Tournament field"}{reason && !chosen ? ` · ${reason}` : ""}</span>
                      </button>
                    </span>
                    <span className="text-xs capitalize text-slate-400">{golfer.fieldStatus?.replaceAll("_", " ") ?? "field"}</span>
                    <span className="text-sm font-bold tabular-nums text-white">{golfer.effectiveSalary === null ? "—" : dollars(golfer.effectiveSalary)}</span>
                    <button type="button" disabled={compareMode || (!chosen && Boolean(reason))} onClick={() => setSelected(current => chosen ? current.filter(id => id !== golfer.playerId) : [...current, golfer.playerId])}
                      title={reason ?? undefined} aria-label={`${chosen ? "Remove" : "Add"} ${golfer.name}`}
                      className="rounded-lg border border-slate-600 px-2 py-1.5 text-xs font-bold text-slate-100 disabled:cursor-not-allowed disabled:opacity-45">
                      {chosen ? "Remove" : "Add"}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
      {!compareMode && !compareOpen && board ? <button type="button" data-floating-compare="true" onClick={() => { setCompareMode(true); setComparePlayerIds([]); }} className="fixed bottom-[5.75rem] right-3 z-[10990] rounded-2xl border border-emerald-400/80 bg-emerald-900/95 px-4 py-3 text-sm font-black text-emerald-50 shadow-2xl">⇄ Compare Golfers</button> : null}
      {compareMode && !compareOpen ? <div data-floating-compare-selection="true" className="fixed bottom-[5.75rem] left-3 right-3 z-[11000] sm:hidden"><div className="mx-auto flex max-w-md items-center gap-2 rounded-2xl border border-emerald-700/70 bg-slate-950/95 p-2.5 text-white shadow-2xl"><div className="min-w-0 flex-1 px-1"><div className="text-xs font-black">Compare Golfers</div><div className="text-[11px] text-emerald-300">{comparePlayerIds.length}/3 selected</div></div><button type="button" onClick={() => { setCompareMode(false); setComparePlayerIds([]); }} className="shrink-0 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-bold">Cancel</button><button type="button" disabled={comparePlayerIds.length < 2} onClick={() => setCompareOpen(true)} className="shrink-0 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-black disabled:opacity-40">Compare ({comparePlayerIds.length})</button></div></div> : null}
      {detailPlayer ? <PlayerResearchModal player={detailPlayer} sport="golf" season={2026} defaultMode="season" salaryCapContext={detailSalaryCapContext} onClose={() => setDetailGolfer(null)} /> : null}
      {compareOpen ? <GolfCompareModal players={compareGolfers.map(golfer => ({ id: golfer.playerId, name: golfer.name, espnPlayerId: golfer.espnPlayerId, headshotUrl: golfer.headshotUrl, effectiveSalary: golfer.effectiveSalary }))} season={2026} showSalary onClose={() => { setCompareOpen(false); setCompareMode(false); setComparePlayerIds([]); }} /> : null}
    </section>
  );
}
