"use client";
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { formatGolfMoney, golfMoneyToCents } from '@/lib/golf/money';

type Price = { player_id: number; suggested_salary: string | null; override_salary: string | null; effective_salary: string | null;
  is_amateur: boolean; value_basis: string; golf_players: { display_name: string } };
type Board = { priceSet: { status: 'generated' | 'frozen'; revision: number } | null; prices: Price[] };

export default function GolfSalarySetup({ slateId }: { slateId: number }) {
  const [board, setBoard] = useState<Board | null>(null);
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function load(signal?: AbortSignal) {
    const response = await fetch(`/api/admin/golf/salary-cap?slateId=${slateId}`, { cache: 'no-store', signal });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    if (!signal?.aborted) { setBoard(result); setEdits({}); setAcknowledged(false); }
  }
  useEffect(() => {
    const controller = new AbortController(); setBoard(null); setError('');
    load(controller.signal).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [slateId]);
  async function action(action: 'generate' | 'regenerate' | 'override' | 'freeze') {
    if (action === 'regenerate' && !window.confirm('Regenerating replaces this generated board, including its reviewed overrides. Frozen salaries cannot be regenerated.')) return;
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/admin/golf/salary-cap', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slateId, action, expectedRevision: board?.priceSet?.revision,
          acknowledgeUnpriced: acknowledged,
          overrides: Object.entries(edits).map(([playerId, salary]) => {
            if (salary !== '' && golfMoneyToCents(salary) === null) throw new Error('Salary must have no more than two decimal places.');
            return { playerId: Number(playerId), salary: salary === '' ? null : Number(salary) };
          }),
        }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Salary setup failed.'); }
    finally { setBusy(false); }
  }
  const frozen = board?.priceSet?.status === 'frozen';
  const fallback = board?.prices.filter(p => p.value_basis === 'fallback') ?? [];
  const dirty = Object.keys(edits).length > 0;
  return <section className="space-y-3 rounded-xl border border-slate-700 bg-slate-950/40 p-3" aria-label="Salary Setup">
    <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-bold">Salary Setup</h3>
      <span className="text-[11px] font-semibold text-emerald-300">{!board ? 'LOADING' : frozen ? 'FROZEN' : board.priceSet ? 'GENERATED / REVIEW NEEDED' : 'NOT GENERATED'}</span></div>
    {error ? <p role="alert" className="text-sm text-red-300">{error}</p> : null}
    {board && !board.priceSet ? <button type="button" disabled={busy} onClick={() => action('generate')}
      className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold disabled:opacity-50">Generate Salaries</button> : null}
    {board?.priceSet ? <>
      <p className="text-xs text-slate-400">{frozen ? 'Tournament prices are immutable. Roster availability follows the period deadline.' : 'Review suggested salaries. Overrides affect acquisition prices only; amateurs remain $10.'}</p>
      {fallback.length ? <p className="text-xs text-amber-300">{fallback.length} golfers could not be fully priced and received the $15.00 fallback salary. Review these salaries before freezing: {fallback.map(p => p.golf_players.display_name).join(', ')}.</p> : null}
      <div className="max-h-96 overflow-auto"><table className="w-full text-left text-xs">
        <thead className="sticky top-0 bg-slate-950 text-slate-400"><tr><th className="py-2">Golfer</th><th>Suggested</th><th>Effective</th><th>Status</th></tr></thead>
        <tbody>{board.prices.map(p => <tr key={p.player_id} className={p.value_basis === 'fallback' ? 'border-t border-amber-500/30 bg-amber-950/20' : 'border-t border-slate-800'}>
          <td className="py-2 pr-2">{p.golf_players.display_name}</td><td>{p.suggested_salary === null ? '—' : `$${formatGolfMoney(p.suggested_salary)}`}</td>
          <td>{frozen ? (p.effective_salary === null ? '—' : `$${formatGolfMoney(p.effective_salary)}`) : p.value_basis === 'unsupported' ? 'Unpriced' :
            <input aria-label={`Effective salary for ${p.golf_players.display_name}`} type="number" min={10} max={42} step={0.01}
              disabled={busy || p.is_amateur} value={edits[p.player_id] ?? p.override_salary ?? p.suggested_salary ?? ''}
              onChange={e => setEdits(previous => ({ ...previous, [p.player_id]: e.target.value }))}
              className="my-1 w-16 rounded border border-slate-600 bg-slate-900 px-2 py-2 disabled:opacity-60" />}</td>
          <td className={p.value_basis === 'fallback' ? 'font-medium text-amber-200' : 'text-slate-400'}>{p.value_basis === 'fallback' ? 'Fallback — review' : p.value_basis.replaceAll('_', ' ')}</td>
        </tr>)}</tbody>
      </table></div>
      {frozen ? <Link href={`/lineups/draft?sport=golf&slateId=${slateId}`} className="inline-block rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold">Go to Lineup</Link>
        : <div className="space-y-2">
          {fallback.length ? <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)} />I reviewed the fallback salaries.</label> : null}
          <div className="flex gap-2"><button type="button" disabled={busy || !dirty} onClick={() => action('override')} className="rounded-lg border border-slate-600 px-3 py-2 text-xs disabled:opacity-40">Save Overrides</button>
            <button type="button" disabled={busy} onClick={() => action('regenerate')} className="rounded-lg border border-amber-600 px-3 py-2 text-xs disabled:opacity-40">Regenerate Salaries</button>
            <button type="button" disabled={busy || dirty || (fallback.length > 0 && !acknowledged)} onClick={() => action('freeze')} className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-bold disabled:opacity-40">Freeze Salaries</button></div>
          {dirty ? <p className="text-xs text-amber-300">Save overrides before freezing.</p> : null}
        </div>}
    </> : null}
  </section>;
}
