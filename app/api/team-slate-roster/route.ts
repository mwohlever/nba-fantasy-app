import {
  NextRequest,
  NextResponse,
} from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getStatColumns } from "@/lib/statColumns";
import {
  assignPlayersToRosterSlots,
  getRosterSlotsFromRulesSnapshot,
} from "@/lib/rules/leagueRules";
import { getCurrentUser } from "@/lib/auth";
import {
  getActiveSlateAccessForUser,
  teamBelongsToGroup,
} from "@/lib/groups/context";

function getSlotOrder(
  positionGroup: string | null,
  index: number,
) {
  if (
    positionGroup === "G" ||
    positionGroup === "QB"
  ) {
    return index;
  }

  return 100 + index;
}

function isGolfTerminalStatus(
  status: string | null | undefined,
) {
  return [
    "finished",
    "cut",
    "withdrawn",
    "disqualified",
    "did_not_start",
  ].includes(
    String(status ?? "").toLowerCase(),
  );
}

function golfStatusLabel(input: {
  status: string | null;
  currentRound: number | null;
  holesCompleted: number | null;
  roundsCompleted: number | null;
}) {
  const status = String(
    input.status ?? "",
  ).toLowerCase();

  if (status === "cut") return "CUT";
  if (status === "withdrawn") return "WD";
  if (status === "disqualified") return "DQ";
  if (status === "did_not_start") {
    return "DNS";
  }

  const round = Number(
    input.currentRound ??
      Math.max(
        Number(input.roundsCompleted ?? 0),
        1,
      ),
  );

  const currentRoundHoles =
    Number(input.holesCompleted ?? 0) % 18;

  if (
    status === "finished" ||
    isGolfTerminalStatus(status)
  ) {
    return "Finished";
  }

  if (currentRoundHoles === 0) {
    return `R${round} · Finished`;
  }

  return `R${round} · Thru ${currentRoundHoles}`;
}

export async function GET(
  request: NextRequest,
) {
  try {
    const slateId = Number(
      request.nextUrl.searchParams.get(
        "slateId",
      ),
    );

    const teamId = Number(
      request.nextUrl.searchParams.get(
        "teamId",
      ),
    );

    if (!slateId || !teamId) {
      return NextResponse.json(
        {
          error:
            "slateId and teamId are required.",
        },
        { status: 400 },
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

    const teamIsInGroup =
      await teamBelongsToGroup(
        teamId,
        slateAccess.context.group.id,
      );

    if (!teamIsInGroup) {
      return NextResponse.json(
        {
          error:
            "Team not found in the active Group.",
        },
        {
          status:
            404,
        },
      );
    }

    const {
      data: slate,
      error: slateError,
    } = await supabaseAdmin
      .from("slates")
      .select(
        "sport, league_id",
      )
      .eq(
        "id",
        slateId,
      )
      .eq(
        "league_id",
        slateAccess.league.id,
      )
      .maybeSingle();

    if (slateError) {
      return NextResponse.json(
        { error: slateError.message },
        { status: 500 },
      );
    }

    const sport =
      slate?.sport === "nfl"
        ? "nfl"
        : slate?.sport === "golf"
          ? "golf"
          : "nba";

    const statColumns =
      getStatColumns(sport);

    const { data: team } =
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
        .maybeSingle();

    const {
      data: lineup,
      error: lineupError,
    } = await supabaseAdmin
      .from("lineups")
      .select("id, slate_id, team_id")
      .eq("slate_id", slateId)
      .eq("team_id", teamId)
      .maybeSingle();

    if (lineupError) {
      return NextResponse.json(
        { error: lineupError.message },
        { status: 500 },
      );
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

    const {
      data: lineupPlayers,
      error: lineupPlayersError,
    } = await supabaseAdmin
      .from("lineup_players")
      .select("player_id")
      .eq("lineup_id", lineup.id);

    if (lineupPlayersError) {
      return NextResponse.json(
        {
          error:
            lineupPlayersError.message,
        },
        { status: 500 },
      );
    }

    const playerIds = (
      lineupPlayers ?? []
    ).map((row) => Number(row.player_id));

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

    if (sport === "golf") {
      const [
        {
          data: players,
          error: playersError,
        },
        {
          data: eventPlayers,
          error: eventPlayersError,
        },
      ] = await Promise.all([
        supabaseAdmin
          .from("golf_players")
          .select(
            "id, display_name, espn_player_id, headshot_url, country",
          )
          .in("id", playerIds),

        supabaseAdmin
          .from("golf_event_players")
          .select(
            "id, player_id, leaderboard_order, official_score_to_par, official_score_display, fantasy_score, penalty_strokes, status, current_round, last_hole, holes_completed, rounds_completed, tee_time, tee_time_raw",
          )
          .eq("slate_id", slateId)
          .in("player_id", playerIds),
      ]);

      if (playersError) {
        return NextResponse.json(
          { error: playersError.message },
          { status: 500 },
        );
      }

      if (eventPlayersError) {
        return NextResponse.json(
          {
            error:
              eventPlayersError.message,
          },
          { status: 500 },
        );
      }

      const eventPlayerIds = (
        eventPlayers ?? []
      ).map((row) => Number(row.id));

      let rounds: Array<{
        event_player_id: number;
        round_number: number;
        score_to_par: number | null;
        score_display: string | null;
        strokes: number | null;
        holes_completed: number;
        status: string | null;
      }> = [];

      if (eventPlayerIds.length > 0) {
        const {
          data: roundData,
          error: roundError,
        } = await supabaseAdmin
          .from("golf_rounds")
          .select(
            "event_player_id, round_number, score_to_par, score_display, strokes, holes_completed, status",
          )
          .in(
            "event_player_id",
            eventPlayerIds,
          )
          .order("round_number", {
            ascending: true,
          });

        if (roundError) {
          return NextResponse.json(
            { error: roundError.message },
            { status: 500 },
          );
        }

        rounds =
          (roundData ?? []) as typeof rounds;
      }

      const playerMap = new Map(
        (players ?? []).map((player) => [
          Number(player.id),
          player,
        ]),
      );

      const eventPlayerMap = new Map(
        (eventPlayers ?? []).map(
          (eventPlayer) => [
            Number(eventPlayer.player_id),
            eventPlayer,
          ],
        ),
      );

      const roundsByEventPlayerId =
        new Map<
          number,
          typeof rounds
        >();

      rounds.forEach((round) => {
        const eventPlayerId = Number(
          round.event_player_id,
        );

        const existing =
          roundsByEventPlayerId.get(
            eventPlayerId,
          ) ?? [];

        existing.push(round);

        roundsByEventPlayerId.set(
          eventPlayerId,
          existing,
        );
      });

      const roster = playerIds.map(
        (playerId, index) => {
          const player =
            playerMap.get(playerId);

          const eventPlayer =
            eventPlayerMap.get(playerId);

          const playerRounds =
            eventPlayer
              ? roundsByEventPlayerId.get(
                  Number(eventPlayer.id),
                ) ?? []
              : [];

          const roundScores = [1, 2, 3, 4].map(
            (roundNumber) => {
              const round =
                playerRounds.find(
                  (item) =>
                    Number(
                      item.round_number,
                    ) === roundNumber,
                );

              return {
                roundNumber,
                scoreToPar:
                  round?.score_to_par ??
                  null,
                scoreDisplay:
                  round?.score_display ??
                  null,
                strokes:
                  round?.strokes ?? null,
                holesCompleted:
                  Number(
                    round?.holes_completed ??
                      0,
                  ),
                status:
                  round?.status ?? null,
              };
            },
          );

          return {
            playerId,
            name:
              player?.display_name ??
              `Golfer ${playerId}`,
            nbaPlayerId: null,
            nflPlayerId: null,
            espnGolfPlayerId:
              player?.espn_player_id ??
              null,
            headshotUrl:
              player?.headshot_url ??
              null,
            country:
              player?.country ?? null,
            positionGroup: "GOLFER",
            fantasyPoints:
              eventPlayer?.fantasy_score ??
              eventPlayer
                ?.official_score_to_par ??
              0,
            officialScore:
              eventPlayer
                ?.official_score_to_par ??
              null,
            penaltyStrokes:
              Number(
                eventPlayer
                  ?.penalty_strokes ?? 0,
              ),
            leaderboardOrder:
              eventPlayer
                ?.leaderboard_order ??
              null,
            status:
              eventPlayer?.status ??
              "scheduled",
            teeTime:
              eventPlayer?.tee_time ??
              null,
            teeTimeRaw:
              eventPlayer?.tee_time_raw ??
              null,
            statusLabel:
              golfStatusLabel({
                status:
                  eventPlayer?.status ??
                  null,
                currentRound:
                  eventPlayer
                    ?.current_round ??
                  null,
                holesCompleted:
                  eventPlayer
                    ?.holes_completed ??
                  null,
                roundsCompleted:
                  eventPlayer
                    ?.rounds_completed ??
                  null,
              }),
            currentRound:
              eventPlayer
                ?.current_round ??
              null,
            lastHole:
              eventPlayer?.last_hole ??
              null,
            holesCompleted:
              eventPlayer
                ?.holes_completed ??
              0,
            roundScores,
            sortOrder: index,
          };
        },
      );

      const total = roster.reduce(
        (sum, row) =>
          sum +
          Number(row.fantasyPoints ?? 0),
        0,
      );

      return NextResponse.json({
        success: true,
        team: team ?? null,
        slateId,
        sport,
        statColumns: [],
        roster,
        total,
      });
    }

    if (sport === "nfl") {
      const [
        {
          data: players,
          error: playersError,
        },
        {
          data: stats,
          error: statsError,
        },
      ] = await Promise.all([
        supabaseAdmin
          .from("players_nfl")
          .select(
            "id, name, nfl_player_id, position",
          )
          .in("id", playerIds),

        supabaseAdmin
          .from(
            "player_nfl_slate_stats",
          )
          .select(
            "player_id, passing_yards, passing_tds, passing_ints, rushing_yards, rushing_tds, receiving_yards, receiving_tds, receptions, fumbles_lost, fantasy_points, game_status, game_status_text",
          )
          .eq("slate_id", slateId)
          .in("player_id", playerIds),
      ]);

      if (playersError) {
        return NextResponse.json(
          { error: playersError.message },
          { status: 500 },
        );
      }

      if (statsError) {
        return NextResponse.json(
          { error: statsError.message },
          { status: 500 },
        );
      }

      const playerMap =
        new Map<number, any>();

      (players ?? []).forEach(
        (player) =>
          playerMap.set(
            Number(player.id),
            player,
          ),
      );

      const statMap =
        new Map<number, any>();

      (stats ?? []).forEach((stat) =>
        statMap.set(
          Number(stat.player_id),
          stat,
        ),
      );

      const roster = playerIds
        .map((playerId, index) => {
          const player =
            playerMap.get(playerId);

          const stat =
            statMap.get(playerId) ?? {};

          const statValues: Record<
            string,
            number
          > = {};

          statColumns.forEach((column) => {
            statValues[column.key] = Number(
              stat[column.key] ?? 0,
            );
          });

          return {
            playerId,
            name:
              player?.name ??
              `Player ${playerId}`,
            nbaPlayerId: null,
            nflPlayerId:
              player?.nfl_player_id ??
              null,
            positionGroup:
              player?.position ?? null,
            ...statValues,
            fantasyPoints:
              stat?.fantasy_points ?? 0,
            gameStatus:
              stat?.game_status ?? null,
            gameStatusText:
              stat?.game_status_text ??
              null,
            period: null,
            gameClock: null,
            sortOrder: getSlotOrder(
              player?.position ?? null,
              index,
            ),
          };
        })
        .sort(
          (a, b) =>
            a.sortOrder - b.sortOrder,
        );

      const total = roster.reduce(
        (sum, row) =>
          sum +
          Number(row.fantasyPoints ?? 0),
        0,
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

    const [
      {
        data: players,
        error: playersError,
      },
      {
        data: stats,
        error: statsError,
      },
    ] = await Promise.all([
      supabaseAdmin
        .from("players")
        .select(
          "id, name, nba_player_id, position_group",
        )
        .in("id", playerIds),

      supabaseAdmin
        .from("player_slate_stats")
        .select(
          "player_id, points, rebounds, assists, steals, blocks, turnovers, fantasy_points, game_status, game_status_text, period, game_clock",
        )
        .eq("slate_id", slateId)
        .in("player_id", playerIds),
    ]);

    if (playersError) {
      return NextResponse.json(
        { error: playersError.message },
        { status: 500 },
      );
    }

    if (statsError) {
      return NextResponse.json(
        { error: statsError.message },
        { status: 500 },
      );
    }

    const playerMap =
      new Map<number, any>();

    (players ?? []).forEach((player) =>
      playerMap.set(
        Number(player.id),
        player,
      ),
    );

    const statMap =
      new Map<number, any>();

    (stats ?? []).forEach((stat) =>
      statMap.set(
        Number(stat.player_id),
        stat,
      ),
    );

    const rosterSlots =
      getRosterSlotsFromRulesSnapshot(
        slateAccess.slate.rulesSnapshot,
        sport,
      );


    const rosterAssignment =
      assignPlayersToRosterSlots({
        sport,

        playerPositions:
          playerIds.map(
            (playerId) =>
              String(
                playerMap.get(
                  playerId,
                )?.position_group ??
                playerMap.get(
                  playerId,
                )?.position ??
                "",
              ),
          ),

        rosterSlots,
      });


    const rosterSlotByPlayerIndex =
      new Map<
        number,
        {
          position:
            string;

          order:
            number;
        }
      >();


    rosterAssignment.slots.forEach(
      (
        slot,
        slotOrder,
      ) => {
        if (
          slot.playerIndex >=
          0
        ) {
          rosterSlotByPlayerIndex.set(
            slot.playerIndex,
            {
              position:
                slot.position,

              order:
                slotOrder,
            },
          );
        }
      },
    );


    const roster = playerIds
      .map((playerId, index) => {
        const player =
          playerMap.get(playerId);

        const stat =
          statMap.get(playerId) ?? {};

        const statValues: Record<
          string,
          number
        > = {};

        statColumns.forEach((column) => {
          statValues[column.key] = Number(
            stat[column.key] ?? 0,
          );
        });

        return {
          playerId,
          name:
            player?.name ??
            `Player ${playerId}`,
          nbaPlayerId:
            player?.nba_player_id ??
            null,
          nflPlayerId: null,
          positionGroup:
            player?.position_group ??
            player?.position ??
            null,

          rosterSlot:
            rosterSlotByPlayerIndex.get(
              index,
            )?.position ??
            player?.position_group ??
            player?.position ??
            null,

          ...statValues,
          fantasyPoints:
            stat?.fantasy_points ?? 0,
          gameStatus:
            stat?.game_status ?? null,
          gameStatusText:
            stat?.game_status_text ??
            null,
          period: stat?.period ?? null,
          gameClock:
            stat?.game_clock ?? null,
          sortOrder:
            rosterSlotByPlayerIndex.get(
              index,
            )?.order ??
            getSlotOrder(
              player?.position_group ??
              player?.position ??
                null,
              index,
            ),
        };
      })
      .sort(
        (a, b) =>
          a.sortOrder - b.sortOrder,
      );

    const total = roster.reduce(
      (sum, row) =>
        sum +
        Number(row.fantasyPoints ?? 0),
      0,
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
      {
        error:
          "Unexpected server error while loading roster.",
      },
      { status: 500 },
    );
  }
}
