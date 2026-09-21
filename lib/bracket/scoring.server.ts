import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  bracketResultsFromOfficialGames,
  bracketScoringRulesFromSnapshot,
  scoreBracket,
} from "@/lib/bracket/scoring";
import { bracketTopologyFromRows } from "@/lib/bracket/persistence";
import type { BracketPicks, BracketScore } from "@/lib/bracket/types";

type FrozenEntryRow = {
  id: number;
  competition_id: number;
  locked_at: string | null;
  rules_snapshot: Record<string, unknown> | null;
};

type GameRow = {
  id: number;
  game_key: string;
  round_key: string;
  round_order: number;
  game_order: number;
  source_a_team_id: string | null;
  source_a_game_id: number | null;
  source_b_team_id: string | null;
  source_b_game_id: number | null;
  status: string;
  winner_team_id: string | null;
};

type FrozenPickRow = {
  id: number;
  game_id: number;
  picked_team_id: string;
};

/**
 * Recomputes one frozen Group contest entry from its immutable picks/rules and
 * the global competition's official results. It never reads master picks or
 * mutable contest rules, and persists only the intentionally mutable scoring
 * fields on normalized frozen picks.
 *
 * This is the future provider/manual-correction hook: persist official game
 * `status = final` + `winner_team_id`, then call this function for affected
 * locked entries (or a competition-scoped wrapper).
 */
export async function recomputeFrozenBracketEntry(
  entryId: number,
): Promise<BracketScore> {
  const entryResult = await supabaseAdmin
    .from("bracket_entries")
    .select("id, competition_id, locked_at, rules_snapshot")
    .eq("id", entryId)
    .maybeSingle();

  if (entryResult.error) {
    throw new Error(
      `Failed to load frozen bracket entry: ${entryResult.error.message}`,
    );
  }

  const entry = entryResult.data as FrozenEntryRow | null;

  if (!entry || !entry.locked_at) {
    throw new Error("Bracket scoring requires a frozen entry.");
  }

  const [gamesResult, picksResult] = await Promise.all([
    supabaseAdmin
      .from("bracket_games")
      .select(
        "id, game_key, round_key, round_order, game_order, source_a_team_id, source_a_game_id, source_b_team_id, source_b_game_id, status, winner_team_id",
      )
      .eq("competition_id", entry.competition_id),
    supabaseAdmin
      .from("bracket_picks")
      .select("id, game_id, picked_team_id")
      .eq("entry_id", entry.id)
      .eq("competition_id", entry.competition_id),
  ]);

  if (gamesResult.error) {
    throw new Error(
      `Failed to load bracket results: ${gamesResult.error.message}`,
    );
  }

  if (picksResult.error) {
    throw new Error(
      `Failed to load frozen bracket picks: ${picksResult.error.message}`,
    );
  }

  const games = (gamesResult.data ?? []) as GameRow[];
  const topology = bracketTopologyFromRows(games);
  const gameKeyById = new Map(
    games.map((game) => [Number(game.id), game.game_key]),
  );
  const picks: BracketPicks = {};
  const pickIdByGameKey = new Map<string, number>();

  for (const pick of (picksResult.data ?? []) as FrozenPickRow[]) {
    const gameKey = gameKeyById.get(Number(pick.game_id));

    if (!gameKey) {
      throw new Error(
        `Frozen bracket pick ${pick.id} references an unknown game.`,
      );
    }

    picks[gameKey] = pick.picked_team_id;
    pickIdByGameKey.set(gameKey, Number(pick.id));
  }

  const score = scoreBracket(
    topology,
    picks,
    bracketResultsFromOfficialGames(
      games.map((game) => ({
        gameId: game.game_key,
        status: game.status,
        winnerTeamId: game.winner_team_id,
      })),
    ),
    bracketScoringRulesFromSnapshot(entry.rules_snapshot, topology),
  );

  await Promise.all(
    score.breakdown.flatMap((pick) => {
      const pickId = pickIdByGameKey.get(pick.gameId);

      if (!pickId) return [];

      return [
        supabaseAdmin
          .from("bracket_picks")
          .update({
            is_correct: pick.correct,
            points_awarded: pick.awardedPoints,
            updated_at: new Date().toISOString(),
          })
          .eq("id", pickId)
          .eq("entry_id", entry.id)
          .eq("competition_id", entry.competition_id),
      ];
    }),
  ).then((updates) => {
    for (const update of updates) {
      if (update.error) {
        throw new Error(
          `Failed to persist bracket scoring: ${update.error.message}`,
        );
      }
    }
  });

  return score;
}

/**
 * Competition-level hook for an official result refresh or correction. Entries
 * remain independently scored because each call reads that entry's own frozen
 * picks and rules snapshot.
 */
export async function recomputeFrozenBracketEntriesForCompetition(
  competitionId: number,
): Promise<Array<{ entryId: number; score: BracketScore }>> {
  const entriesResult = await supabaseAdmin
    .from("bracket_entries")
    .select("id")
    .eq("competition_id", competitionId)
    .not("locked_at", "is", null);

  if (entriesResult.error) {
    throw new Error(
      `Failed to load frozen bracket entries: ${entriesResult.error.message}`,
    );
  }

  return Promise.all(
    (entriesResult.data ?? []).map(async (entry) => ({
      entryId: Number(entry.id),
      score: await recomputeFrozenBracketEntry(Number(entry.id)),
    })),
  );
}
