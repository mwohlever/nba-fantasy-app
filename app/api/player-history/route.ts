import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type SlateRow = {
  id: number;
  start_date: string | null;
  date: string;
  is_locked: boolean;
};

type PlayerRow = {
  id: number;
  name: string;
};

type LineupRow = {
  id: number;
  slate_id: number;
  team_id: number;
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

function getSeasonFromDate(dateString: string) {
  return new Date(`${dateString}T00:00:00`).getFullYear();
}

function roundTo(value: number, digits = 2) {
  return Number(value.toFixed(digits));
}

export async function GET(request: NextRequest) {
  try {
    const seasonParam = request.nextUrl.searchParams.get("season");
    const selectedSeason =
      seasonParam && Number.isFinite(Number(seasonParam)) ? Number(seasonParam) : 2026;

    const [
      { data: slates, error: slatesError },
      { data: players, error: playersError },
      { data: lineups, error: lineupsError },
      { data: lineupPlayers, error: lineupPlayersError },
      { data: playerSlateStats, error: playerSlateStatsError },
      { data: teamSlateResults, error: teamSlateResultsError },
    ] = await Promise.all([
	supabaseAdmin
  .from("slates")
  .select("id, start_date, date, is_locked")
  .eq("is_locked", true),
      supabaseAdmin.from("players").select("id, name").order("name", { ascending: true }),
      supabaseAdmin.from("lineups").select("id, slate_id, team_id"),
      supabaseAdmin.from("lineup_players").select("lineup_id, player_id"),
      supabaseAdmin.from("player_slate_stats").select("slate_id, player_id, fantasy_points"),
      supabaseAdmin.from("team_slate_results").select("slate_id, team_id, finish_position"),
    ]);

    if (
      slatesError ||
      playersError ||
      lineupsError ||
      lineupPlayersError ||
      playerSlateStatsError ||
      teamSlateResultsError
    ) {
      return NextResponse.json(
        {
          error:
            slatesError?.message ||
            playersError?.message ||
            lineupsError?.message ||
            lineupPlayersError?.message ||
            playerSlateStatsError?.message ||
            teamSlateResultsError?.message ||
            "Failed to load player history data.",
        },
        { status: 500 }
      );
    }

    const safeSlates = (slates ?? []) as SlateRow[];
    const safePlayers = (players ?? []) as PlayerRow[];
    const safeLineups = (lineups ?? []) as LineupRow[];
    const safeLineupPlayers = (lineupPlayers ?? []) as LineupPlayerRow[];
    const safePlayerSlateStats = (playerSlateStats ?? []) as PlayerSlateStatRow[];
    const safeTeamSlateResults = (teamSlateResults ?? []) as TeamSlateResultRow[];

    const seasonSlateIds = new Set(
      safeSlates
        .filter((slate) => {
          const effectiveDate = slate.start_date ?? slate.date;
          return getSeasonFromDate(effectiveDate) === selectedSeason;
        })
        .map((slate) => slate.id)
    );

    const seasonLineups = safeLineups.filter((lineup) => seasonSlateIds.has(lineup.slate_id));

    const lineupMap = new Map<number, LineupRow>();
    seasonLineups.forEach((lineup) => lineupMap.set(lineup.id, lineup));

    const playerSlateStatMap = new Map<string, number>();
    safePlayerSlateStats.forEach((row) => {
      if (!seasonSlateIds.has(row.slate_id)) return;
      const key = `${row.slate_id}-${row.player_id}`;
      playerSlateStatMap.set(key, Number(row.fantasy_points ?? 0));
    });

    const finishMap = new Map<string, number | null>();
    safeTeamSlateResults.forEach((row) => {
      if (!seasonSlateIds.has(row.slate_id)) return;
      const key = `${row.slate_id}-${row.team_id}`;
      finishMap.set(key, row.finish_position ?? null);
    });

    const playerAggMap = new Map<
      number,
      {
        player_id: number;
        player_name: string;
        times_drafted: number;
        scores: number[];
        winning_lineups: number;
        runner_up_lineups: number;
      }
    >();

    safeLineupPlayers.forEach((lineupPlayer) => {
      const lineup = lineupMap.get(lineupPlayer.lineup_id);
      if (!lineup) return;

      const player = safePlayers.find((p) => p.id === lineupPlayer.player_id);
      if (!player) return;

      const scoreKey = `${lineup.slate_id}-${lineupPlayer.player_id}`;
      const finishKey = `${lineup.slate_id}-${lineup.team_id}`;

      const fantasyPoints = playerSlateStatMap.get(scoreKey) ?? 0;
      const finishPosition = finishMap.get(finishKey) ?? null;

      const current = playerAggMap.get(player.id) ?? {
        player_id: player.id,
        player_name: player.name,
        times_drafted: 0,
        scores: [],
        winning_lineups: 0,
        runner_up_lineups: 0,
      };

      current.times_drafted += 1;
      current.scores.push(fantasyPoints);

      if (finishPosition === 1) current.winning_lineups += 1;
      if (finishPosition === 2) current.runner_up_lineups += 1;

      playerAggMap.set(player.id, current);
    });

    const playerHistory = Array.from(playerAggMap.values())
      .map((row) => {
        const avgScore =
          row.scores.length > 0
            ? roundTo(row.scores.reduce((sum, value) => sum + value, 0) / row.scores.length)
            : 0;

        const highScore = row.scores.length > 0 ? roundTo(Math.max(...row.scores)) : 0;
        const lowScore = row.scores.length > 0 ? roundTo(Math.min(...row.scores)) : 0;

        return {
          player_id: row.player_id,
          player_name: row.player_name,
          times_drafted: row.times_drafted,
          avg_score: avgScore,
          high_score: highScore,
          low_score: lowScore,
          winning_lineups: row.winning_lineups,
          runner_up_lineups: row.runner_up_lineups,
        };
      })
      .sort((a, b) => {
        if (b.times_drafted !== a.times_drafted) return b.times_drafted - a.times_drafted;
        if (b.avg_score !== a.avg_score) return b.avg_score - a.avg_score;
        return a.player_name.localeCompare(b.player_name);
      });

    return NextResponse.json({
      success: true,
      season: selectedSeason,
      playerHistory,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Unexpected server error while loading player history." },
      { status: 500 }
    );
  }
}
