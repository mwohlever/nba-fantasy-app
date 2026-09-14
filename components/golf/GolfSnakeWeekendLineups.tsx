"use client";
import { useEffect, useState } from 'react';
import type { GolfFantasyBoard } from '@/components/lineups/GolfScoresDashboard';

/** The existing draft remains Opening; Weekend outcomes are recorded by the commissioner. */
export default function GolfSnakeWeekendLineups({ slateId, refreshKey }: { slateId: number; refreshKey: unknown }) {
  const [state, setState] = useState<{ slateId: number; board?: GolfFantasyBoard; error?: string } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/golf/fantasy?slateId=${slateId}`, { cache: 'no-store', signal: controller.signal })
      .then(async response => { const result = await response.json(); if (!response.ok) throw new Error(result.error); return result; })
      .then(board => { if (!controller.signal.aborted) setState({ slateId, board }); })
      .catch(error => { if (!controller.signal.aborted) setState({ slateId, error: error.message }); });
    return () => controller.abort();
  }, [slateId, refreshKey]);
  if (state?.slateId !== slateId) return null;
  return <section className="space-y-2 border-y border-slate-200 py-3 text-xs" aria-label="Weekend Snake lineups">
    <h2 className="text-sm font-semibold">Weekend lineups · R3–4</h2>
    <p className="text-slate-500">The draft below is Opening (R1–2). A commissioner records the independent Weekend draft in Slate Manager after Weekend opens.</p>
    {state.error ? <p role="alert">{state.error}</p> : state.board?.teams.map(team => <div key={team.team_id} className="flex gap-3">
      <strong className="w-24 shrink-0">{team.name}</strong>
      <span>{team.contributions.filter(c => c.period === 'weekend').map(c =>
        state.board?.events.find(e => Number(e.player_id) === c.playerId)?.golf_players?.display_name ?? `Golfer ${c.playerId}`).join(', ') || 'No Weekend roster recorded'}</span>
    </div>)}
  </section>;
}
