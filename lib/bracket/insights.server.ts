import "server-only";

import type { AppUser } from "@/lib/auth";
import { getBracketChallengeDetail } from "./challenge.server";
import { bracketTopologyFromRows } from "./persistence";
import { bracketInsightVisibility, deriveBracketConsensus, deriveBracketIdentity, type FrozenInsightEntry } from "./insights";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function getBracketInsights(user: AppUser, contestId: string, request: {
  entryId?: number; entrantId?: string; bracketNumber?: number;
}) {
  const detail = await getBracketChallengeDetail(user, contestId);
  if (!detail) return null;
  const topology = bracketTopologyFromRows(detail.games.map((game) => ({
    id: game.id, game_key: game.gameKey, round_key: game.roundKey,
    round_order: game.roundOrder, game_order: game.gameOrder,
    source_a_team_id: game.sourceATeamId, source_a_game_id: game.sourceAGameId,
    source_b_team_id: game.sourceBTeamId, source_b_game_id: game.sourceBGameId,
  })));
  const entriesQuery = await supabaseAdmin.from("bracket_entries")
    .select("id, entrant_id, master_bracket_id, locked_at, picks_snapshot, rules_snapshot")
    .eq("contest_id", contestId).eq("competition_id", detail.competition.id);
  if (entriesQuery.error) throw new Error(`Failed to load insight cohort: ${entriesQuery.error.message}`);
  const rows = entriesQuery.data ?? [];
  const entries: FrozenInsightEntry[] = rows.map((entry) => ({
    id: Number(entry.id), entrantId: String(entry.entrant_id), lockedAt: entry.locked_at,
    picks: entry.picks_snapshot, rulesSnapshot: entry.rules_snapshot,
  }));
  const visibility = bracketInsightVisibility({ contestStatus: detail.contest.status, contestLockAt: detail.contest.lockAt }, entries);
  let selected = request.entryId ? rows.find((entry) => Number(entry.id) === request.entryId) : undefined;
  let masterId: string | null = selected?.master_bracket_id ?? null;
  let entrantId = selected?.entrant_id ?? request.entrantId ?? null;
  let owner = false;
  if (entrantId) {
    const entrantQuery = await supabaseAdmin.from("bracket_entrants")
      .select("account_user_id, managing_user_id")
      .eq("id", entrantId).maybeSingle();
    if (entrantQuery.error) throw new Error(`Failed to load insight entrant: ${entrantQuery.error.message}`);
    owner = entrantQuery.data?.account_user_id === user.id || entrantQuery.data?.managing_user_id === user.id;
  }
  if (!selected && !request.entryId && owner && entrantId) {
    const masterQuery = await supabaseAdmin.from("bracket_master_brackets")
      .select("id")
      .eq("competition_id", detail.competition.id).eq("entrant_id", entrantId)
      .eq("bracket_number", request.bracketNumber ?? 1).maybeSingle();
    if (masterQuery.error) throw new Error(`Failed to load insight bracket: ${masterQuery.error.message}`);
    masterId = masterQuery.data?.id ?? null;
    selected = rows.find((entry) => entry.master_bracket_id === masterId);
  }
  if (request.entryId && !selected) return { error: "Bracket entry not found." };
  if (visibility.pool === "pre_lock" && !owner) return { error: "This bracket is private until lock." };
  if (!selected && !owner) return { error: "Bracket not found." };

  let picks = selected?.locked_at ? selected.picks_snapshot : null;
  let rulesSnapshot = selected?.locked_at ? selected.rules_snapshot : null;
  if (!picks && owner && visibility.pool === "pre_lock" && masterId) {
    const picksQuery = await supabaseAdmin.from("bracket_master_picks")
      .select("game_id, picked_team_id").eq("master_bracket_id", masterId)
      .eq("competition_id", detail.competition.id);
    if (picksQuery.error) throw new Error(`Failed to load insight picks: ${picksQuery.error.message}`);
    const keyById = new Map(detail.games.map((game) => [game.id, game.gameKey]));
    picks = Object.fromEntries((picksQuery.data ?? []).flatMap((pick) => {
      const key = keyById.get(Number(pick.game_id));
      return key ? [[key, pick.picked_team_id]] : [];
    }));
  }
  if (!picks) return { error: "Frozen bracket is not ready." };
  const identity = deriveBracketIdentity({ topology, picks,
    officialGames: detail.games.map((game) => ({ gameId: game.gameKey, status: game.status, winnerTeamId: game.winnerTeamId })),
    rulesSnapshot,
  });
  return {
    visibility, identity,
    pool: visibility.pool === "available" ? deriveBracketConsensus(topology, entries) : null,
    teamNames: Object.fromEntries(detail.teams.map((team) => [team.providerTeamId, team.displayName])),
  };
}
