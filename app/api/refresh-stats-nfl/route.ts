import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  fetchScoreboardForRange,
  fetchGameSummary,
} from "@/lib/providers/nfl";
import { aggregateEspnBoxscore } from "@/lib/aggregateEspnBoxscore";
import { calculateNflFantasyPoints } from "@/lib/scoring/nfl";
import { notifyNewlyFinishedPlayers } from "@/lib/playerFinishedNotifications";
import { notifyCompletedSlate } from "@/lib/slateCompleteNotifications";

type RefreshBody = {
  slateId?: number;
};

type SlateRecord = {
  id: number;
  sport: string;
  date: string;
  start_date: string;
  end_date: string;
  is_locked: boolean;
};

type LineupWithPlayers = {
  id: number;
  team_id: number;
  lineup_players: { player_id: number }[] | null;
};

type PlayerNflRecord = {
  id: number;
  name: string;
  nfl_player_id: number | null;
  team_abbreviation: string | null;
};

function formatDateToCode(dateString: string) {
  return dateString.replace(/-/g, "");
}

function blankRow() {
  return {
    passing_yards: 0,
    passing_tds: 0,
    passing_ints: 0,
    rushing_yards: 0,
    rushing_tds: 0,
    receiving_yards: 0,
    receiving_tds: 0,
    receptions: 0,
    fumbles_lost: 0,
    fantasy_points: 0,
    game_status: null as number | null,
    game_status_text: null as string | null,
    games_completed: 0,
    games_in_progress: 0,
    games_remaining: 0,
  };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RefreshBody;
    const slateId = body.slateId;

    if (!slateId) {
      return NextResponse.json({ error: "slateId is required." }, { status: 400 });
    }

    const { data: slate, error: slateError } = await supabaseAdmin
      .from("slates")
      .select("id, sport, date, start_date, end_date, is_locked")
      .eq("id", slateId)
      .single();

    if (slateError || !slate) {
      return NextResponse.json({ error: "Slate not found." }, { status: 404 });
    }

    const safeSlate = slate as SlateRecord;

    if (safeSlate.sport !== "nfl") {
      return NextResponse.json(
        { error: "This slate is not an NFL slate." },
        { status: 400 }
      );
    }

    if (safeSlate.is_locked) {
      return NextResponse.json(
        { error: "This slate is locked. Stats cannot be refreshed." },
        { status: 400 }
      );
    }

    const { data: lineupsData, error: lineupsError } = await supabaseAdmin
      .from("lineups")
      .select(`
        id,
        team_id,
        lineup_players (
          player_id
        )
      `)
      .eq("slate_id", slateId);

    if (lineupsError) {
      return NextResponse.json(
        { error: `Failed to load lineups: ${lineupsError.message}` },
        { status: 500 }
      );
    }

    const lineups = (lineupsData ?? []) as LineupWithPlayers[];
    const draftedPlayerIds = Array.from(
      new Set(
        lineups.flatMap((lineup) =>
          (lineup.lineup_players ?? []).map((row) => row.player_id)
        )
      )
    );

    if (draftedPlayerIds.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No drafted players found for this slate.",
      });
    }

    const { data: playersData, error: playersError } = await supabaseAdmin
      .from("players_nfl")
      .select("id, name, nfl_player_id, team_abbreviation")
      .in("id", draftedPlayerIds);

    if (playersError) {
      return NextResponse.json(
        { error: `Failed to load NFL players: ${playersError.message}` },
        { status: 500 }
      );
    }

    const players = (playersData ?? []) as PlayerNflRecord[];

    const playerByEspnId = new Map<string, PlayerNflRecord>();
    const draftedTeamAbbreviations = new Set<string>();

    for (const player of players) {
      if (player.nfl_player_id) {
        playerByEspnId.set(String(player.nfl_player_id), player);
      }
      if (player.team_abbreviation) {
        draftedTeamAbbreviations.add(player.team_abbreviation.toUpperCase());
      }
    }

    // Load previous game_status per player so we can detect newly-finished players
    const { data: existingStatsData, error: existingStatsError } =
      await supabaseAdmin
        .from("player_nfl_slate_stats")
        .select("player_id, game_status")
        .eq("slate_id", slateId)
        .in("player_id", draftedPlayerIds);

    if (existingStatsError) {
      return NextResponse.json(
        { error: `Failed to load existing NFL stats: ${existingStatsError.message}` },
        { status: 500 }
      );
    }

    const previousStatuses = (existingStatsData ?? []).map((row: any) => ({
      playerId: Number(row.player_id),
      gameStatus: row.game_status ?? null,
    }));

    const startCode = formatDateToCode(safeSlate.start_date);
    const endCode = formatDateToCode(safeSlate.end_date);

    const events = await fetchScoreboardForRange(startCode, endCode);

    const relevantEvents = events.filter((event: any) => {
      const competitors = event.competitions?.[0]?.competitors ?? [];
      return competitors.some((competitor: any) =>
        draftedTeamAbbreviations.has(
          String(competitor.team?.abbreviation ?? "").toUpperCase()
        )
      );
    });

    const statByPlayerId = new Map<number, ReturnType<typeof blankRow>>();
    for (const player of players) {
      statByPlayerId.set(player.id, blankRow());
    }

    let allRelevantGamesFinal = relevantEvents.length > 0;

    for (const event of relevantEvents) {
      const summary = await fetchGameSummary(String(event.id));
      if (!summary) {
        allRelevantGamesFinal = false;
        continue;
      }

      const statusInfo = summary.header?.competitions?.[0]?.status?.type;
      const isCompleted = statusInfo?.completed === true;
      const statusText = statusInfo?.description ?? null;

      if (!isCompleted) {
        allRelevantGamesFinal = false;
      }

      const aggregated = aggregateEspnBoxscore(summary);

      for (const [espnPlayerId, stat] of aggregated.entries()) {
        const player = playerByEspnId.get(espnPlayerId);
        if (!player) continue;

        const row = statByPlayerId.get(player.id) ?? blankRow();

        row.passing_yards = stat.passing_yards;
        row.passing_tds = stat.passing_tds;
        row.passing_ints = stat.passing_ints;
        row.rushing_yards = stat.rushing_yards;
        row.rushing_tds = stat.rushing_tds;
        row.receiving_yards = stat.receiving_yards;
        row.receiving_tds = stat.receiving_tds;
        row.receptions = stat.receptions;
        row.fumbles_lost = stat.fumbles_lost;
        row.fantasy_points = Math.round(calculateNflFantasyPoints(stat) * 10) / 10;
        row.game_status_text = statusText;
        // Matches NBA's convention: 3 = final, 2 = in progress
        row.game_status = isCompleted ? 3 : 2;
        row.games_completed = isCompleted ? 1 : 0;
        row.games_in_progress = isCompleted ? 0 : 1;
        row.games_remaining = 0;

        statByPlayerId.set(player.id, row);
      }
    }

    const playerStatRows = Array.from(statByPlayerId.entries()).map(
      ([playerId, stat]) => ({
        slate_id: slateId,
        player_id: playerId,
        ...stat,
        updated_at: new Date().toISOString(),
      })
    );

    const { error: statsUpsertError } = await supabaseAdmin
      .from("player_nfl_slate_stats")
      .upsert(playerStatRows, {
        onConflict: "slate_id,player_id",
      });

    if (statsUpsertError) {
      return NextResponse.json(
        { error: `Failed to save NFL player stats: ${statsUpsertError.message}` },
        { status: 500 }
      );
    }

    let playerFinishedNotifications = {
      attempted: 0,
      sent: 0,
      skipped: 0,
      failed: 0,
    };

    try {
      playerFinishedNotifications = await notifyNewlyFinishedPlayers({
        slate: {
          id: safeSlate.id,
          date: safeSlate.date,
          start_date: safeSlate.start_date,
          end_date: safeSlate.end_date,
          sport: "nfl",
        },
        players: players.map((player) => ({
          id: player.id,
          name: player.name,
        })),
        lineups,
        previousStatuses,
        currentStats: playerStatRows.map((row) => ({
          player_id: row.player_id,
          fantasy_points: row.fantasy_points,
          game_status: row.game_status,
        })),
      });
    } catch (notificationError) {
      console.error(
        "NFL stats saved, but finished-player notifications failed",
        notificationError
      );
    }

    const statsByPlayerId = new Map(
      playerStatRows.map((row) => [row.player_id, row])
    );

    const teamRows = lineups.map((lineup) => {
      const playerRows = lineup.lineup_players ?? [];

      const fantasyPoints = playerRows.reduce((sum, playerRow) => {
        const stat = statsByPlayerId.get(playerRow.player_id);
        return sum + Number(stat?.fantasy_points ?? 0);
      }, 0);

      const gamesCompleted = playerRows.reduce((sum, playerRow) => {
        const stat = statsByPlayerId.get(playerRow.player_id);
        return sum + Number(stat?.games_completed ?? 0);
      }, 0);

      const gamesInProgress = playerRows.reduce((sum, playerRow) => {
        const stat = statsByPlayerId.get(playerRow.player_id);
        return sum + Number(stat?.games_in_progress ?? 0);
      }, 0);

      return {
        slate_id: slateId,
        team_id: lineup.team_id,
        fantasy_points: Math.round(fantasyPoints * 10) / 10,
        finish_position: null as number | null,
        games_completed: gamesCompleted,
        games_in_progress: gamesInProgress,
        games_remaining: 0,
      };
    });

    const sortedTeamRows = [...teamRows].sort(
      (a, b) => Number(b.fantasy_points) - Number(a.fantasy_points)
    );

    sortedTeamRows.forEach((row, index) => {
      row.finish_position = index + 1;
    });

    const { error: teamUpsertError } = await supabaseAdmin
      .from("team_slate_results")
      .upsert(sortedTeamRows, {
        onConflict: "slate_id,team_id",
      });

    if (teamUpsertError) {
      return NextResponse.json(
        { error: `Failed to save NFL team results: ${teamUpsertError.message}` },
        { status: 500 }
      );
    }

    let slateAutoLocked = false;

    let slateCompleteNotifications = {
      attempted: 0,
      sent: 0,
      skipped: 0,
      failed: 0,
    };

    const slateEndDate = new Date(`${safeSlate.end_date}T23:59:59`);
    const slateHasEndedByDate = Date.now() > slateEndDate.getTime();

    if (allRelevantGamesFinal && slateHasEndedByDate) {
      const { error: lockError } = await supabaseAdmin
        .from("slates")
        .update({ is_locked: true })
        .eq("id", slateId);

      if (lockError) {
        return NextResponse.json(
          { error: `Stats saved, but failed to auto-lock slate: ${lockError.message}` },
          { status: 500 }
        );
      }

      slateAutoLocked = true;

      try {
        slateCompleteNotifications = await notifyCompletedSlate({
          slate: {
            id: safeSlate.id,
            date: safeSlate.date,
            start_date: safeSlate.start_date,
            end_date: safeSlate.end_date,
          },
          teamResults: sortedTeamRows.map((row) => ({
            team_id: row.team_id,
            fantasy_points: Number(row.fantasy_points ?? 0),
            finish_position: row.finish_position,
          })),
        });
      } catch (notificationError) {
        console.error(
          "NFL slate locked, but slate-complete notifications failed",
          notificationError
        );
      }
    }

    return NextResponse.json({
      success: true,
      slateId,
      relevantGamesFound: relevantEvents.length,
      allRelevantGamesFinal,
      playerStatsUpdated: playerStatRows.length,
      teamResultsUpdated: sortedTeamRows.length,
      slateAutoLocked,
      playerFinishedNotifications,
      slateCompleteNotifications,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Unexpected server error while refreshing NFL stats." },
      { status: 500 }
    );
  }
}
