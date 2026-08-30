import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getCurrentUser } from "@/lib/auth";
import {
  getActiveSlateAccessForUser,
  teamBelongsToGroup,
} from "@/lib/groups/context";
import { notifyNextDrafter } from "@/lib/draftNotifications";
import { getPlayerProjectionsForSeason } from "@/lib/playerProjections";
import {
  assignPlayersToRosterSlots,
  canPlayerFillRosterSlot,
  getDefaultRosterSlotsForSport,
  getRosterSlotsFromRulesSnapshot,
} from "@/lib/rules/leagueRules";

type Sport = "nba" | "nfl" | "golf";

type SaveLineupBody = {
  slateId?: number;
  teamId?: number;
  playerIds?: number[];
  notifyNextDrafter?: boolean;
  rosterSlot?: {
    playerId: number;
    position: string;
    slotIndex: number;
  } | null;
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
  roster_slot_position: string | null;
  roster_slot_index: number | null;
};

type SlateRow = {
  id: number;
  date: string | null;
  start_date: string | null;
  end_date: string | null;
  is_locked: boolean;
  sport: string | null;
};

type RosterSlotRow = {
  position: string;
  slot_count: number;
};

type NormalizedPlayer = {
  id: number;
  name: string;
  position: string;
  isActive: boolean;
};

function normalizeSport(value: string | null | undefined): Sport {
  if (value === "nfl") return "nfl";
  if (value === "golf") return "golf";
  return "nba";
}

function getSlateSeason(date: string | null | undefined) {
  const year = date?.slice(0, 4);
  return year && /^\d{4}$/.test(year) ? year : "2026";
}

function getDefaultRosterSlots(
  sport: Sport,
): RosterSlotRow[] {
  return getDefaultRosterSlotsForSport(
    sport,
  );
}

async function loadPlayersForSport(
  sport: Sport,
  playerIds: number[],
): Promise<{
  players: NormalizedPlayer[];
  error: string | null;
}> {
  if (playerIds.length === 0) {
    return {
      players: [],
      error: null,
    };
  }

  if (sport === "nfl") {
    const { data, error } = await supabaseAdmin
      .from("players_nfl")
      .select("id, name, position, is_active")
      .in("id", playerIds);

    if (error) {
      return {
        players: [],
        error: error.message,
      };
    }

    return {
      players: (data ?? []).map((player: any) => ({
        id: Number(player.id),
        name: player.name,
        position: player.position,
        isActive: Boolean(player.is_active),
      })),
      error: null,
    };
  }

  if (sport === "golf") {
    const { data, error } = await supabaseAdmin
      .from("golf_players")
      .select("id, display_name, is_active")
      .in("id", playerIds);

    if (error) {
      return {
        players: [],
        error: error.message,
      };
    }

    return {
      players: (data ?? []).map((player: any) => ({
        id: Number(player.id),
        name: player.display_name,
        position: "GOLFER",
        isActive: Boolean(player.is_active),
      })),
      error: null,
    };
  }

  const { data, error } = await supabaseAdmin
    .from("players")
    .select("id, name, position_group, is_active")
    .in("id", playerIds);

  if (error) {
    return {
      players: [],
      error: error.message,
    };
  }

  return {
    players: (data ?? []).map((player: any) => ({
      id: Number(player.id),
      name: player.name,
      position: player.position_group,
      isActive: Boolean(player.is_active),
    })),
    error: null,
  };
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

    const slateId =
      Number(
        slateIdParam,
      );

    if (
      !Number.isInteger(
        slateId,
      ) ||
      slateId <= 0
    ) {
      return NextResponse.json(
        {
          error:
            "slateId must be a valid number.",
        },
        {
          status:
            400,
        },
      );
    }

    const currentUser =
      await getCurrentUser();

    if (!currentUser) {
      return NextResponse.json(
        {
          error:
            "Login required.",
        },
        {
          status:
            401,
        },
      );
    }

    const slateAccess =
      await getActiveSlateAccessForUser(
        currentUser,
        slateId,
      );

    if (!slateAccess) {
      return NextResponse.json(
        {
          error:
            "Slate not found in the active Group.",
        },
        {
          status:
            404,
        },
      );
    }

    const { data: lineups, error: lineupsError } =
      await supabaseAdmin
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
        .select(
          "lineup_id, player_id, projected_fantasy_points, roster_slot_position, roster_slot_index",
        )
        .in("lineup_id", lineupIds);

    if (lineupPlayersError) {
      return NextResponse.json(
        {
          error:
            `Failed to load lineup players: ` +
            lineupPlayersError.message,
        },
        { status: 500 },
      );
    }

    const safeLineupPlayers =
      (lineupPlayers ?? []) as LineupPlayerRow[];

    const grouped = safeLineups.map((lineup) => {
      const lineupPlayerRows = safeLineupPlayers.filter(
        (lineupPlayer) =>
          lineupPlayer.lineup_id === lineup.id,
      );

      const hasCompleteProjectionSnapshot =
        lineupPlayerRows.length > 0 &&
        lineupPlayerRows.every(
          (lineupPlayer) =>
            lineupPlayer.projected_fantasy_points !== null &&
            Number.isFinite(
              Number(
                lineupPlayer.projected_fantasy_points,
              ),
            ),
        );

      return {
        team_id: lineup.team_id,
        player_ids:
          lineupPlayerRows.map(
            (lineupPlayer) =>
              lineupPlayer.player_id,
          ),

        player_slots:
          lineupPlayerRows.map(
            (lineupPlayer) => ({
              player_id:
                lineupPlayer.player_id,

              roster_slot_position:
                lineupPlayer.roster_slot_position ??
                null,

              roster_slot_index:
                lineupPlayer.roster_slot_index ??
                null,
            }),
          ),

        pregame_projected_points:
          hasCompleteProjectionSnapshot
            ? Number(
                lineupPlayerRows
                  .reduce(
                    (sum, lineupPlayer) =>
                      sum +
                      Number(
                        lineupPlayer.projected_fantasy_points ??
                          0,
                      ),
                    0,
                  )
                  .toFixed(1),
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
        error:
          "Unexpected server error while loading lineups.",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const currentUser = await getCurrentUser();

    if (!currentUser) {
      return NextResponse.json(
        { error: "Login required." },
        { status: 401 },
      );
    }

    const body = (await request.json()) as SaveLineupBody;

    const slateId = Number(body.slateId);
    const teamId = Number(body.teamId);
    const playerIds = Array.isArray(body.playerIds)
      ? body.playerIds.map(Number)
      : [];


    const requestedRosterSlot =
      body.rosterSlot &&
      typeof body.rosterSlot ===
        "object"
        ? {
            playerId:
              Number(
                body.rosterSlot.playerId,
              ),

            position:
              String(
                body.rosterSlot.position ??
                  "",
              )
                .trim()
                .toUpperCase(),

            slotIndex:
              Number(
                body.rosterSlot.slotIndex,
              ),
          }
        : null;

    if (
      !Number.isInteger(slateId) ||
      slateId <= 0 ||
      !Number.isInteger(teamId) ||
      teamId <= 0
    ) {
      return NextResponse.json(
        {
          error:
            "slateId, teamId, and playerIds are required.",
        },
        { status: 400 },
      );
    }

    if (
      playerIds.some(
        (playerId) =>
          !Number.isInteger(playerId) || playerId <= 0,
      )
    ) {
      return NextResponse.json(
        {
          error:
            "Every player ID must be a valid positive integer.",
        },
        { status: 400 },
      );
    }

    const uniquePlayerIds =
      [
        ...new Set(
          playerIds,
        ),
      ];

    if (uniquePlayerIds.length !== playerIds.length) {
      return NextResponse.json(
        {
          error:
            "Duplicate players are not allowed in a lineup.",
        },
        { status: 400 },
      );
    }

    const slateAccess =
      await getActiveSlateAccessForUser(
        currentUser,
        slateId,
      );

    if (!slateAccess) {
      return NextResponse.json(
        {
          error:
            "Selected slate does not belong to the active Group.",
        },
        {
          status:
            404,
        },
      );
    }

    const teamIsInGroup =
      await teamBelongsToGroup(
        teamId,
        slateAccess.context.group.id,
      );

    if (!teamIsInGroup) {
      return NextResponse.json(
        {
          error:
            "Selected team does not belong to the active Group.",
        },
        {
          status:
            404,
        },
      );
    }

    const { data: slateData, error: slateError } =
      await supabaseAdmin
        .from("slates")
        .select(
          "id, date, start_date, end_date, is_locked, sport, league_id",
        )
        .eq("id", slateId)
        .single();

    if (slateError || !slateData) {
      return NextResponse.json(
        { error: "Selected slate not found." },
        { status: 404 },
      );
    }

    const slate =
      slateData as unknown as
        SlateRow & {
          league_id:
            string | null;
        };

    if (
      slate.league_id !==
      slateAccess.league.id
    ) {
      return NextResponse.json(
        {
          error:
            "Selected slate is outside the active League.",
        },
        {
          status:
            404,
        },
      );
    }

    const sport =
      normalizeSport(
        slate.sport,
      );

    if (slate.is_locked) {
      return NextResponse.json(
        {
          error:
            "This slate is locked. Lineups can no longer be edited.",
        },
        { status: 400 },
      );
    }

    const rosterSlots =
      getRosterSlotsFromRulesSnapshot(
        slateAccess.slate.rulesSnapshot,
        sport,
      );


    const totalRosterSlots = rosterSlots.reduce(
      (sum, slot) => sum + Number(slot.slot_count),
      0,
    );

    if (uniquePlayerIds.length > totalRosterSlots) {
      return NextResponse.json(
        {
          error:
            `A ${sport.toUpperCase()} lineup can include at most ` +
            `${totalRosterSlots} players.`,
        },
        { status: 400 },
      );
    }

    const { data: team, error: teamError } =
      await supabaseAdmin
        .from("teams")
        .select("id, name")
        .eq(
          "id",
          teamId,
        )
        .eq(
          "group_id",
          slateAccess.context.group.id,
        )
        .single();

    if (teamError || !team) {
      return NextResponse.json(
        { error: "Selected team not found." },
        { status: 404 },
      );
    }

    const {
      players,
      error: playersError,
    } = await loadPlayersForSport(
      sport,
      uniquePlayerIds,
    );

    if (
      playersError ||
      players.length !== uniquePlayerIds.length
    ) {
      return NextResponse.json(
        {
          error:
            playersError
              ? `Failed to validate selected players: ${playersError}`
              : "One or more selected players were not found.",
        },
        { status: 400 },
      );
    }

    const inactivePlayers = players.filter(
      (player) => !player.isActive,
    );

    if (inactivePlayers.length > 0) {
      return NextResponse.json(
        {
          error:
            "Inactive players cannot be used in a lineup.",
        },
        { status: 400 },
      );
    }

    if (sport === "golf" && uniquePlayerIds.length > 0) {
      const { data: eventPlayers, error: eventPlayersError } =
        await supabaseAdmin
          .from("golf_event_players")
          .select("player_id")
          .eq("slate_id", slateId)
          .in("player_id", uniquePlayerIds);

      if (eventPlayersError) {
        return NextResponse.json(
          {
            error:
              "Failed to validate the tournament field: " +
              eventPlayersError.message,
          },
          { status: 500 },
        );
      }

      const tournamentPlayerIds = new Set(
        (eventPlayers ?? []).map((row) =>
          Number(row.player_id),
        ),
      );

      const unavailablePlayers = players.filter(
        (player) =>
          !tournamentPlayerIds.has(player.id),
      );

      if (unavailablePlayers.length > 0) {
        return NextResponse.json(
          {
            error:
              `${unavailablePlayers[0].name} is not in ` +
              "this tournament field.",
          },
          { status: 400 },
        );
      }
    }

    const rosterAssignment =
      assignPlayersToRosterSlots({
        sport,

        playerPositions:
          players.map(
            (player) =>
              player.position,
          ),

        rosterSlots,
      });


    if (
      !rosterAssignment.fits
    ) {
      const invalidPlayerIndex =
        rosterAssignment
          .unmatchedPlayerIndexes[
            0
          ];


      const invalidPlayer =
        players[
          invalidPlayerIndex
        ];


      return NextResponse.json(
        {
          error:
            invalidPlayer
              ? `${invalidPlayer.name} does not fit an open ${sport.toUpperCase()} roster slot.`
              : `That lineup does not fit the configured ${sport.toUpperCase()} roster.`,
        },
        {
          status:
            400,
        },
      );
    }


    if (
      requestedRosterSlot
    ) {
      const requestedPlayer =
        players.find(
          (player) =>
            Number(
              player.id,
            ) ===
            requestedRosterSlot.playerId,
        );


      const requestedSlotConfig =
        rosterSlots.find(
          (slot) =>
            slot.position
              .trim()
              .toUpperCase() ===
            requestedRosterSlot.position,
        );


      if (
        !requestedPlayer ||
        !uniquePlayerIds.includes(
          requestedRosterSlot.playerId,
        ) ||
        !requestedSlotConfig ||
        !Number.isInteger(
          requestedRosterSlot.slotIndex,
        ) ||
        requestedRosterSlot.slotIndex <
          0 ||
        requestedRosterSlot.slotIndex >=
          Number(
            requestedSlotConfig.slot_count,
          ) ||
        !canPlayerFillRosterSlot(
          sport,
          requestedPlayer.position,
          requestedRosterSlot.position,
        )
      ) {
        return NextResponse.json(
          {
            error:
              "The requested roster slot is not valid for this player.",
          },
          {
            status:
              400,
          },
        );
      }
    }


    const { data: existingLineup, error: existingLineupError } =
      await supabaseAdmin
        .from("lineups")
        .select(
          "id, lineup_players(player_id, roster_slot_position, roster_slot_index)",
        )
        .eq("team_id", teamId)
        .eq("slate_id", slateId)
        .maybeSingle();

    if (existingLineupError) {
      return NextResponse.json(
        {
          error:
            `Failed to check existing lineup: ` +
            existingLineupError.message,
        },
        { status: 500 },
      );
    }

    const previousPlayerIds = existingLineup
      ? (
          (
            existingLineup as {
              lineup_players?:
                | {
                    player_id: number;
                    roster_slot_position: string | null;
                    roster_slot_index: number | null;
                  }[]
                | null;
            }
          ).lineup_players ?? []
        ).map((row) => Number(row.player_id))
      : [];

    const previousPlayerIdSet =
      new Set(previousPlayerIds);

    const nextPlayerIdSet =
      new Set(uniquePlayerIds);

    const addedPlayerIds = uniquePlayerIds.filter(
      (playerId) =>
        !previousPlayerIdSet.has(playerId),
    );

    const removedPlayerIds = previousPlayerIds.filter(
      (playerId) =>
        !nextPlayerIdSet.has(playerId),
    );

    const isSingleNewDraftPick =
      addedPlayerIds.length === 1 &&
      removedPlayerIds.length === 0 &&
      uniquePlayerIds.length ===
        previousPlayerIds.length + 1;

    let lineupId: number;

    if (existingLineup) {
      lineupId = Number(existingLineup.id);
    } else {
      const { data: createdLineup, error: lineupError } =
        await supabaseAdmin
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
            error:
              `Failed to create lineup: ` +
              (lineupError?.message ??
                "Unknown error"),
          },
          { status: 500 },
        );
      }

      lineupId = Number(createdLineup.id);
    }

    if (removedPlayerIds.length > 0) {
      const { error: removePlayersError } =
        await supabaseAdmin
          .from("lineup_players")
          .delete()
          .eq("lineup_id", lineupId)
          .in("player_id", removedPlayerIds);

      if (removePlayersError) {
        return NextResponse.json(
          {
            error:
              `Failed to remove lineup players: ` +
              removePlayersError.message,
          },
          { status: 500 },
        );
      }
    }

    if (addedPlayerIds.length > 0) {
      const season = getSlateSeason(
        slate.start_date ?? slate.date,
      );

      const projectionResult =
        sport === "nba"
          ? await getPlayerProjectionsForSeason(season)
          : null;

      const projectedAt = new Date().toISOString();

      const addedRows = addedPlayerIds.map((playerId) => {
        const projection =
          projectionResult?.projections[playerId];

        const projectedFantasyPoints =
          projection?.projection === null ||
          projection?.projection === undefined
            ? null
            : Number(projection.projection);

        return {
          lineup_id: lineupId,
          player_id:
            playerId,

          roster_slot_position:
            requestedRosterSlot &&
            requestedRosterSlot.playerId ===
              playerId
              ? requestedRosterSlot.position
              : null,

          roster_slot_index:
            requestedRosterSlot &&
            requestedRosterSlot.playerId ===
              playerId
              ? requestedRosterSlot.slotIndex
              : null,

          projected_fantasy_points:
            projectedFantasyPoints,
          projection_confidence:
            projection?.confidence ?? null,
          projection_source:
            projection?.source ??
            (sport === "nba" ? "none" : sport),
          projected_at:
            projectedFantasyPoints !== null
              ? projectedAt
              : null,
        };
      });

      const { error: insertPlayersError } =
        await supabaseAdmin
          .from("lineup_players")
          .insert(addedRows);

      if (insertPlayersError) {
        return NextResponse.json(
          {
            error:
              `Failed to save newly added lineup players: ` +
              insertPlayersError.message,
          },
          { status: 500 },
        );
      }
    }

    const notificationRequested =
      currentUser.role === "admin"
        ? body.notifyNextDrafter === true
        : true;

    let draftNotification = null;

    if (
      isSingleNewDraftPick &&
      notificationRequested
    ) {
      try {
        draftNotification =
          await notifyNextDrafter(slateId);
      } catch (notificationError) {
        console.error(
          "Lineup saved, but the next-drafter notification failed",
          notificationError,
        );

        draftNotification = {
          sent: 0,
          failed: 1,
          skipped: true,
          reason:
            "Notification failed after the lineup was saved.",
        };
      }
    }

    return NextResponse.json({
      success: true,
      message: "Lineup saved successfully.",
      lineupId,
      slateId: slate.id,
      slateDate: slate.date,
      sport,
      teamName: team.name,
      addedPlayerIds,
      removedPlayerIds,
      draftNotification,
    });
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      {
        error:
          "Unexpected server error while saving the lineup.",
      },
      { status: 500 },
    );
  }
}
