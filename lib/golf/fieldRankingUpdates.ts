import type { PgaTourFieldPlayer } from "@/lib/providers/pgaTourField";

type ExistingGolfPlayerRanking = {
  owgr_player_id: string | null;
  owgr_rank: number | null;
  owgr_points: number | null;
};

export type GolfFieldRankingUpdate = {
  id: number;
  owgr_player_id: string;
  owgr_rank: number;
  owgr_points: number | null;
  owgr_updated_at: string;
};

/**
 * PGA's confirmed tournament field is an authoritative event-specific OWGR
 * source. Existing golfers matched by name need the same rank refresh that
 * newly-created placeholder golfers receive during field import.
 *
 * A missing provider rank is deliberately not an update: it must not erase a
 * previously known rank or turn a golfer into an inferred unsupported player.
 */
export function buildGolfFieldRankingUpdates(
  fieldPlayers: readonly PgaTourFieldPlayer[],
  resolvedPlayerIds: ReadonlyMap<string, number>,
  existingPlayers: ReadonlyMap<number, ExistingGolfPlayerRanking>,
  updatedAt: string,
) {
  const updates: GolfFieldRankingUpdate[] = [];

  for (const fieldPlayer of fieldPlayers) {
    const playerId = resolvedPlayerIds.get(fieldPlayer.pgaPlayerId);
    const existing = playerId === undefined
      ? undefined
      : existingPlayers.get(playerId);
    const rank = fieldPlayer.owgrRank;

    if (
      playerId === undefined ||
      !existing ||
      typeof rank !== "number" ||
      !Number.isInteger(rank) ||
      rank <= 0
    ) {
      continue;
    }

    const next = {
      owgr_player_id: fieldPlayer.pgaPlayerId,
      owgr_rank: rank,
      owgr_points: fieldPlayer.rankingPoints,
    };

    if (
      existing.owgr_player_id === next.owgr_player_id &&
      existing.owgr_rank === next.owgr_rank &&
      existing.owgr_points === next.owgr_points
    ) {
      continue;
    }

    updates.push({ id: playerId, ...next, owgr_updated_at: updatedAt });
  }

  return updates;
}
