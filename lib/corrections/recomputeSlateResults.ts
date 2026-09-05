import "server-only";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { CorrectionSport } from "@/lib/corrections/correctionPolicy";

type LineupRow = {
  team_id: number;
  lineup_players: Array<{ player_id: number }> | null;
};

export async function recomputeCorrectedSlateResults(
  slateId: number,
  sport: CorrectionSport,
) {
  const { data: lineups, error: lineupsError } = await supabaseAdmin
    .from("lineups")
    .select("team_id, lineup_players(player_id)")
    .eq("slate_id", slateId);

  if (lineupsError) throw new Error(lineupsError.message);

  const safeLineups = (lineups ?? []) as LineupRow[];
  const playerIds = Array.from(
    new Set(
      safeLineups.flatMap((lineup) =>
        (lineup.lineup_players ?? []).map((row) => Number(row.player_id)),
      ),
    ),
  );
  const statsTable = sport === "nfl" ? "player_nfl_slate_stats" : "player_slate_stats";
  const statMap = new Map<number, number>();

  if (playerIds.length > 0) {
    const { data: stats, error: statsError } = await supabaseAdmin
      .from(statsTable)
      .select("player_id, fantasy_points")
      .eq("slate_id", slateId)
      .in("player_id", playerIds);

    if (statsError) throw new Error(statsError.message);

    (stats ?? []).forEach((row) => {
      statMap.set(Number(row.player_id), Number(row.fantasy_points ?? 0));
    });
  }

  const { data: existingResults, error: resultsError } = await supabaseAdmin
    .from("team_slate_results")
    .select("team_id, games_completed, games_in_progress, games_remaining")
    .eq("slate_id", slateId);

  if (resultsError) throw new Error(resultsError.message);

  const lifecycleByTeam = new Map(
    (existingResults ?? []).map((row) => [Number(row.team_id), row]),
  );
  const totals = safeLineups.map((lineup) => ({
    team_id: Number(lineup.team_id),
    fantasy_points: Number(
      (lineup.lineup_players ?? [])
        .reduce(
          (sum, row) => sum + Number(statMap.get(Number(row.player_id)) ?? 0),
          0,
        )
        .toFixed(1),
    ),
  }));
  const ranked = [...totals].sort((a, b) => b.fantasy_points - a.fantasy_points);

  for (const row of ranked) {
    const lifecycle = lifecycleByTeam.get(row.team_id);
    const finishPosition =
      ranked.findIndex((candidate) => candidate.fantasy_points === row.fantasy_points) + 1;
    const { error } = await supabaseAdmin.from("team_slate_results").upsert(
      {
        slate_id: slateId,
        team_id: row.team_id,
        fantasy_points: row.fantasy_points,
        finish_position: finishPosition,
        games_completed: Number(lifecycle?.games_completed ?? 0),
        games_in_progress: Number(lifecycle?.games_in_progress ?? 0),
        games_remaining: Number(lifecycle?.games_remaining ?? 0),
      },
      { onConflict: "slate_id,team_id" },
    );

    if (error) throw new Error(error.message);
  }

  return ranked.map((row) => ({
    ...row,
    finish_position:
      ranked.findIndex((candidate) => candidate.fantasy_points === row.fantasy_points) + 1,
  }));
}
