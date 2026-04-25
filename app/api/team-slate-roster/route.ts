import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type PlayerRow = {
  id: number;
  name: string;
  position_group: "G" | "F/C" | null;
};

type StatRow = {
  player_id: number;
  points: number | null;
  rebounds: number | null;
  assists: number | null;
  steals: number | null;
  blocks: number | null;
  turnovers: number | null;
  fantasy_points: number | null;
};

function getSlotOrder(positionGroup: string | null, index: number) {
  if (positionGroup === "G") return index;
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
        roster: [],
        total: 0,
      });
    }

    const [{ data: players, error: playersError }, { data: stats, error: statsError }] =
      await Promise.all([
        supabaseAdmin
          .from("players")
          .select("id, name, position_group")
          .in("id", playerIds),
        supabaseAdmin
          .from("player_slate_stats")
          .select(
            "player_id, points, rebounds, assists, steals, blocks, turnovers, fantasy_points"
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

    const playerMap = new Map<number, PlayerRow>();
    (players ?? []).forEach((player) => playerMap.set(Number(player.id), player as PlayerRow));

    const statMap = new Map<number, StatRow>();
    (stats ?? []).forEach((stat) => statMap.set(Number(stat.player_id), stat as StatRow));

    const roster = playerIds
      .map((playerId, index) => {
        const player = playerMap.get(playerId);
        const stat = statMap.get(playerId);

        return {
          playerId,
          name: player?.name ?? `Player ${playerId}`,
          positionGroup: player?.position_group ?? null,
          points: stat?.points ?? 0,
          rebounds: stat?.rebounds ?? 0,
          assists: stat?.assists ?? 0,
          steals: stat?.steals ?? 0,
          blocks: stat?.blocks ?? 0,
          turnovers: stat?.turnovers ?? 0,
          fantasyPoints: stat?.fantasy_points ?? 0,
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
