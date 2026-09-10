import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { canPlayerFillRosterSlot, expandRosterSlots, getRosterSlotsFromRulesSnapshot } from "@/lib/rules/leagueRules";
import { getDraftTurn, type DraftHistory } from "./draftHistory";

export function isMissingDraftInfrastructure(error: { code?: string } | null) {
  return error?.code === "42P01" || error?.code === "PGRST205" || error?.code === "PGRST202";
}

/** Call only after active Group/slate authorization. All queries retain full scope. */
export async function readDraftHistory(slateId: number, groupId: string, leagueId: string, sport: "nba" | "nfl"): Promise<DraftHistory> {
  const result = await supabaseAdmin.rpc("read_fantasy_draft", { p_slate_id: slateId, p_group_id: groupId, p_league_id: leagueId, p_sport: sport });
  if (isMissingDraftInfrastructure(result.error)) return { available: false, initialized: false, picks: [], corrections: [], turn: { state: "needs_review" } };
  if (result.error) throw new Error(result.error.message);
  const data = result.data;
  if (!data) throw new Error("Draft not found in the authorized scope.");
  const slots: { slot_count: number }[] = data.roster_slots ?? getRosterSlotsFromRulesSnapshot(data.rules_snapshot, sport);
  const rosterSize = slots.reduce((n, s) => n + s.slot_count, 0);
  const counts = data.roster_counts as Record<number, number>;
  const picks = data.picks as DraftHistory["picks"];
  const initialized = data.initialized === true;
  const populated = Object.values(counts).some(n => n > 0);
  const unsupported = data.rules_snapshot?.draft?.type && data.rules_snapshot.draft.type !== "snake";
  const turn = (!initialized && populated) || unsupported ? { state: "needs_review" as const } : getDraftTurn(data.participant_ids, rosterSize, Math.max(0, ...picks.map(p => p.overall_pick)), counts);
  return { available: true, initialized, picks, corrections: data.corrections,
    turn: data.is_locked && turn.state !== "complete" ? { state: "closed" } : turn };
}

type SavedSlot = { player_id: number; roster_slot_position: string | null; roster_slot_index: number | null };

/** Keep saved slots pinned; match only unassigned players using canonical eligibility. */
export function buildDraftAssignments(sport: "nba" | "nfl", players: { id: number; position: string }[], slots: ReturnType<typeof getRosterSlotsFromRulesSnapshot>, saved: SavedSlot[], requested?: { playerId: number; position: string; slotIndex: number } | null) {
  const expanded = expandRosterSlots(slots);
  const assigned = new Map<number, number>();
  const pinned = new Set<number>();
  for (const player of players) {
    const previous = saved.find(s => s.player_id === player.id);
    const position = requested?.playerId === player.id ? requested.position : previous?.roster_slot_position;
    const index = requested?.playerId === player.id ? requested.slotIndex : previous?.roster_slot_index;
    if (position == null || index == null) continue;
    const slot = expanded.findIndex(s => s.position === position && s.slotIndex === index);
    if (slot < 0 || assigned.has(slot) || !canPlayerFillRosterSlot(sport, player.position, position)) throw new Error("The selected roster slot is occupied or invalid.");
    assigned.set(slot, player.id); pinned.add(slot);
  }
  function place(playerId: number, seen: Set<number>): boolean {
    const player = players.find(p => p.id === playerId)!;
    for (let i = 0; i < expanded.length; i++) {
      if (pinned.has(i) || seen.has(i) || !canPlayerFillRosterSlot(sport, player.position, expanded[i].position)) continue;
      seen.add(i);
      const occupant = assigned.get(i);
      if (occupant == null || place(occupant, seen)) { assigned.set(i, playerId); return true; }
    }
    return false;
  }
  for (const player of players) {
    if (![...assigned.values()].includes(player.id) && !place(player.id, new Set())) throw new Error("That lineup does not fit the configured roster.");
  }
  return [...assigned].map(([i, player_id]) => ({ player_id, position: expanded[i].position, slot_index: expanded[i].slotIndex }));
}

export async function mutateFantasyDraft(input: {
  slateId: number; groupId: string; leagueId: string; sport: "nba" | "nfl"; teamId: number; actorId: string;
  desiredIds: number[]; expectedIds: number[]; correction?: boolean;
  requestedSlot?: { playerId: number; position: string; slotIndex: number } | null;
  projection?: Record<string, unknown> | null;
}) {
  const [slate, lineup, players] = await Promise.all([
    supabaseAdmin.from("slates").select("rules_snapshot").eq("id", input.slateId).eq("league_id", input.leagueId).eq("sport", input.sport).single(),
    supabaseAdmin.from("lineups").select("id,lineup_players(player_id,roster_slot_position,roster_slot_index)").eq("slate_id", input.slateId).eq("team_id", input.teamId).maybeSingle(),
    supabaseAdmin.from(input.sport === "nfl" ? "players_nfl" : "players").select(input.sport === "nfl" ? "id,position" : "id,position:position_group").in("id", input.desiredIds),
  ]);
  const error = slate.error || lineup.error || players.error;
  if (error) throw new Error(error.message);
  const rosterSlots = getRosterSlotsFromRulesSnapshot(slate.data.rules_snapshot, input.sport);
  const assignments = buildDraftAssignments(input.sport, players.data as unknown as { id: number; position: string }[], rosterSlots, (lineup.data?.lineup_players ?? []) as SavedSlot[], input.requestedSlot);
  return supabaseAdmin.rpc("mutate_fantasy_draft", {
    p_slate_id: input.slateId, p_group_id: input.groupId, p_league_id: input.leagueId, p_sport: input.sport,
    p_team_id: input.teamId, p_actor_id: input.actorId,
    p_intent: { desired_ids: input.desiredIds, expected_ids: input.expectedIds, correction: input.correction === true,
      roster_slots: rosterSlots.map(s => ({ position: s.position, slot_count: s.slot_count })),
      rules_snapshot: slate.data.rules_snapshot, assignments, projection: input.projection ?? null },
  });
}
