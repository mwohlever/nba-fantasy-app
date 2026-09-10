import type { DraftHistory } from "@/lib/lineups/draftHistory";

export default function DraftOrder({ history, teams }: { history: DraftHistory | null; teams: { id: number; name: string }[] }) {
  if (!history) return <p role="status" className="py-3 text-sm">Loading draft history…</p>;
  if (!history.available) return <p role="status" className="py-3 text-sm">Draft history setup is pending.</p>;
  const turn = history.turn;
  return <section aria-label="Draft order" className="py-2">
    <p role="status" className="mb-3 text-sm font-semibold" data-draft-pull-start="true">
      {turn.state === "complete" ? "Draft complete" : turn.state === "closed" ? "Draft closed" : turn.state === "needs_review"
        ? "Draft history or roster correction requires commissioner review"
        : `Pick ${turn.overallPick} · Round ${turn.round} · ${teams.find(t => t.id === turn.teamId)?.name ?? "Participant"} on the clock`}
    </p>
    {!history.picks.length ? <p className="py-2 text-sm text-slate-500">No recorded picks.</p> :
      <table className="w-full text-left text-xs sm:text-sm">
        <thead className="text-slate-500"><tr><th className="py-2 pr-2">#</th><th className="pr-2">Round</th><th className="pr-2">Team</th><th>Player</th><th className="pl-1">Pos</th></tr></thead>
        <tbody>{history.picks.map(pick => <tr key={pick.id} className="border-t border-slate-200/50">
          <td className="py-2 pr-2 tabular-nums">{pick.overall_pick}</td>
          <td className="pr-2 tabular-nums" title={`Round ${pick.round_number}, pick ${pick.pick_in_round}`}>{pick.round_number}<span className="text-slate-500">.{pick.pick_in_round}</span></td>
          <td className="max-w-20 break-words pr-2">{pick.team_name}</td>
          <td className="py-2"><span>{pick.player_name}</span>
            {pick.is_proxy === true && <span className="ml-1 text-[10px] text-slate-500" title={pick.actor_name ? `Drafted by ${pick.actor_name}` : "Commissioner proxy pick"}>Proxy</span>}
            {pick.status === "reversed" && <span className="ml-1 text-[10px] text-amber-600">Corrected / reversed</span>}
          </td><td className="pl-1">{pick.player_position}</td>
        </tr>)}</tbody>
      </table>}
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
