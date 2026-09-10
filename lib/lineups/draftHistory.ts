export type DraftPick = {
  id: number;
  overall_pick: number;
  round_number: number;
  pick_in_round: number;
  team_id: number;
  player_id: number;
  player_name: string;
  player_position: string;
  team_name: string;
  actor_user_id: string | null;
  actor_name?: string | null;
  is_proxy: boolean | null;
  occurred_at: string | null;
  status: "active" | "reversed";
};

export type DraftHistory = {
  available: boolean;
  initialized: boolean;
  picks: DraftPick[];
  corrections: Array<{ id: number; pick_id: number | null; team_id: number; old_player_id: number | null; new_player_id: number | null; old_player_name?: string | null; new_player_name?: string | null; actor_name?: string; created_at: string }>;
  turn: { state: "empty" | "active" | "complete" | "closed" | "needs_review"; overallPick?: number; round?: number; pickInRound?: number; teamId?: number };
};

/** Chronology never rewinds when an assignment is reversed. */
export function getDraftTurn(participantIds: number[], rosterSize: number, lastPick: number, rosterCounts: Record<number, number>): DraftHistory["turn"] {
  if (!participantIds.length || rosterSize < 1 || new Set(participantIds).size !== participantIds.length) return { state: "needs_review" };
  if (participantIds.every(id => (rosterCounts[id] ?? 0) === rosterSize)) return { state: "complete" };
  if (lastPick >= participantIds.length * rosterSize) return { state: "needs_review" };
  const roundIndex = Math.floor(lastPick / participantIds.length);
  const offset = lastPick % participantIds.length;
  const roundOrder = roundIndex % 2 ? [...participantIds].reverse() : participantIds;
  if (roundOrder.some((id, i) => (rosterCounts[id] ?? 0) !== roundIndex + (i < offset ? 1 : 0))) return { state: "needs_review" };
  const teamId = participantIds[roundIndex % 2 ? participantIds.length - 1 - offset : offset];
  if ((rosterCounts[teamId] ?? 0) !== roundIndex) return { state: "needs_review" };
  return { state: lastPick ? "active" : "empty", overallPick: lastPick + 1, round: roundIndex + 1, pickInRound: offset + 1, teamId };
}
