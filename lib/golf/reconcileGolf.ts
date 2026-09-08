import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { reconcileGolfState, type GolfObservationBatch } from "./reconcileState";

function checked<T>(result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw new Error(`Golf reconciliation: ${result.error.message}`);
  return result.data;
}

/** Optimistic slate revision + one atomic RPC; retries recompute from the winning state. */
export async function reconcileGolf(slateId: number, batch: GolfObservationBatch) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const version = checked(await supabaseAdmin.from("golf_accepted_versions").select("revision").eq("slate_id", slateId).maybeSingle());
    const revision = Number(version?.revision ?? 0);
    const results = await Promise.all([
      supabaseAdmin.from("golf_event_players").select("*, golf_rounds(*, golf_holes(*))").eq("slate_id", slateId),
      supabaseAdmin.from("lineups").select("team_id, lineup_players(player_id)").eq("slate_id", slateId),
      supabaseAdmin.from("slate_teams").select("team_id, draft_order").eq("slate_id", slateId),
      supabaseAdmin.from("team_slate_results").select("*").eq("slate_id", slateId),
      supabaseAdmin.from("slates").select("sport, has_cut, cut_penalty_per_round").eq("id", slateId).single(),
    ]);
    // Inspect every response before calculating anything.
    for (const result of results) if (result.error) throw new Error(`Golf reconciliation: ${result.error.message}`);
    const [events, lineups, slateTeams, teams, slate] = results.map(r => r.data) as any[];
    if (slate.sport !== "golf") throw new Error("Golf reconciliation requires a Golf slate.");
    const plan = reconcileGolfState({ slateId, events: events ?? [], lineups: lineups ?? [], slateTeams: slateTeams ?? [], teams: teams ?? [],
      penaltyPerRound: slate.has_cut ? Math.max(0, slate.cut_penalty_per_round ?? 0) : 0,
    }, batch, revision + 1);
    const committed = checked(await supabaseAdmin.rpc("commit_golf_reconciliation", {
      p_slate_id: slateId, p_expected_revision: revision,
      p_holes: plan.holeWrites, p_rounds: plan.roundWrites, p_events: plan.eventWrites, p_teams: plan.teamWrites,
    }));
    if (committed?.conflict) continue;
    return { ...plan, revision: Number(committed.revision) };
  }
  throw new Error("Golf data changed during reconciliation; please retry Refresh.");
}
