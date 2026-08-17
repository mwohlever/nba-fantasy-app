import {
  NextRequest,
  NextResponse,
} from "next/server";

import { requireAdmin } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

import {
  fetchNcaaPickEmWeek,
} from "@/lib/providers/ncaa";

function positiveInteger(
  value: unknown,
): number | null {
  const number = Number(value);

  return Number.isInteger(number) &&
    number > 0
    ? number
    : null;
}

export async function POST(
  request: NextRequest,
) {
  try {
    const admin =
      await requireAdmin();

    if (!admin) {
      return NextResponse.json(
        {
          error:
            "Admin access required.",
        },
        { status: 403 },
      );
    }

    const body =
      await request.json();

    const season =
      positiveInteger(body?.season);

    const week =
      positiveInteger(body?.week);

    if (!season || !week) {
      return NextResponse.json(
        {
          error:
            "Valid season and week are required.",
        },
        { status: 400 },
      );
    }

    const espnWeek =
      await fetchNcaaPickEmWeek({
        season,
        week,
      });

    /*
     * Load/create our durable weekly card.
     */
    const {
      data: existingWeek,
      error: existingWeekError,
    } = await supabaseAdmin
      .from("ncaa_pickem_weeks")
      .select(
        "id, season, week_number, label, lock_at, status",
      )
      .eq("season", season)
      .eq("week_number", week)
      .maybeSingle();

    if (existingWeekError) {
      return NextResponse.json(
        {
          error:
            existingWeekError.message,
        },
        { status: 500 },
      );
    }

    let weekId: number;
    let preservedStatus:
      | "open"
      | "locked"
      | "final" =
      "open";

    if (existingWeek) {
      weekId =
        Number(existingWeek.id);

      preservedStatus =
        existingWeek.status ===
          "locked" ||
        existingWeek.status ===
          "final"
          ? existingWeek.status
          : "open";
    } else {
      const {
        data: createdWeek,
        error: createWeekError,
      } = await supabaseAdmin
        .from("ncaa_pickem_weeks")
        .insert({
          season,
          week_number: week,
          label: espnWeek.label,
          status: "open",
        })
        .select(
          "id, status",
        )
        .single();

      if (
        createWeekError ||
        !createdWeek
      ) {
        return NextResponse.json(
          {
            error:
              createWeekError?.message ??
              "Failed to create NCAA Pick 'Em week.",
          },
          { status: 500 },
        );
      }

      weekId =
        Number(createdWeek.id);
    }

    /*
     * On every refresh, first mark this week's old
     * game set inactive. Any currently eligible
     * Top-25-vs-Top-25 matchup is then re-enabled
     * below. This handles poll/ranking changes
     * without deleting history.
     */
    const {
      error: clearIncludedError,
    } = await supabaseAdmin
      .from("ncaa_pickem_games")
      .update({
        included: false,
        updated_at:
          new Date().toISOString(),
      })
      .eq("week_id", weekId);

    if (clearIncludedError) {
      return NextResponse.json(
        {
          error:
            clearIncludedError.message,
        },
        { status: 500 },
      );
    }

    const gameRows =
      espnWeek.games.map(
        (game) => ({
          week_id: weekId,

          espn_event_id:
            game.espnEventId,

          kickoff_at:
            game.kickoffAt,

          away_team_id:
            game.awayTeam.id,

          away_team_name:
            game.awayTeam.displayName,

          away_team_abbreviation:
            game.awayTeam.abbreviation,

          away_team_logo_url:
            game.awayTeam.logo,

          away_rank:
            game.awayTeam.rank,

          away_record:
            game.awayTeam.record,

          away_score:
            game.awayTeam.score,

          home_team_id:
            game.homeTeam.id,

          home_team_name:
            game.homeTeam.displayName,

          home_team_abbreviation:
            game.homeTeam.abbreviation,

          home_team_logo_url:
            game.homeTeam.logo,

          home_rank:
            game.homeTeam.rank,

          home_record:
            game.homeTeam.record,

          home_score:
            game.homeTeam.score,

          status:
            game.status,

          status_detail:
            game.statusDetail,

          winner_team_id:
            game.winnerTeamId,

          included: true,

          updated_at:
            new Date().toISOString(),
        }),
      );

    if (gameRows.length > 0) {
      const {
        error: gamesError,
      } = await supabaseAdmin
        .from("ncaa_pickem_games")
        .upsert(
          gameRows,
          {
            onConflict:
              "espn_event_id",
          },
        );

      if (gamesError) {
        return NextResponse.json(
          {
            error:
              gamesError.message,
          },
          { status: 500 },
        );
      }
    }

    /*
     * Entire weekly card locks at the first
     * eligible matchup kickoff.
     */
    const lockAt =
      espnWeek.games.length > 0
        ? espnWeek.games[0]
            .kickoffAt
        : null;

    const {
      error: weekUpdateError,
    } = await supabaseAdmin
      .from("ncaa_pickem_weeks")
      .update({
        label:
          espnWeek.label,

        lock_at:
          lockAt,

        status:
          preservedStatus,

        updated_at:
          new Date().toISOString(),
      })
      .eq("id", weekId);

    if (weekUpdateError) {
      return NextResponse.json(
        {
          error:
            weekUpdateError.message,
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,

      season,
      week,
      weekId,

      label:
        espnWeek.label,

      lockAt,

      importedGames:
        gameRows.length,

      diagnostics:
        espnWeek.diagnostics,

      games:
        espnWeek.games.map(
          (game) => ({
            espnEventId:
              game.espnEventId,

            kickoffAt:
              game.kickoffAt,

            away:
              {
                name:
                  game.awayTeam
                    .displayName,

                rank:
                  game.awayTeam
                    .rank,

                record:
                  game.awayTeam
                    .record,
              },

            home:
              {
                name:
                  game.homeTeam
                    .displayName,

                rank:
                  game.homeTeam
                    .rank,

                record:
                  game.homeTeam
                    .record,
              },

            status:
              game.status,

            statusDetail:
              game.statusDetail,
          }),
        ),
    });
  } catch (error) {
    console.error(
      "Failed to import NCAA Pick 'Em week",
      error,
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to import NCAA Pick 'Em week.",
      },
      { status: 500 },
    );
  }
}
