import { NextResponse } from "next/server";
import { formatSlateDateLabel } from "@/lib/formatSlateLabel";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function round(value: number, digits = 1) {
  return Number(value.toFixed(digits));
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const slateId = Number(searchParams.get("slateId"));
    const teamId = Number(searchParams.get("teamId"));

    if (!Number.isInteger(slateId) || slateId <= 0) {
      return NextResponse.json(
        { error: "Missing or invalid slateId." },
        { status: 400 }
      );
    }

    if (!Number.isInteger(teamId) || teamId <= 0) {
      return NextResponse.json(
        { error: "Missing or invalid teamId." },
        { status: 400 }
      );
    }

    const [
      slateResult,
      teamsResult,
      resultsResult,
      lineupsResult,
      playersResult,
      playerStatsResult,
      slateTeamsResult,
    ] = await Promise.all([
      supabaseAdmin
        .from("slates")
        .select("id, date, start_date, end_date")
        .eq("id", slateId)
        .single(),

      supabaseAdmin
        .from("teams")
        .select("id, name"),

      supabaseAdmin
        .from("team_slate_results")
        .select(
          "slate_id, team_id, fantasy_points, finish_position, games_completed, games_in_progress, games_remaining"
        )
        .eq("slate_id", slateId),

      supabaseAdmin
        .from("lineups")
        .select("id, slate_id, team_id")
        .eq("slate_id", slateId),

      supabaseAdmin
        .from("players")
        .select("id, name, position_group"),

      supabaseAdmin
        .from("player_slate_stats")
        .select("slate_id, player_id, fantasy_points")
        .eq("slate_id", slateId),

      supabaseAdmin
        .from("slate_teams")
        .select(
          "slate_id, team_id, draft_order, is_participating"
        )
        .eq("slate_id", slateId),
    ]);

    const firstError =
      slateResult.error ??
      teamsResult.error ??
      resultsResult.error ??
      lineupsResult.error ??
      playersResult.error ??
      playerStatsResult.error ??
      slateTeamsResult.error;

    if (firstError) {
      console.error(
        "Failed to load slate profile detail",
        firstError
      );

      return NextResponse.json(
        { error: "Unable to load this slate." },
        { status: 500 }
      );
    }

    const slate = slateResult.data;
    const teams = teamsResult.data ?? [];
    const results = resultsResult.data ?? [];
    const lineups = lineupsResult.data ?? [];
    const players = playersResult.data ?? [];
    const playerStats = playerStatsResult.data ?? [];
    const slateTeams = slateTeamsResult.data ?? [];

    const lineupIds = lineups.map((lineup) =>
      Number(lineup.id)
    );

    let lineupPlayers: Array<{
      lineup_id: number;
      player_id: number;
    }> = [];

    if (lineupIds.length > 0) {
      const lineupPlayersResult = await supabaseAdmin
        .from("lineup_players")
        .select("lineup_id, player_id")
        .in("lineup_id", lineupIds);

      if (lineupPlayersResult.error) {
        console.error(
          "Failed to load slate lineup players",
          lineupPlayersResult.error
        );

        return NextResponse.json(
          { error: "Unable to load this slate's lineups." },
          { status: 500 }
        );
      }

      lineupPlayers =
        lineupPlayersResult.data?.map((row) => ({
          lineup_id: Number(row.lineup_id),
          player_id: Number(row.player_id),
        })) ?? [];
    }

    const teamMap = new Map(
      teams.map((team) => [
        Number(team.id),
        String(team.name),
      ])
    );

    const playerMap = new Map(
      players.map((player) => [
        Number(player.id),
        {
          name: String(player.name),
          positionGroup:
            player.position_group === null
              ? null
              : String(player.position_group),
        },
      ])
    );

    const statMap = new Map(
      playerStats.map((stat) => [
        Number(stat.player_id),
        stat.fantasy_points === null ||
        stat.fantasy_points === undefined
          ? null
          : Number(stat.fantasy_points),
      ])
    );

    const selectedLineup = lineups.find(
      (lineup) => Number(lineup.team_id) === teamId
    );

    const selectedPlayerIds = selectedLineup
      ? lineupPlayers
          .filter(
            (row) =>
              row.lineup_id === Number(selectedLineup.id)
          )
          .map((row) => row.player_id)
      : [];

    const roster = selectedPlayerIds
      .map((playerId) => {
        const player = playerMap.get(playerId);
        const fantasyPoints =
          statMap.get(playerId) ?? null;

        return {
          playerId,
          playerName:
            player?.name ?? "Unknown Player",
          positionGroup:
            player?.positionGroup ?? null,
          fantasyPoints:
            fantasyPoints === null
              ? null
              : round(fantasyPoints),
        };
      })
      .sort(
        (a, b) =>
          Number(b.fantasyPoints ?? -1) -
          Number(a.fantasyPoints ?? -1)
      );

    const standings = results
      .filter(
        (result) =>
          Number(result.fantasy_points ?? 0) > 0
      )
      .map((result) => ({
        teamId: Number(result.team_id),
        teamName:
          teamMap.get(Number(result.team_id)) ??
          `Team ${result.team_id}`,
        score: round(
          Number(result.fantasy_points ?? 0)
        ),
        finishPosition:
          result.finish_position === null ||
          result.finish_position === undefined
            ? null
            : Number(result.finish_position),
        gamesCompleted: Number(
          result.games_completed ?? 0
        ),
        gamesInProgress: Number(
          result.games_in_progress ?? 0
        ),
        gamesRemaining: Number(
          result.games_remaining ?? 0
        ),
      }))
      .sort((a, b) => {
        if (
          a.finishPosition !== null &&
          b.finishPosition !== null
        ) {
          return (
            a.finishPosition -
            b.finishPosition
          );
        }

        return b.score - a.score;
      });

    const selectedResult =
      standings.find(
        (row) => row.teamId === teamId
      ) ?? null;

    const selectedSlateTeam =
      slateTeams.find(
        (row) =>
          Number(row.team_id) === teamId
      ) ?? null;

    const topPlayer =
      roster.find(
        (player) =>
          player.fantasyPoints !== null
      ) ?? null;

    return NextResponse.json({
      success: true,
      slate: {
        id: slateId,
        label: formatSlateDateLabel(slate),
      },
      selectedTeam: {
        id: teamId,
        name:
          teamMap.get(teamId) ??
          `Team ${teamId}`,
        score: selectedResult?.score ?? 0,
        finishPosition:
          selectedResult?.finishPosition ?? null,
        draftPosition:
          selectedSlateTeam?.draft_order === null ||
          selectedSlateTeam?.draft_order === undefined
            ? null
            : Number(
                selectedSlateTeam.draft_order
              ),
        roster,
        topPlayer,
      },
      standings,
    });
  } catch (error) {
    console.error(
      "Slate profile detail error",
      error
    );

    return NextResponse.json(
      { error: "Unable to load this slate." },
      { status: 500 }
    );
  }
}
