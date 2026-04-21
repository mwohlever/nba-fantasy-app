import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type PlayerRow = {
  id: number;
  name: string;
};

type LineupRow = {
  id: number;
  team_id: number;
  slate_id: number;
};

type LineupPlayerRow = {
  lineup_id: number;
  player_id: number;
};

type PlayerSlateStatRow = {
  slate_id: number;
  player_id: number;
  fantasy_points: number | null;
};

type TeamSlateResultRow = {
  slate_id: number;
  team_id: number;
  finish_position: number | null;
};

export async function GET() {
  try {
    const [
      { data: players, error: playersError },
      { data: lineups, error: lineupsError },
      { data: lineupPlayers, error: lineupPlayersError },
      { data: playerSlateStats, error: playerSlateStatsError },
      { data: teamSlateResults, error: teamSlateResultsError },
    ] = await Promise.all([
      supabaseAdmin.from("players").select("id, name").order("name"),
      supabaseAdmin.from("lineups").select("id, team_id, slate_id"),
      supabaseAdmin.from("lineup_players").select("lineup_id, player_id"),
      supabaseAdmin.from("player_slate_stats").select("slate_id, player_id, fantasy_points"),
      supabaseAdmin.from("team_slate_results").select("slate_id, team_id, finish_position"),
    ]);

    if (playersError) {
      return NextResponse.json(
        { error: `Failed to load players: ${playersError.message}` },
        { status: 500 }
      );
    }

    if (lineupsError) {
      return NextResponse.json(
        { error: `Failed to load lineups: ${lineupsError.message}` },
        { status: 500 }
      );
    }

    if (lineupPlayersError) {
      return NextResponse.json(
        { error: `Failed to load lineup players: ${lineupPlayersError.message}` },
        { status: 500 }
      );
    }

    if (playerSlateStatsError) {
      return NextResponse.json(
        { error: `Failed to load player slate stats: ${playerSlateStatsError.message}` },
        { status: 500 }
      );
    }

    if (teamSlateResultsError) {
      return NextResponse.json(
        { error: `Failed to load team slate results: ${teamSlateResultsError.message}` },
        { status: 500 }
      );
    }

    const safePlayers = (players ?? []) as PlayerRow[];
    const safeLineups = (lineups ?? []) as LineupRow[];
    const safeLineupPlayers = (lineupPlayers ?? []) as LineupPlayerRow[];
    const safePlayerSlateStats = (playerSlateStats ?? []) as PlayerSlateStatRow[];
    const safeTeamSlateResults = (teamSlateResults ?? []) as TeamSlateResultRow[];

    const lineupById = new Map<number, LineupRow>();
    safeLineups.forEach((lineup) => {
      lineupById.set(lineup.id, lineup);
    });

    const playerSlateStatMap = new Map<string, number>();
    safePlayerSlateStats.forEach((row) => {
      const key = `${row.player_id}-${row.slate_id}`;
      playerSlateStatMap.set(key, Number(row.fantasy_points ?? 0));
    });

    const teamFinishMap = new Map<string, number | null>();
    safeTeamSlateResults.forEach((row) => {
      const key = `${row.team_id}-${row.slate_id}`;
      teamFinishMap.set(key, row.finish_position ?? null);
    });

    const playerSummaries = safePlayers
      .map((player) => {
        const draftedRows = safeLineupPlayers.filter(
          (row) => row.player_id === player.id
        );

        if (draftedRows.length === 0) {
          return null;
        }

        const appearances = draftedRows
          .map((row) => {
            const lineup = lineupById.get(row.lineup_id);
            if (!lineup) return null;

            const statKey = `${player.id}-${lineup.slate_id}`;
            const finishKey = `${lineup.team_id}-${lineup.slate_id}`;

            const fantasyPoints = Number(playerSlateStatMap.get(statKey) ?? 0);
            const finishPosition = teamFinishMap.get(finishKey) ?? null;

            return {
              lineup_id: row.lineup_id,
              slate_id: lineup.slate_id,
              team_id: lineup.team_id,
              fantasy_points: fantasyPoints,
              finish_position: finishPosition,
            };
          })
          .filter((item): item is NonNullable<typeof item> => item !== null);

        const nonZeroScores = appearances
          .map((item) => item.fantasy_points)
          .filter((score) => score > 0);

        const avgScore =
          nonZeroScores.length > 0
            ? nonZeroScores.reduce((sum, score) => sum + score, 0) / nonZeroScores.length
            : null;

        const highScore =
          nonZeroScores.length > 0 ? Math.max(...nonZeroScores) : null;

        const lowScore =
          nonZeroScores.length > 0 ? Math.min(...nonZeroScores) : null;

        const winningLineups = appearances.filter(
          (item) => item.finish_position === 1
        ).length;

        const runnerUpLineups = appearances.filter(
          (item) => item.finish_position === 2
        ).length;

        return {
          player_id: player.id,
          player_name: player.name,
          times_drafted: appearances.length,
          avg_score: avgScore,
          high_score: highScore,
          low_score: lowScore,
          winning_lineups: winningLineups,
          runner_up_lineups: runnerUpLineups,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .sort((a, b) => {
        if (b.times_drafted !== a.times_drafted) {
          return b.times_drafted - a.times_drafted;
        }

        const aAvg = a.avg_score ?? 0;
        const bAvg = b.avg_score ?? 0;
        return bAvg - aAvg;
      });

    return NextResponse.json({
      success: true,
      playerHistory: playerSummaries,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Unexpected server error while loading player history." },
      { status: 500 }
    );
  }
}
