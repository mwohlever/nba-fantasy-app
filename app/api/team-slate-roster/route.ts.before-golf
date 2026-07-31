import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getStatColumns } from "@/lib/statColumns";

function getSlotOrder(positionGroup: string | null, index: number) {
  if (positionGroup === "G" || positionGroup === "QB") return index;
  return 100 + index;
}

export async function GET(request: NextRequest) {
  try {
    const slateId = Number(request.nextUrl.searchParams.get("slateId"));
    const teamId = Number(request.nextUrl.searchParams.get("teamId"));

    if (!slateId || !teamId) {
      return NextResponse.json(
        { error: "slateId and teamId are required." },
        { status: 400 }
      );
    }

    const { data: slate } = await supabaseAdmin
      .from("slates")
      .select("sport")
      .eq("id", slateId)
      .maybeSingle();

    const sport = slate?.sport === "nfl" ? "nfl" : "nba";
    const statColumns = getStatColumns(sport);

    const { data: team } = await supabaseAdmin
      .from("teams")
      .select("id, name")
      .eq("id", teamId)
      .maybeSingle();

    const { data: lineup, error: lineupError } = await supabaseAdmin
      .from("lineups")
      .select("id, slate_id, team_id")
      .eq("slate_id", slateId)
      .eq("team_id", teamId)
      .maybeSingle();

    if (lineupError) {
      return NextResponse.json({ error: lineupError.message }, { status: 500 });
    }

    if (!lineup) {
      return NextResponse.json({
        success: true,
        team: team ?? null,
        slateId,
        sport,
        statColumns,
        roster: [],
        total: 0,
      });
    }

    const { data: lineupPlayers, error: lineupPlayersError } = await supabaseAdmin
      .from("lineup_players")
      .select("player_id")
      .eq("lineup_id", lineup.id);

    if (lineupPlayersError) {
      return NextResponse.json(
        { error: lineupPlayersError.message },
        { status: 500 }
      );
    }

    const playerIds = (lineupPlayers ?? []).map((row) => Number(row.player_id));

    if (playerIds.length === 0) {
      return NextResponse.json({
        success: true,
        team: team ?? null,
        slateId,
        sport,
        statColumns,
        roster: [],
        total: 0,
      });
    }

    if (sport === "nfl") {
      const [{ data: players, error: playersError }, { data: stats, error: statsError }] =
        await Promise.all([
          supabaseAdmin
            .from("players_nfl")
            .select("id, name, nfl_player_id, position")
            .in("id", playerIds),
          supabaseAdmin
            .from("player_nfl_slate_stats")
            .select(
              "player_id, passing_yards, passing_tds, passing_ints, rushing_yards, rushing_tds, receiving_yards, receiving_tds, receptions, fumbles_lost, fantasy_points, game_status, game_status_text"
            )
            .eq("slate_id", slateId)
            .in("player_id", playerIds),
        ]);

      if (playersError) {
        return NextResponse.json({ error: playersError.message }, { status: 500 });
      }

      if (statsError) {
        return NextResponse.json({ error: statsError.message }, { status: 500 });
      }

      const playerMap = new Map<number, any>();
      (players ?? []).forEach((player) => playerMap.set(Number(player.id), player));

      const statMap = new Map<number, any>();
      (stats ?? []).forEach((stat) => statMap.set(Number(stat.player_id), stat));

      const roster = playerIds
        .map((playerId, index) => {
          const player = playerMap.get(playerId);
          const stat = statMap.get(playerId) ?? {};

          const statValues: Record<string, number> = {};
          statColumns.forEach((column) => {
            statValues[column.key] = Number(stat[column.key] ?? 0);
          });

          return {
            playerId,
            name: player?.name ?? `Player ${playerId}`,
            nbaPlayerId: null,
            positionGroup: player?.position ?? null,
            ...statValues,
            fantasyPoints: stat?.fantasy_points ?? 0,
            gameStatus: stat?.game_status ?? null,
            gameStatusText: stat?.game_status_text ?? null,
            period: null,
            gameClock: null,
            sortOrder: getSlotOrder(player?.position ?? null, index),
          };
        })
        .sort((a, b) => a.sortOrder - b.sortOrder);

      const total = roster.reduce(
        (sum, row) => sum + Number(row.fantasyPoints ?? 0),
        0
      );

      return NextResponse.json({
        success: true,
        team: team ?? null,
        slateId,
        sport,
        statColumns,
        roster,
        total,
      });
    }

    const [{ data: players, error: playersError }, { data: stats, error: statsError }] =
      await Promise.all([
        supabaseAdmin
          .from("players")
          .select("id, name, nba_player_id, position_group")
          .in("id", playerIds),
        supabaseAdmin
          .from("player_slate_stats")
          .select(
            "player_id, points, rebounds, assists, steals, blocks, turnovers, fantasy_points, game_status, game_status_text, period, game_clock"
          )
          .eq("slate_id", slateId)
          .in("player_id", playerIds),
      ]);

    if (playersError) {
      return NextResponse.json({ error: playersError.message }, { status: 500 });
    }

    if (statsError) {
      return NextResponse.json({ error: statsError.message }, { status: 500 });
    }

    const playerMap = new Map<number, any>();
    (players ?? []).forEach((player) => playerMap.set(Number(player.id), player));

    const statMap = new Map<number, any>();
    (stats ?? []).forEach((stat) => statMap.set(Number(stat.player_id), stat));

    const roster = playerIds
      .map((playerId, index) => {
        const player = playerMap.get(playerId);
        const stat = statMap.get(playerId) ?? {};

        const statValues: Record<string, number> = {};
        statColumns.forEach((column) => {
          statValues[column.key] = Number(stat[column.key] ?? 0);
        });

        return {
          playerId,
          name: player?.name ?? `Player ${playerId}`,
          nbaPlayerId: player?.nba_player_id ?? null,
          positionGroup: player?.position_group ?? null,
          ...statValues,
          fantasyPoints: stat?.fantasy_points ?? 0,
          gameStatus: stat?.game_status ?? null,
          gameStatusText: stat?.game_status_text ?? null,
          period: stat?.period ?? null,
          gameClock: stat?.game_clock ?? null,
          sortOrder: getSlotOrder(player?.position_group ?? null, index),
        };
      })
      .sort((a, b) => a.sortOrder - b.sortOrder);

    const total = roster.reduce(
      (sum, row) => sum + Number(row.fantasyPoints ?? 0),
      0
    );

    return NextResponse.json({
      success: true,
      team: team ?? null,
      slateId,
      sport,
      statColumns,
      roster,
      total,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Unexpected server error while loading roster." },
      { status: 500 }
    );
  }
}
