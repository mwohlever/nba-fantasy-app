import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type SaveLineupBody = {
  slateId?: number;
  teamId?: number;
  playerIds?: number[];
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

export async function GET(request: NextRequest) {
  try {
    const slateIdParam = request.nextUrl.searchParams.get("slateId");

    if (!slateIdParam) {
      return NextResponse.json(
        { error: "slateId is required." },
        { status: 400 }
      );
    }

    const slateId = Number(slateIdParam);

    if (!Number.isFinite(slateId)) {
      return NextResponse.json(
        { error: "slateId must be a valid number." },
        { status: 400 }
      );
    }

    const { data: lineups, error: lineupsError } = await supabaseAdmin
      .from("lineups")
      .select("id, team_id, slate_id")
      .eq("slate_id", slateId);

    if (lineupsError) {
      return NextResponse.json(
        { error: `Failed to load lineups: ${lineupsError.message}` },
        { status: 500 }
      );
    }

    const safeLineups = (lineups ?? []) as LineupRow[];

    if (safeLineups.length === 0) {
      return NextResponse.json({
        success: true,
        lineups: [],
      });
    }

    const lineupIds = safeLineups.map((lineup) => lineup.id);

    const { data: lineupPlayers, error: lineupPlayersError } = await supabaseAdmin
      .from("lineup_players")
      .select("lineup_id, player_id")
      .in("lineup_id", lineupIds);

    if (lineupPlayersError) {
      return NextResponse.json(
        { error: `Failed to load lineup players: ${lineupPlayersError.message}` },
        { status: 500 }
      );
    }

    const safeLineupPlayers = (lineupPlayers ?? []) as LineupPlayerRow[];

    const grouped = safeLineups.map((lineup) => ({
      team_id: lineup.team_id,
      player_ids: safeLineupPlayers
        .filter((lp) => lp.lineup_id === lineup.id)
        .map((lp) => lp.player_id),
    }));

    return NextResponse.json({
      success: true,
      lineups: grouped,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Unexpected server error while loading lineups." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as SaveLineupBody;
    const slateId = body.slateId;
    const teamId = body.teamId;
    const playerIds = body.playerIds ?? [];

    if (!slateId || !teamId || !Array.isArray(playerIds)) {
      return NextResponse.json(
        { error: "slateId, teamId, and playerIds are required." },
        { status: 400 }
      );
    }

if (playerIds.length > 5) {
  return NextResponse.json(
    { error: "A lineup can include at most 5 players." },
    { status: 400 }
  );
}
    const uniquePlayerIds = [...new Set(playerIds)];

    if (uniquePlayerIds.length !== playerIds.length) {
      return NextResponse.json(
        { error: "Duplicate players are not allowed in a lineup." },
        { status: 400 }
      );
    }

    const { data: slate, error: slateError } = await supabaseAdmin
      .from("slates")
      .select("id, date, is_locked")
      .eq("id", slateId)
      .single();

    if (slateError || !slate) {
      return NextResponse.json(
        { error: "Selected slate not found." },
        { status: 404 }
      );
    }

    if (slate.is_locked) {
      return NextResponse.json(
        { error: "This slate is locked. Lineups can no longer be edited." },
        { status: 400 }
      );
    }

    const { data: team, error: teamError } = await supabaseAdmin
      .from("teams")
      .select("id, name")
      .eq("id", teamId)
      .single();

    if (teamError || !team) {
      return NextResponse.json(
        { error: "Selected team not found." },
        { status: 404 }
      );
    }

    const { data: players, error: playersError } = await supabaseAdmin
      .from("players")
      .select("id, name, position_group, is_active")
      .in("id", uniquePlayerIds);

    if (playersError || !players || players.length !== uniquePlayerIds.length) {
      return NextResponse.json(
        { error: "One or more selected players were not found." },
        { status: 400 }
      );
    }

    const inactivePlayers = players.filter((player) => !player.is_active);

    if (inactivePlayers.length > 0) {
      return NextResponse.json(
        { error: "Inactive players cannot be used in a lineup." },
        { status: 400 }
      );
    }

    const guardCount = players.filter(
      (player) => player.position_group === "G"
    ).length;
    const fcCount = players.filter(
      (player) => player.position_group === "F/C"
    ).length;

    if (guardCount > 2 || fcCount > 3) {
      return NextResponse.json(
        { error: "A lineup can have at most 2 Guards and 3 F/C players." },
        { status: 400 }
      );
    }

    const { data: existingLineup, error: existingLineupError } = await supabaseAdmin
      .from("lineups")
      .select("id")
      .eq("team_id", teamId)
      .eq("slate_id", slateId)
      .maybeSingle();

    if (existingLineupError) {
      return NextResponse.json(
        { error: `Failed to check existing lineup: ${existingLineupError.message}` },
        { status: 500 }
      );
    }

    if (existingLineup) {
      const { error: deleteLineupPlayersError } = await supabaseAdmin
        .from("lineup_players")
        .delete()
        .eq("lineup_id", existingLineup.id);

      if (deleteLineupPlayersError) {
        return NextResponse.json(
          {
            error: `Failed to clear existing lineup players: ${deleteLineupPlayersError.message}`,
          },
          { status: 500 }
        );
      }

      const { error: deleteExistingError } = await supabaseAdmin
        .from("lineups")
        .delete()
        .eq("id", existingLineup.id);

      if (deleteExistingError) {
        return NextResponse.json(
          { error: `Failed to replace existing lineup: ${deleteExistingError.message}` },
          { status: 500 }
        );
      }
    }

    const { data: lineup, error: lineupError } = await supabaseAdmin
      .from("lineups")
      .insert({
        team_id: teamId,
        slate_id: slateId,
      })
      .select("id")
      .single();

    if (lineupError || !lineup) {
      return NextResponse.json(
        { error: `Failed to create lineup: ${lineupError?.message}` },
        { status: 500 }
      );
    }

    const lineupPlayersPayload = uniquePlayerIds.map((playerId) => ({
      lineup_id: lineup.id,
      player_id: playerId,
    }));

    const { error: lineupPlayersError } = await supabaseAdmin
      .from("lineup_players")
      .insert(lineupPlayersPayload);

    if (lineupPlayersError) {
      return NextResponse.json(
        { error: `Failed to save lineup players: ${lineupPlayersError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Lineup saved successfully.",
      lineupId: lineup.id,
      slateId: slate.id,
      slateDate: slate.date,
      teamName: team.name,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Unexpected server error while saving lineup." },
      { status: 500 }
    );
  }
}
