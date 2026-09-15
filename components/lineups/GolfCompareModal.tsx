"use client";

import { useEffect, useState } from "react";
import PlayerHeadshot from "@/components/ui/PlayerHeadshot";

export type GolfComparePlayer = { id: number; name: string; espnPlayerId?: string | null; headshotUrl?: string | null; effectiveSalary?: string | null };
type Props = { players: GolfComparePlayer[]; season: number; onClose: () => void; showSalary?: boolean };
type Stat = Record<string, unknown>;

export const golfCompareMetrics: Array<[string, string, number, boolean]> = [
  ["Scoring Avg", "scoring_average", 2, true], ["Cuts %", "cuts_made_pct", 1, false], ["Wins", "wins", 0, false], ["Top 5", "top_5_finishes", 0, false], ["Top 10", "top_10_finishes", 0, false],
  ["Birdies/R", "birdies_per_round", 2, false], ["Birdie %", "birdie_rate", 1, false], ["Bogey %", "bogey_rate", 1, true], ["GIR %", "greens_in_reg_pct", 1, false], ["Drive Acc %", "driving_accuracy_pct", 1, false], ["Drive Dist", "driving_distance", 1, false], ["Putts/GIR", "putts_per_gir", 2, true],
];
export function golfCompareValue(stat: Stat | undefined, key: string) { const raw = stat?.[key]; return typeof raw === "number" && Number.isFinite(raw) ? raw : null; }
export function golfCompareWinners(values: Array<number | null>, lowerIsBetter: boolean) {
  const valid = values.filter((value): value is number => value !== null);
  if (!valid.length) return new Set<number>();
  const best = lowerIsBetter ? Math.min(...valid) : Math.max(...valid);
  return new Set(values.flatMap((value, index) => value !== null && value === best ? [index] : []));
}

export default function GolfCompareModal({ players, season, onClose, showSalary = false }: Props) {
  const [stats, setStats] = useState<Map<number, Stat>>(new Map());
  useEffect(() => { let active = true; fetch(`/api/player-season-stats?season=${season}&sport=golf`, { cache: "no-store" }).then(response => response.json()).then(result => {
    if (!active) return; const rows = result.playerStats ?? result.playerSeasonStats ?? result.players ?? [];
    setStats(new Map(Array.isArray(rows) ? rows.map((row: Stat) => [Number(row.player_id), row]) : []));
  }).catch(() => { if (active) setStats(new Map()); }); return () => { active = false; }; }, [season]);
  const compared = players.slice(0, 3);
  if (compared.length < 2) return null;
  return <div className="fixed inset-0 z-[13000] flex items-start justify-center bg-slate-950/75 p-0 backdrop-blur-sm sm:items-center sm:p-6" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-label="Compare Golfers" className="max-h-[100dvh] w-full overflow-y-auto bg-slate-950 text-white shadow-2xl sm:max-h-[92vh] sm:max-w-4xl sm:rounded-[28px] sm:border sm:border-slate-700">
      <header className="sticky top-0 z-10 flex items-start justify-between border-b border-emerald-900 bg-slate-950/95 px-4 py-4 backdrop-blur"><div><p className="text-xs font-black uppercase tracking-[.2em] text-emerald-300">Head-to-Head</p><h3 className="mt-1 text-xl font-black">Compare Golfers</h3><p className="mt-1 text-xs text-slate-400">{season} PGA Season Stats</p></div><button type="button" aria-label="Close golfer comparison" onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-700 bg-slate-800 text-xl">×</button></header>
      <div className="p-3 sm:p-6">
        <div className="grid gap-2" style={{ gridTemplateColumns: `78px repeat(${compared.length}, minmax(0, 1fr))` }}><div />{compared.map(candidate => <div key={candidate.id} className="min-w-0 rounded-xl border border-emerald-800 bg-emerald-950/40 p-2 text-center"><div className="mx-auto w-fit"><PlayerHeadshot espnGolfPlayerId={candidate.espnPlayerId} imageUrl={candidate.headshotUrl} playerName={candidate.name} size="sm" /></div><p className="mt-1 truncate text-xs font-black">{candidate.name}</p></div>)}</div>
        <div className="mt-3 overflow-hidden rounded-xl border border-slate-700">{showSalary ? <div className="grid border-b border-slate-700" style={{ gridTemplateColumns: `78px repeat(${compared.length}, minmax(0, 1fr))` }}><div className="flex items-center bg-slate-900 px-2 py-2 text-[10px] font-bold uppercase text-slate-400">Salary</div>{compared.map(candidate => <div key={candidate.id} className="flex items-center justify-center border-l border-slate-700 bg-slate-900 px-1 py-2 text-xs font-black tabular-nums">{candidate.effectiveSalary ? `$${candidate.effectiveSalary}` : "—"}</div>)}</div> : null}{golfCompareMetrics.map(([label, key, digits, lowerIsBetter]) => { const values = compared.map(candidate => golfCompareValue(stats.get(candidate.id), key)); const winners = golfCompareWinners(values, lowerIsBetter); return <div key={key} className="grid border-t border-slate-700" style={{ gridTemplateColumns: `78px repeat(${compared.length}, minmax(0, 1fr))` }}><div className="flex items-center bg-slate-900 px-2 py-2 text-[10px] font-bold uppercase text-slate-400">{label}</div>{values.map((metricValue, index) => { const winner = winners.has(index); return <div key={compared[index].id} className={`flex items-center justify-center border-l border-slate-700 px-1 py-2 text-xs font-black ${winner ? "bg-sky-950 text-sky-300" : "bg-slate-900 text-white"}`}>{metricValue === null ? "—" : metricValue.toFixed(digits)}{winner ? " ✓" : ""}</div>; })}</div>; })}</div>
      </div>
    </section>
  </div>;
}
