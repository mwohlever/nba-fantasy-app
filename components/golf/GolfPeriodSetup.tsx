"use client";
import { useEffect, useState } from 'react';
type PeriodBoard = {
  rosters: Array<{ team_id: number; player_ids: number[]; revision: number }>;
  periods: Array<{ period_key: string; opened_at: string | null; locked_at: string | null; completed_at: string | null;
    evidence_snapshot: { players?: Array<{ playerId: number; eligibility: string }> } | null }>;
  field: Array<{ player_id: number; golf_players: { display_name: string } }>;
};

export default function GolfPeriodSetup({ slateId, salaryCap, rosterSize, teams }: {
  slateId: number; salaryCap: boolean; rosterSize: number;
  teams: Array<{ team_id: number; team_name: string; is_participating: boolean }>;
}) {
  const [data, setData] = useState<PeriodBoard | null>(null);
  const [edits, setEdits] = useState<Record<number, number[]>>({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  async function load(signal?: AbortSignal) {
    const response = await fetch(`/api/admin/golf/period-rosters?slateId=${slateId}`, { cache: 'no-store', signal });
    const result = await response.json(); if (!response.ok) throw new Error(result.error);
    if (!signal?.aborted) { setData(result); setEdits({}); }
  }
  useEffect(() => { const controller = new AbortController();
    load(controller.signal).catch(e => { if (!controller.signal.aborted) setMessage(e.message); });
    return () => controller.abort();
  }, [slateId]);
  async function submit(teamId?: number) {
    setBusy(true); setMessage('');
    try {
      const response = await fetch(teamId ? '/api/admin/golf/period-rosters' : '/api/admin/golf/salary-cap', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(teamId ? { slateId, teamId, playerIds: edits[teamId], expectedRevision: data?.rosters.find(r => r.team_id === teamId)?.revision ?? null }
          : { slateId, action: 'open_weekend' }),
      });
      const result = await response.json(); if (!response.ok) throw new Error(result.error);
      await load(); setMessage(teamId ? 'Weekend roster saved. Opening is unchanged.' : 'Weekend is open.');
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Weekend setup failed.'); }
    finally { setBusy(false); }
  }
  const period = data?.periods.find(p => p.period_key === 'weekend');
  const open = period?.opened_at && !period.locked_at && !period.completed_at;
  const eligible = new Set((period?.evidence_snapshot?.players ?? []).filter(p => ['made_cut', 'continuing'].includes(p.eligibility)).map(p => p.playerId));
  return <section className="space-y-2 border-t border-slate-700 pt-3" aria-label="Weekend roster setup">
    <h3 className="text-sm font-bold">Weekend roster</h3>
    <p className="text-xs text-slate-400">Opening scores remain in R1–2. Weekend is a fresh roster for R3–4.</p>
    {message ? <p role="status" className="text-xs text-amber-300">{message}</p> : null}
    {!period?.opened_at ? <button type="button" disabled={busy} onClick={() => submit()} className="rounded-lg border border-emerald-700 px-3 py-2 text-xs">Open Weekend after confirmed R2 completion</button> : null}
    {!salaryCap && data ? <>
      <p className="text-xs text-slate-400">Commissioner: record each team’s Weekend Snake draft. Golfers are exclusive within Weekend; Opening ownership is unchanged.</p>
      {teams.filter(t => t.is_participating).map(team => {
        const saved = data.rosters.find(r => r.team_id === team.team_id);
        const ids = edits[team.team_id] ?? saved?.player_ids ?? [];
        return <div key={team.team_id} className="flex flex-wrap items-center gap-2 border-t border-slate-800 py-2">
          <span className="w-24 text-xs font-semibold">{team.team_name}</span>
          {Array.from({ length: rosterSize }, (_, index) => <select key={index} aria-label={`${team.team_name} Weekend golfer ${index + 1}`}
            disabled={busy || !open} value={ids[index] ?? ''} className="max-w-40 rounded border border-slate-600 bg-slate-900 px-2 py-2 text-xs"
            onChange={e => { const next = [...ids]; next[index] = Number(e.target.value); setEdits(previous => ({ ...previous, [team.team_id]: next })); }}>
            <option value="">Select golfer</option>
            {data.field.filter(p => eligible.has(p.player_id) || ids.includes(p.player_id)).map(p => <option key={p.player_id} value={p.player_id}>{p.golf_players.display_name}</option>)}
          </select>)}
          <button type="button" disabled={busy || !open || !edits[team.team_id] || ids.filter(Boolean).length !== rosterSize}
            onClick={() => submit(team.team_id)} className="rounded border border-slate-600 px-3 py-2 text-xs disabled:opacity-40">Save Weekend roster</button>
        </div>;
      })}
    </> : null}
  </section>;
}
