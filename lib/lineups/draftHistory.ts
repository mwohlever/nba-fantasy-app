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
  /** Display-only NFL configuration from the existing authoritative draft read. */
  board?: { participantIds: number[]; rosterSize: number };
  turn: { state: "empty" | "active" | "complete" | "closed" | "needs_review"; overallPick?: number; round?: number; pickInRound?: number; teamId?: number };
};

export type DraftBoardRow = {
  overallPick: number;
  round: number;
  pickInRound: number;
  teamId: number;
  pick?: DraftPick;
};

/** Build informational slots only. Never infer a cursor or change historical picks. */
export function buildDraftBoard(configuration: NonNullable<DraftHistory["board"]>, picks: DraftPick[]): DraftBoardRow[] | null {
  const { participantIds, rosterSize } = configuration;
  if (!participantIds.length || new Set(participantIds).size !== participantIds.length ||
    participantIds.some(id => !Number.isSafeInteger(id) || id <= 0) || !Number.isSafeInteger(rosterSize) || rosterSize < 1) return null;
  const rows = Array.from({ length: participantIds.length * rosterSize }, (_, index) => {
    const roundIndex = Math.floor(index / participantIds.length);
    const offset = index % participantIds.length;
    return { overallPick: index + 1, round: roundIndex + 1, pickInRound: offset + 1,
      teamId: participantIds[roundIndex % 2 ? participantIds.length - 1 - offset : offset] } as DraftBoardRow;
  });
  for (const pick of picks) {
    const row = rows[pick.overall_pick - 1];
    // Ambiguous/legacy history keeps its existing display rather than being hidden
    // or "repaired" by a generated board.
    if (!row || row.pick || row.teamId !== pick.team_id || row.round !== pick.round_number || row.pickInRound !== pick.pick_in_round) return null;
    row.pick = pick;
  }
  const lastPick = Math.max(0, ...picks.map(pick => pick.overall_pick));
  if (rows.slice(0, lastPick).some(row => !row.pick)) return null;
  return rows;
}

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

/** Resolve linked corrections without changing any historical pick fields. */
export function effectiveDraftPick(pick: DraftPick, corrections: DraftHistory["corrections"]) {
  const trail = corrections.filter(c => c.pick_id === pick.id && c.team_id === pick.team_id).sort((a, b) => a.id - b.id);
  const latest = trail.at(-1);
  return {
    playerId: latest ? latest.new_player_id : pick.status === "active" ? pick.player_id : null,
    playerName: latest ? latest.new_player_name ?? (latest.new_player_id ? "Replacement player" : "Removed") : pick.player_name,
    corrected: trail.length > 0 || pick.status === "reversed",
    trail,
  };
}

/** A refill is an audited roster adjustment, never a rewind of the snake cursor. */
export function hasRecordedDraftVacancy(history: DraftHistory, teamId: number, playerIds: number[]) {
  if (!history.available || !history.initialized || history.turn.state === "closed") return false;
  const picks = history.picks.filter(pick => pick.team_id === teamId);
  if (playerIds.length >= picks.length) return false;
  const effective = picks.map(pick => effectiveDraftPick(pick, history.corrections));
  if (!effective.some(pick => pick.playerId === null && pick.trail.length > 0)) return false;
  const activeIds = new Set(effective.flatMap(pick => pick.playerId === null ? [] : [pick.playerId]));
  // The existing RPC records commissioner additions as standalone roster events.
  // Replay those too, including removals of an earlier refill.
  for (const correction of history.corrections.filter(c => c.team_id === teamId && c.pick_id === null).sort((a, b) => a.id - b.id)) {
    if (correction.old_player_id !== null) activeIds.delete(correction.old_player_id);
    if (correction.new_player_id !== null) activeIds.add(correction.new_player_id);
  }
  return activeIds.size === playerIds.length && playerIds.every(id => activeIds.has(id));
}

export function draftStateLabel(history: DraftHistory | null | undefined, locked: boolean) {
  if (history?.turn.state === "complete") return "Draft Complete";
  if (locked || history?.turn.state === "closed") return "Draft Locked";
  if (!history) return "Draft Loading";
  if (!history.available) return "Draft Setup Pending";
  if (history.turn.state === "needs_review") return "Draft Needs Review";
  return "Draft Open";
}
