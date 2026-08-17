import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  supabaseAdmin,
} from "@/lib/supabaseAdmin";

import {
  fetchNcaaPickEmWeek,
} from "@/lib/providers/ncaa";

type RefreshBody = {
  weekId?: number;
  season?: number;
  week?: number;
};

type WeekRow = {
  id: number;
  season: number;
  week_number: number;
  lock_at: string | null;
  status: "open" | "locked" | "final";
};

type GameRow = {
  id: number;
  espn_event_id: string;
  included: boolean;
};

function positiveInteger(
  value: unknown,
): number | null {
  const number = Number(value);

  return (
    Number.isInteger(number) &&
    number > 0
  )
    ? number
    : null;
}

export async function POST(
  request: NextRequest,
) {
  try {
    let body: RefreshBody = {};

    try {
      body =
        await request.json();
    } catch {
      body = {};
    }

    const requestedWeekId =
      positiveInteger(
        body.weekId,
      );

    const requestedSeason =
      positiveInteger(
        body.season,
      );

    const requestedWeek =
      positiveInteger(
        body.week,
      );

    let weekQuery =
      supabaseAdmin
        .from(
          "ncaa_pickem_weeks",
        )
        .select(
          "id, season, week_number, lock_at, status",
        );

    if (requestedWeekId) {
      weekQuery =
        weekQuery.eq(
          "id",
          requestedWeekId,
        );
    } else if (
      requestedSeason &&
      requestedWeek
    ) {
      weekQuery =
        weekQuery
          .eq(
            "season",
            requestedSeason,
          )
          .eq(
            "week_number",
            requestedWeek,
          );
    } else {
      return NextResponse.json(
        {
          error:
            "weekId or season/week is required.",
        },
        {
          status: 400,
        },
      );
    }

    const {
      data: weekData,
      error: weekError,
    } =
      await weekQuery
        .limit(1)
        .maybeSingle();

    if (weekError) {
      return NextResponse.json(
        {
          error:
            weekError.message,
        },
        {
          status: 500,
        },
      );
    }

    if (!weekData) {
      return NextResponse.json(
        {
          error:
            "NCAA Pick 'Em week not found.",
        },
        {
          status: 404,
        },
      );
    }

    const week =
      weekData as WeekRow;

    const espnWeek =
      await fetchNcaaPickEmWeek({
        season:
          Number(week.season),

        week:
          Number(
            week.week_number,
          ),
      });

    const {
      data: existingGamesData,
      error: existingGamesError,
    } =
      await supabaseAdmin
        .from(
          "ncaa_pickem_games",
        )
        .select(
          "id, espn_event_id, included",
        )
        .eq(
          "week_id",
          week.id,
        );

    if (existingGamesError) {
      return NextResponse.json(
        {
          error:
            existingGamesError.message,
        },
        {
          status: 500,
        },
      );
    }

    const existingGames =
      (existingGamesData ??
        []) as GameRow[];

    const localGameByEspnId =
      new Map<
        string,
        GameRow
      >();

    for (
      const game
      of existingGames
    ) {
      localGameByEspnId.set(
        String(
          game.espn_event_id,
        ),
        game,
      );
    }

    const now =
      new Date()
        .toISOString();

    const gameUpdates =
      espnWeek.scheduleGames
        .map((espnGame) => {
          const localGame =
            localGameByEspnId.get(
              espnGame.espnEventId,
            );

          if (!localGame) {
            return null;
          }

          return {
            id:
              localGame.id,

            week_id:
              week.id,

            espn_event_id:
              espnGame.espnEventId,

            kickoff_at:
              espnGame.kickoffAt,

            away_team_id:
              espnGame.awayTeam.id,

            away_team_name:
              espnGame
                .awayTeam
                .displayName,

            away_team_abbreviation:
              espnGame
                .awayTeam
                .abbreviation,

            away_team_logo_url:
              espnGame
                .awayTeam
                .logo,

            away_rank:
              espnGame
                .awayTeam
                .rank,

            away_record:
              espnGame
                .awayTeam
                .record,

            away_score:
              espnGame
                .awayTeam
                .score,

            home_team_id:
              espnGame.homeTeam.id,

            home_team_name:
              espnGame
                .homeTeam
                .displayName,

            home_team_abbreviation:
              espnGame
                .homeTeam
                .abbreviation,

            home_team_logo_url:
              espnGame
                .homeTeam
                .logo,

            home_rank:
              espnGame
                .homeTeam
                .rank,

            home_record:
              espnGame
                .homeTeam
                .record,

            home_score:
              espnGame
                .homeTeam
                .score,

            status:
              espnGame.status,

            status_detail:
              espnGame.statusDetail,

            winner_team_id:
              espnGame.winnerTeamId,

            included:
              localGame.included,

            updated_at:
              now,
          };
        })
        .filter(
          (
            row,
          ): row is NonNullable<
            typeof row
          > =>
            row !== null,
        );

    if (
      gameUpdates.length > 0
    ) {
      const {
        error: updateError,
      } =
        await supabaseAdmin
          .from(
            "ncaa_pickem_games",
          )
          .upsert(
            gameUpdates,
            {
              onConflict:
                "espn_event_id",
            },
          );

      if (updateError) {
        return NextResponse.json(
          {
            error:
              updateError.message,
          },
          {
            status: 500,
          },
        );
      }
    }

    const completedGames =
      espnWeek.scheduleGames
        .filter(
          (game) =>
            game.completed &&
            Boolean(
              game.winnerTeamId,
            ),
        );

    let gradedPicks = 0;

    for (
      const completedGame
      of completedGames
    ) {
      const localGame =
        localGameByEspnId.get(
          completedGame
            .espnEventId,
        );

      if (
        !localGame ||
        !localGame.included ||
        !completedGame
          .winnerTeamId
      ) {
        continue;
      }

      const {
        data: picks,
        error: picksError,
      } =
        await supabaseAdmin
          .from(
            "ncaa_pickem_picks",
          )
          .select(
            "id, picked_team_id, is_correct",
          )
          .eq(
            "week_id",
            week.id,
          )
          .eq(
            "game_id",
            localGame.id,
          );

      if (picksError) {
        return NextResponse.json(
          {
            error:
              picksError.message,
          },
          {
            status: 500,
          },
        );
      }

      for (
        const pick
        of picks ?? []
      ) {
        const isCorrect =
          String(
            pick.picked_team_id,
          ) ===
          String(
            completedGame
              .winnerTeamId,
          );

        if (
          pick.is_correct ===
          isCorrect
        ) {
          continue;
        }

        const {
          error:
            gradeError,
        } =
          await supabaseAdmin
            .from(
              "ncaa_pickem_picks",
            )
            .update({
              is_correct:
                isCorrect,

              updated_at:
                now,
            })
            .eq(
              "id",
              pick.id,
            );

        if (gradeError) {
          return NextResponse.json(
            {
              error:
                gradeError.message,
            },
            {
              status: 500,
            },
          );
        }

        gradedPicks += 1;
      }
    }

    const includedLocalIds =
      new Set(
        existingGames
          .filter(
            (game) =>
              game.included,
          )
          .map(
            (game) =>
              String(
                game.espn_event_id,
              ),
          ),
      );

    const includedEspnGames =
      espnWeek.scheduleGames
        .filter(
          (game) =>
            includedLocalIds.has(
              game.espnEventId,
            ),
        );

    const completedIncludedGames =
      includedEspnGames
        .filter(
          (game) =>
            game.completed,
        )
        .length;

    const allIncludedGamesComplete =
      includedEspnGames.length >
        0 &&
      completedIncludedGames ===
        includedEspnGames.length;

    /*
     * NCAA Pick 'Em lifecycle:
     *
     * open   -> locked once the configured lock time passes
     * locked -> final once every included game is complete
     *
     * A final week stays final. We intentionally do not reopen
     * or otherwise override an administrator-finalized week.
     */
    let weekStatus:
      WeekRow["status"] =
        week.status;

    const lockTime =
      week.lock_at
        ? new Date(
            week.lock_at,
          ).getTime()
        : null;

    const lockHasPassed =
      lockTime !== null &&
      Number.isFinite(
        lockTime,
      ) &&
      Date.now() >=
        lockTime;

    if (
      weekStatus === "open" &&
      lockHasPassed
    ) {
      weekStatus = "locked";
    }

    if (
      weekStatus !== "final" &&
      allIncludedGamesComplete
    ) {
      weekStatus = "final";
    }

    const statusChanged =
      weekStatus !==
      week.status;

    if (statusChanged) {
      const {
        error:
          weekStatusError,
      } =
        await supabaseAdmin
          .from(
            "ncaa_pickem_weeks",
          )
          .update({
            status:
              weekStatus,

            updated_at:
              now,
          })
          .eq(
            "id",
            week.id,
          );

      if (weekStatusError) {
        return NextResponse.json(
          {
            error:
              `Games refreshed, but the NCAA Pick 'Em week status could not be updated: ${weekStatusError.message}`,
          },
          {
            status: 500,
          },
        );
      }
    }

    return NextResponse.json({
      success: true,

      weekId:
        week.id,

      season:
        week.season,

      week:
        week.week_number,

      weekStatus,

      gamesFound:
        espnWeek
          .scheduleGames
          .length,

      localGames:
        existingGames.length,

      gamesUpdated:
        gameUpdates.length,

      includedGames:
        includedEspnGames.length,

      completedIncludedGames,

      allIncludedGamesComplete,

      gradedPicks,

      statusChanged,

      previousWeekStatus:
        week.status,

      checkedAt:
        now,
    });
  } catch (error) {
    console.error(
      "Failed to refresh NCAA Pick 'Em",
      error,
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to refresh NCAA Pick 'Em.",
      },
      {
        status: 500,
      },
    );
  }
}
