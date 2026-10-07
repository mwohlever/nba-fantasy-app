import { buildDraftBoard, effectiveDraftPick, type DraftPick, type DraftHistory } from "@/lib/lineups/draftHistory";

export default function DraftOrder({ history, loading = true, teams, showCompleteBoard = false, actionLabel, onMakePick, busy, canEdit, editing, onToggleEdit, onEdit, canEditPick, playerPosition }: { history: DraftHistory | null; loading?: boolean; teams: { id: number; name: string }[]; showCompleteBoard?: boolean; actionLabel?: string; onMakePick?: () => void; busy?: boolean; canEdit?: boolean; editing?: boolean; onToggleEdit?: () => void; onEdit?: (pick: DraftPick) => void; canEditPick?: (pick: DraftPick) => boolean; playerPosition?: (id: number) => string | undefined }) {
  if (!history) return <p role="status" className="py-3 text-sm">{loading ? "Loading draft history…" : "Draft history unavailable. Refresh to try again."}</p>;
  if (!history.available) return <p role="status" className="py-3 text-sm">Draft history setup is pending.</p>;
  const turn = history.turn;
  const board = showCompleteBoard && history.board ? buildDraftBoard(history.board, history.picks) : null;
  const rows = board ?? history.picks.map(pick => ({ overallPick: pick.overall_pick, round: pick.round_number, pickInRound: pick.pick_in_round, teamId: pick.team_id, pick }));
  const open = turn.state === "empty" || turn.state === "active";
  return <section aria-label="Draft order" className="py-2">
    {canEdit && <button type="button" disabled={busy} onClick={onToggleEdit} className="mb-2 text-sm font-semibold text-sky-600">{editing ? "Done" : "Edit Picks"}</button>}
    {!rows.length ? <p className="py-2 text-sm text-slate-500">No recorded picks.</p> :
      <table className={`w-full text-left text-xs sm:text-sm${board ? " table-fixed" : ""}`}>
        {board && <colgroup><col className="w-7" /><col className="w-12 sm:w-14" /><col className="w-14 sm:w-20" /><col /><col className={canEdit && editing ? "w-14 sm:w-16" : "w-9"} /></colgroup>}
        <thead className="text-slate-500"><tr><th scope="col" className="py-2 pr-2">#</th><th scope="col" className="pr-2">Round</th><th scope="col" className="pr-2">Team</th><th scope="col">Player</th><th scope="col" className="pl-1">Pos</th></tr></thead>
        <tbody>{rows.map(row => {
          const pick = row.pick;
          const effective = pick && effectiveDraftPick(pick, history.corrections);
          const current = Boolean(board && !pick && open && turn.overallPick === row.overallPick && turn.teamId === row.teamId);
          const state = pick ? effective?.corrected ? "corrected" : "completed" : current ? "current" : "future";
          return <tr key={row.overallPick} aria-current={current ? "step" : undefined} data-draft-slot={board ? row.overallPick : undefined} data-draft-state={board ? state : undefined}
            className={`border-t border-slate-200/50${current ? " bg-sky-500/10" : board && !pick ? " text-slate-500" : ""}`}>
          <td className="py-2 pr-2 tabular-nums">{row.overallPick}</td>
          <td className="pr-2 tabular-nums" title={`Round ${row.round}, pick ${row.pickInRound}`}>{row.round}<span className="text-slate-500">.{row.pickInRound}</span></td>
          <td className="max-w-20 break-words pr-2">{pick?.team_name ?? teams.find(team => team.id === row.teamId)?.name ?? `Team ${row.teamId}`}</td>
          <td className={`py-2${board ? " break-words pr-1" : ""}`}>
            {pick && effective ? <>
              <span>{effective.playerName}</span>
              {pick.is_proxy === true && <span className="ml-1 text-[10px] text-slate-500" title={pick.actor_name ? `Drafted by ${pick.actor_name}` : "Commissioner proxy pick"}>Proxy</span>}
              {effective.corrected && <span className="ml-1 text-[10px] text-amber-600">Corrected / reversed</span>}
              {effective.corrected && <details className="text-[10px] text-slate-500"><summary>Originally {pick.player_name}</summary>
                {effective.trail.map(c => <div key={c.id}>{c.old_player_name ?? "Player"} → {c.new_player_name ?? "Removed"}</div>)}
              </details>}
            </> : current ? <>
              <span className="block text-[10px] font-semibold uppercase tracking-wide text-sky-600">Current pick</span>
              {actionLabel && onMakePick && <button type="button" disabled={busy} onClick={onMakePick}
                className="mt-1 rounded-lg bg-sky-600 px-2 py-1 text-left text-xs font-semibold text-white disabled:opacity-50">{actionLabel}</button>}
            </> : <span aria-label="Future pick">—</span>}
          </td><td className="pl-1">{pick && effective ? effective.playerId === pick.player_id ? pick.player_position : effective.playerId ? playerPosition?.(effective.playerId) ?? "—" : "—" : "—"}
            {pick && canEdit && editing && canEditPick?.(pick) && <button type="button" disabled={busy} aria-label={`Edit pick ${pick.overall_pick}`} onClick={() => onEdit?.(pick)} className="ml-2 text-xs text-sky-600">Edit</button>}
          </td>
        </tr>; })}</tbody>
      </table>}
    <p role="status" className="mt-3 text-sm font-semibold" data-draft-pull-start="true">
      {turn.state === "complete" ? "Draft complete" : turn.state === "closed" ? "Draft closed" : turn.state === "needs_review"
        ? "Draft history or roster correction requires commissioner review"
        : `Pick ${turn.overallPick} · Round ${turn.round}.${turn.pickInRound} · ${teams.find(t => t.id === turn.teamId)?.name ?? "Participant"} on the clock`}
    </p>
    {!board && open && actionLabel && onMakePick &&
      <button type="button" disabled={busy} onClick={onMakePick}
        className="rounded-xl bg-sky-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{actionLabel}</button>}
    {history.picks.some(p => p.occurred_at == null && p.actor_user_id == null) &&
      <p className="mt-3 text-xs text-slate-500">Original pick times and actors are unknown for backfilled picks.</p>}
    {history.corrections.length > 0 && <details className="mt-3 text-xs"><summary>Roster corrections ({history.corrections.length})</summary>
      <ul className="mt-2 space-y-2">{history.corrections.map(c => <li key={c.id}>
        {teams.find(t => t.id === c.team_id)?.name ?? `Team ${c.team_id}`} · {c.pick_id ? `Pick #${history.picks.find(p => p.id === c.pick_id)?.overall_pick ?? "unknown"}` : "Roster adjustment"}
        {c.old_player_id ? ` · removed ${c.old_player_name ?? "player"}` : ""}{c.new_player_id ? ` · added ${c.new_player_name ?? "player"}` : ""}
        {c.actor_name ? ` · by ${c.actor_name}` : ""}
      </li>)}</ul></details>}
  </section>;
}
