import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getCurrentUser } from "@/lib/auth";
import { notifyNextDrafter } from "@/lib/draftNotifications";
import { getPlayerProjectionsForSeason } from "@/lib/playerProjections";

type SaveLineupBody = {
  slateId?: number;
  teamId?: number;
  playerIds?: number[];
  notifyNextDrafter?: boolean;
};

type LineupRow = {
  id: number;
  team_id: number;
  slate_id: number;
};

type LineupPlayerRow = {
  lineup_id: number;
  player_id: number;
  projected_fantasy_points: number | null;
};

function getSlateSeason(date: string | null | undefined) {
  const year = date?.slice(0, 4);
  return year && /^\d{4}$/.test(year) ? year : "2026";
}

export async function GET(request: NextRequest) {
  try {
    const slateIdParam = request.nextUrl.searchParams.get("slateId");

    if (!slateIdParam) {
      return NextResponse.json(
        { error: "slateId is required." },
        { status: 400 },
      );
    }

    const slateId = Number(slateIdParam);

    if (!Number.isFinite(slateId)) {
      return NextResponse.json(
        { error: "slateId must be a valid number." },
        { status: 400 },
      );
    }

    const { data: lineups, error: lineupsError } = await supabaseAdmin
      .from("lineups")
      .select("id, team_id, slate_id")
      .eq("slate_id", slateId);

    if (lineupsError) {
      return NextResponse.json(
        {
          error: `Failed to load lineups: ${lineupsError.message}`,
        },
        { status: 500 },
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

    const { data: lineupPlayers, error: lineupPlayersError } =
      await supabaseAdmin
        .from("lineup_players")
        .select("lineup_id, player_id, projected_fantasy_points")
        .in("lineup_id", lineupIds);

    if (lineupPlayersError) {
      return NextResponse.json(
        {
          error: `Failed to load lineup players: ${lineupPlayersError.message}`,
        },
        { status: 500 },
      );
    }

    const safeLineupPlayers = (lineupPlayers ?? []) as LineupPlayerRow[];

    const grouped = safeLineups.map((lineup) => {
      const lineupPlayerRows = safeLineupPlayers.filter(
        (lp) => lp.lineup_id === lineup.id
      );

      const hasCompleteProjectionSnapshot =
        lineupPlayerRows.length > 0 &&
        lineupPlayerRows.every(
          (lp) =>
            lp.projected_fantasy_points !== null &&
            Number.isFinite(Number(lp.projected_fantasy_points))
        );

      return {
        team_id: lineup.team_id,
        player_ids: lineupPlayerRows.map((lp) => lp.player_id),
        pregame_projected_points: hasCompleteProjectionSnapshot
          ? Number(
              lineupPlayerRows
                .reduce(
                  (sum, lp) =>
                    sum + Number(lp.projected_fantasy_points ?? 0),
                  0
                )
                .toFixed(1)
            )
          : null,
      };
    });

    return NextResponse.json({
      success: true,
      lineups: grouped,
    });
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      {
        error: "Unexpected server error while loading lineups.",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const currentUser = await getCurrentUser();

    if (!currentUser) {
      return NextResponse.json({ error: "Login required." }, { status: 401 });
    }

    const body = (await request.json()) as SaveLineupBody;

    const slateId = body.slateId;
    const teamId = body.teamId;
    const playerIds = body.playerIds ?? [];

    if (!slateId || !teamId || !Array.isArray(playerIds)) {
      return NextResponse.json(
        {
          error: "slateId, teamId, and playerIds are required.",
        },
        { status: 400 },
      );
    }

    if (playerIds.length > 5) {
      return NextResponse.json(
        {
          error: "A lineup can include at most 5 players.",
        },
        { status: 400 },
      );
    }

    const uniquePlayerIds = [...new Set(playerIds)];

    if (uniquePlayerIds.length !== playerIds.length) {
      return NextResponse.json(
        {
          error: "Duplicate players are not allowed in a lineup.",
        },
        { status: 400 },
      );
    }

    const { data: slate, error: slateError } = await supabaseAdmin
      .from("slates")
      .select("id, date, start_date, end_date, is_locked")
      .eq("id", slateId)
      .single();

    if (slateError || !slate) {
      return NextResponse.json(
        { error: "Selected slate not found." },
        { status: 404 },
      );
    }

    if (slate.is_locked) {
      return NextResponse.json(
        {
          error: "This slate is locked. Lineups can no longer be edited.",
        },
        { status: 400 },
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
        { status: 404 },
      );
    }

    const { data: players, error: playersError } =
      uniquePlayerIds.length > 0
        ? await supabaseAdmin
            .from("players")
            .select("id, name, position_group, is_active, nba_player_id")
            .in("id", uniquePlayerIds)
        : { data: [], error: null };

    if (playersError || !players || players.length !== uniquePlayerIds.length) {
      return NextResponse.json(
        {
          error: "One or more selected players were not found.",
        },
        { status: 400 },
      );
    }

    const inactivePlayers = players.filter((player) => !player.is_active);

    if (inactivePlayers.length > 0) {
      return NextResponse.json(
        {
          error: "Inactive players cannot be used in a lineup.",
        },
        { status: 400 },
      );
    }

    const guardCount = players.filter(
      (player) => player.position_group === "G",
    ).length;

    const fcCount = players.filter(
      (player) => player.position_group === "F/C",
    ).length;

    if (guardCount > 2 || fcCount > 3) {
      return NextResponse.json(
        {
          error: "A lineup can have at most 2 Guards and 3 F/C players.",
        },
        { status: 400 },
      );
    }

    const { data: existingLineup, error: existingLineupError } =
      await supabaseAdmin
        .from("lineups")
        .select("id, lineup_players(player_id)")
        .eq("team_id", teamId)
        .eq("slate_id", slateId)
        .maybeSingle();

    if (existingLineupError) {
      return NextResponse.json(
        {
          error: `Failed to check existing lineup: ${existingLineupError.message}`,
        },
        { status: 500 },
      );
    }

    const previousPlayerIds = existingLineup
      ? (
          (
            existingLineup as {
              lineup_players?: { player_id: number }[] | null;
            }
          ).lineup_players ?? []
        ).map((row) => Number(row.player_id))
      : [];

    const previousPlayerIdSet = new Set(previousPlayerIds);

    const nextPlayerIdSet = new Set(uniquePlayerIds);

    const addedPlayerIds = uniquePlayerIds.filter(
      (playerId) => !previousPlayerIdSet.has(playerId),
    );

    const removedPlayerIds = previousPlayerIds.filter(
      (playerId) => !nextPlayerIdSet.has(playerId),
    );

    const isSingleNewDraftPick =
      addedPlayerIds.length === 1 &&
      removedPlayerIds.length === 0 &&
      uniquePlayerIds.length === previousPlayerIds.length + 1;

    let lineupId: number;

    if (existingLineup) {
      lineupId = Number(existingLineup.id);
    } else {
      const { data: createdLineup, error: lineupError } = await supabaseAdmin
        .from("lineups")
        .insert({
          team_id: teamId,
          slate_id: slateId,
        })
        .select("id")
        .single();

      if (lineupError || !createdLineup) {
        return NextResponse.json(
          {
            error: `Failed to create lineup: ${
              lineupError?.message ?? "Unknown error"
            }`,
          },
          { status: 500 },
        );
      }

      lineupId = Number(createdLineup.id);
    }

    if (removedPlayerIds.length > 0) {
      const { error: removePlayersError } = await supabaseAdmin
        .from("lineup_players")
        .delete()
        .eq("lineup_id", lineupId)
        .in("player_id", removedPlayerIds);

      if (removePlayersError) {
        return NextResponse.json(
          {
            error: `Failed to remove lineup players: ${removePlayersError.message}`,
          },
          { status: 500 },
        );
      }
    }

    if (addedPlayerIds.length > 0) {
      const season = getSlateSeason(slate.start_date ?? slate.date);

      const projectionResult = await getPlayerProjectionsForSeason(season);

      const projectedAt = new Date().toISOString();

      const addedRows = addedPlayerIds.map((playerId) => {
        const projection = projectionResult.projections[playerId];

        const projectedFantasyPoints =
          projection?.projection === null ||
          projection?.projection === undefined
            ? null
            : Number(projection.projection);

        return {
          lineup_id: lineupId,
          player_id: playerId,
          projected_fantasy_points: projectedFantasyPoints,
          projection_confidence: projection?.confidence ?? null,
          projection_source: projection?.source ?? "none",
          projected_at: projectedFantasyPoints !== null ? projectedAt : null,
        };
      });

      const { error: insertPlayersError } = await supabaseAdmin
        .from("lineup_players")
        .insert(addedRows);

      if (insertPlayersError) {
        return NextResponse.json(
          {
            error: `Failed to save newly added lineup players: ${insertPlayersError.message}`,
          },
          { status: 500 },
        );
      }
    }

    const notificationRequested =
      currentUser.role === "admin" ? body.notifyNextDrafter === true : true;

    let draftNotification = null;

    if (isSingleNewDraftPick && notificationRequested) {
      try {
        draftNotification = await notifyNextDrafter(slateId);
      } catch (notificationError) {
        console.error(
          "Lineup saved, but the next-drafter notification failed",
          notificationError,
        );

        draftNotification = {
          sent: 0,
          failed: 1,
          skipped: true,
          reason: "Notification failed after the lineup was saved.",
        };
      }
    }

    return NextResponse.json({
      success: true,
      message: "Lineup saved successfully.",
      lineupId,
      slateId: slate.id,
      slateDate: slate.date,
      teamName: team.name,
      addedPlayerIds,
      removedPlayerIds,
      draftNotification,
    });
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      {
        error: "Unexpected server error while saving lineup.",
      },
      { status: 500 },
    );
  }
}
