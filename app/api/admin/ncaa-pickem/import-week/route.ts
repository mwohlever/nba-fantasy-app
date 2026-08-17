import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  requireAdmin,
} from "@/lib/auth";

import {
  supabaseAdmin,
} from "@/lib/supabaseAdmin";

import {
  fetchNcaaPickEmWeek,
  type NcaaEspnGame,
} from "@/lib/providers/ncaa";

function positiveInteger(
  value: unknown,
): number | null {
  const number =
    Number(value);

  return Number.isInteger(number) &&
    number > 0
    ? number
    : null;
}

function stringArray(
  value: unknown,
): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(
      (entry) =>
        String(
          entry ?? "",
        ).trim(),
    )
    .filter(Boolean);
}

function isRankedVsRanked(
  game: NcaaEspnGame,
) {
  return (
    game.awayTeam.rank !== null &&
    game.homeTeam.rank !== null
  );
}

function hasRankedTeam(
  game: NcaaEspnGame,
) {
  return (
    game.awayTeam.rank !== null ||
    game.homeTeam.rank !== null
  );
}

function gameRow(
  weekId: number,
  game: NcaaEspnGame,
  included: boolean,
) {
  return {
    week_id:
      weekId,

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

    included,

    updated_at:
      new Date().toISOString(),
  };
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
      positiveInteger(
        body?.season,
      );

    const week =
      positiveInteger(
        body?.week,
      );

    const hasExplicitSelection =
      Array.isArray(
        body?.includedEventIds,
      );

    const explicitSelection =
      new Set(
        stringArray(
          body?.includedEventIds,
        ),
      );

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

    const {
      data: existingWeek,
      error: existingWeekError,
    } =
      await supabaseAdmin
        .from(
          "ncaa_pickem_weeks",
        )
        .select(
          "id, season, week_number, label, lock_at, status, analysis, show_analysis",
        )
        .eq(
          "season",
          season,
        )
        .eq(
          "week_number",
          week,
        )
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

    let preservedAnalysis:
      string | null =
      null;

    let preservedShowAnalysis =
      false;

    if (existingWeek) {
      weekId =
        Number(
          existingWeek.id,
        );

      preservedStatus =
        existingWeek.status ===
          "locked" ||
        existingWeek.status ===
          "final"
          ? existingWeek.status
          : "open";

      preservedAnalysis =
        existingWeek.analysis ??
        null;

      preservedShowAnalysis =
        existingWeek.show_analysis ===
        true;
    } else {
      const {
        data: createdWeek,
        error: createWeekError,
      } =
        await supabaseAdmin
          .from(
            "ncaa_pickem_weeks",
          )
          .insert({
            season,
            week_number:
              week,
            label:
              espnWeek.label,
            status:
              "open",
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
              createWeekError
                ?.message ??
              "Failed to create NCAA Pick 'Em week.",
          },
          { status: 500 },
        );
      }

      weekId =
        Number(
          createdWeek.id,
        );
    }

    /*
     * Preserve commissioner-added games during a normal
     * ESPN refresh. This is the important difference from
     * the previous importer, which cleared every included
     * game before rebuilding the card.
     */
    const {
      data: existingGames,
      error: existingGamesError,
    } =
      await supabaseAdmin
        .from(
          "ncaa_pickem_games",
        )
        .select(
          "espn_event_id, included",
        )
        .eq(
          "week_id",
          weekId,
        );

    if (existingGamesError) {
      return NextResponse.json(
        {
          error:
            existingGamesError.message,
        },
        { status: 500 },
      );
    }

    const previouslyIncluded =
      new Set(
        (
          existingGames ??
          []
        )
          .filter(
            (game) =>
              game.included ===
              true,
          )
          .map(
            (game) =>
              String(
                game.espn_event_id,
              ),
          ),
      );

    const scheduleIdSet =
      new Set(
        espnWeek.scheduleGames.map(
          (game) =>
            game.espnEventId,
        ),
      );

    const includedIds =
      new Set<string>();

    if (hasExplicitSelection) {
      for (
        const id
        of explicitSelection
      ) {
        if (
          scheduleIdSet.has(
            id,
          )
        ) {
          includedIds.add(
            id,
          );
        }
      }
    } else {
      /*
       * Ranked-vs-ranked is automatic.
       */
      for (
        const game
        of espnWeek.eligibleGames
      ) {
        includedIds.add(
          game.espnEventId,
        );
      }

      /*
       * Preserve anything the commissioner previously
       * added manually, as long as ESPN still has it in
       * this week's schedule.
       */
      for (
        const id
        of previouslyIncluded
      ) {
        if (
          scheduleIdSet.has(
            id,
          )
        ) {
          includedIds.add(
            id,
          );
        }
      }
    }

    /*
     * Upsert every ESPN schedule game. That gives the
     * commissioner a persistent local copy of the whole
     * weekly schedule while `included` controls which
     * games appear on the actual Pick 'Em card.
     */
    const rows =
      espnWeek.scheduleGames.map(
        (game) =>
          gameRow(
            weekId,
            game,
            includedIds.has(
              game.espnEventId,
            ),
          ),
      );

    if (rows.length > 0) {
      const {
        error: gamesError,
      } =
        await supabaseAdmin
          .from(
            "ncaa_pickem_games",
          )
          .upsert(
            rows,
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

    const selectedGames =
      espnWeek.scheduleGames
        .filter(
          (game) =>
            includedIds.has(
              game.espnEventId,
            ),
        )
        .sort(
          (a, b) =>
            new Date(
              a.kickoffAt,
            ).getTime() -
            new Date(
              b.kickoffAt,
            ).getTime(),
        );

    /*
     * Weekly lock follows the earliest INCLUDED game,
     * not simply the first ESPN event of the week.
     */
    const lockAt =
      selectedGames.length >
      0
        ? selectedGames[0]
            .kickoffAt
        : null;

    const {
      error: weekUpdateError,
    } =
      await supabaseAdmin
        .from(
          "ncaa_pickem_weeks",
        )
        .update({
          label:
            espnWeek.label,

          lock_at:
            lockAt,

          status:
            preservedStatus,

          updated_at:
            new Date()
              .toISOString(),
        })
        .eq(
          "id",
          weekId,
        );

    if (weekUpdateError) {
      return NextResponse.json(
        {
          error:
            weekUpdateError.message,
        },
        { status: 500 },
      );
    }

    const candidateGames =
      espnWeek.scheduleGames
        .filter(
          hasRankedTeam,
        )
        .map(
          (game) => ({
            espnEventId:
              game.espnEventId,

            kickoffAt:
              game.kickoffAt,

            included:
              includedIds.has(
                game.espnEventId,
              ),

            automatic:
              isRankedVsRanked(
                game,
              ),

            away: {
              id:
                game.awayTeam.id,

              name:
                game.awayTeam
                  .displayName,

              abbreviation:
                game.awayTeam
                  .abbreviation,

              logo:
                game.awayTeam.logo,

              rank:
                game.awayTeam.rank,

              record:
                game.awayTeam.record,
            },

            home: {
              id:
                game.homeTeam.id,

              name:
                game.homeTeam
                  .displayName,

              abbreviation:
                game.homeTeam
                  .abbreviation,

              logo:
                game.homeTeam.logo,

              rank:
                game.homeTeam.rank,

              record:
                game.homeTeam.record,
            },

            status:
              game.status,

            statusDetail:
              game.statusDetail,
          }),
        );

    return NextResponse.json({
      success: true,

      season,
      week,
      weekId,

      label:
        espnWeek.label,

      lockAt,

      analysis:
        preservedAnalysis,

      showAnalysis:
        preservedShowAnalysis,

      importedGames:
        selectedGames.length,

      normalEligibleGames:
        espnWeek
          .eligibleGames
          .length,

      optionalGames:
        candidateGames.filter(
          (game) =>
            !game.automatic,
        ).length,

      diagnostics:
        espnWeek.diagnostics,

      games:
        candidateGames,
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
