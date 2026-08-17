import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  getCurrentUser,
} from "@/lib/auth";

import {
  supabaseAdmin,
} from "@/lib/supabaseAdmin";

type PickRow = {
  week_id: number;
  game_id: number;
  team_id: number;
  is_correct: boolean | null;
};

type WeekRow = {
  id: number;
  season: number;
  week_number: number;
  status:
    | "open"
    | "locked"
    | "final";
};

function numericParam(
  value: string | null,
): number | null {
  if (!value) {
    return null;
  }

  const number =
    Number(value);

  return (
    Number.isInteger(number) &&
    number > 0
  )
    ? number
    : null;
}

export async function GET(
  request: NextRequest,
) {
  try {
    const user =
      await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        {
          error:
            "Login required.",
        },
        {
          status: 401,
        },
      );
    }

    const {
      searchParams,
    } =
      new URL(request.url);

    const requestedSeason =
      numericParam(
        searchParams.get(
          "season",
        ),
      );

    const [
      weeksResult,
      teamsResult,
      usersResult,
    ] =
      await Promise.all([
        supabaseAdmin
          .from(
            "ncaa_pickem_weeks",
          )
          .select(
            "id, season, week_number, status",
          )
          .order(
            "season",
            {
              ascending:
                false,
            },
          )
          .order(
            "week_number",
            {
              ascending:
                false,
            },
          ),

        supabaseAdmin
          .from("teams")
          .select(
            "id, name",
          )
          .order(
            "id",
            {
              ascending:
                true,
            },
          ),

        supabaseAdmin
          .from(
            "app_users",
          )
          .select(
            "team_id, display_name, avatar_url",
          )
          .eq(
            "is_active",
            true,
          ),
      ]);

    if (weeksResult.error) {
      throw new Error(
        weeksResult
          .error
          .message,
      );
    }

    if (teamsResult.error) {
      throw new Error(
        teamsResult
          .error
          .message,
      );
    }

    if (usersResult.error) {
      throw new Error(
        usersResult
          .error
          .message,
      );
    }

    const allWeeks =
      (weeksResult.data ??
        []) as WeekRow[];

    const seasons =
      Array.from(
        new Set(
          allWeeks.map(
            (week) =>
              Number(
                week.season,
              ),
          ),
        ),
      ).sort(
        (a, b) =>
          b - a,
      );

    const selectedSeason =
      requestedSeason ??
      seasons[0] ??
      null;

    const weeks =
      selectedSeason ===
      null
        ? []
        : allWeeks.filter(
            (week) =>
              Number(
                week.season,
              ) ===
              selectedSeason,
          );

    const weekIds =
      weeks.map(
        (week) =>
          Number(week.id),
      );

    let picks:
      PickRow[] = [];

    let includedGameIdsByWeek =
      new Map<
        number,
        Set<number>
      >();

    if (
      weekIds.length > 0
    ) {
      const [
        picksResult,
        gamesResult,
      ] =
        await Promise.all([
          supabaseAdmin
            .from(
              "ncaa_pickem_picks",
            )
            .select(
              "week_id, game_id, team_id, is_correct",
            )
            .in(
              "week_id",
              weekIds,
            )
            .not(
              "is_correct",
              "is",
              null,
            ),

          supabaseAdmin
            .from(
              "ncaa_pickem_games",
            )
            .select(
              "id, week_id",
            )
            .in(
              "week_id",
              weekIds,
            )
            .eq(
              "included",
              true,
            ),
        ]);

      if (picksResult.error) {
        throw new Error(
          picksResult.error.message,
        );
      }

      if (gamesResult.error) {
        throw new Error(
          gamesResult.error.message,
        );
      }

      picks =
        (picksResult.data ??
          []) as PickRow[];

      for (
        const game
        of gamesResult.data ?? []
      ) {
        const weekId =
          Number(
            game.week_id,
          );

        const gameId =
          Number(
            game.id,
          );

        const ids =
          includedGameIdsByWeek.get(
            weekId,
          ) ??
          new Set<number>();

        ids.add(
          gameId,
        );

        includedGameIdsByWeek.set(
          weekId,
          ids,
        );
      }
    }

    const userByTeamId =
      new Map<
        number,
        {
          displayName:
            string;
          avatarUrl:
            string | null;
        }
      >();

    for (
      const appUser
      of usersResult.data ??
      []
    ) {
      userByTeamId.set(
        Number(
          appUser.team_id,
        ),
        {
          displayName:
            String(
              appUser
                .display_name ??
              "",
            ),

          avatarUrl:
            appUser
              .avatar_url ??
            null,
        },
      );
    }

    const rows =
      (teamsResult.data ??
        []).map(
        (team) => {
          const teamId =
            Number(team.id);

          const appUser =
            userByTeamId.get(
              teamId,
            );

          const teamPicks =
            picks.filter(
              (pick) =>
                Number(
                  pick.team_id,
                ) ===
                teamId,
            );

          const correct =
            teamPicks.filter(
              (pick) =>
                pick.is_correct ===
                true,
            ).length;

          const incorrect =
            teamPicks.filter(
              (pick) =>
                pick.is_correct ===
                false,
            ).length;

          const graded =
            correct +
            incorrect;

          const pickPct =
            graded > 0
              ? correct /
                graded
              : null;

          const picksByWeek =
            new Map<
              number,
              PickRow[]
            >();

          for (
            const pick
            of teamPicks
          ) {
            const weekId =
              Number(
                pick.week_id,
              );

            const bucket =
              picksByWeek.get(
                weekId,
              ) ??
              [];

            bucket.push(
              pick,
            );

            picksByWeek.set(
              weekId,
              bucket,
            );
          }

          let perfectWeeks =
            0;

          for (
            const [
              weekId,
              weekPicks,
            ]
            of picksByWeek.entries()
          ) {
            const includedGameIds =
              includedGameIdsByWeek.get(
                weekId,
              ) ??
              new Set<number>();

            const gradedGameIds =
              new Set(
                weekPicks.map(
                  (pick) =>
                    Number(
                      pick.game_id,
                    ),
                ),
              );

            const entireWeekGraded =
              includedGameIds.size >
                0 &&
              gradedGameIds.size ===
                includedGameIds.size &&
              [...includedGameIds].every(
                (gameId) =>
                  gradedGameIds.has(
                    gameId,
                  ),
              );

            if (
              entireWeekGraded &&
              weekPicks.every(
                (pick) =>
                  pick.is_correct ===
                  true,
              )
            ) {
              perfectWeeks +=
                1;
            }
          }

          const chronological =
            [...teamPicks]
              .sort(
                (a, b) => {
                  const weekA =
                    weeks.find(
                      (week) =>
                        Number(
                          week.id,
                        ) ===
                        Number(
                          a.week_id,
                        ),
                    );

                  const weekB =
                    weeks.find(
                      (week) =>
                        Number(
                          week.id,
                        ) ===
                        Number(
                          b.week_id,
                        ),
                    );

                  const weekDiff =
                    Number(
                      weekA
                        ?.week_number ??
                      0,
                    ) -
                    Number(
                      weekB
                        ?.week_number ??
                      0,
                    );

                  if (
                    weekDiff !==
                    0
                  ) {
                    return weekDiff;
                  }

                  return (
                    Number(
                      a.game_id,
                    ) -
                    Number(
                      b.game_id,
                    )
                  );
                },
              );

          let bestStreak =
            0;

          let runningStreak =
            0;

          for (
            const pick
            of chronological
          ) {
            if (
              pick.is_correct ===
              true
            ) {
              runningStreak +=
                1;

              bestStreak =
                Math.max(
                  bestStreak,
                  runningStreak,
                );
            } else {
              runningStreak =
                0;
            }
          }

          let currentStreak =
            0;

          for (
            let index =
              chronological.length -
              1;
            index >= 0;
            index -= 1
          ) {
            if (
              chronological[index]
                .is_correct !==
              true
            ) {
              break;
            }

            currentStreak +=
              1;
          }

          return {
            teamId,

            name:
              appUser
                ?.displayName ||
              String(
                team.name,
              ),

            avatarUrl:
              appUser
                ?.avatarUrl ??
              null,

            correct,
            incorrect,
            graded,
            pickPct,
            perfectWeeks,
            currentStreak,
            bestStreak,
          };
        },
      )
      .sort(
        (a, b) =>
          b.correct -
            a.correct ||
          (
            b.pickPct ??
            -1
          ) -
            (
              a.pickPct ??
              -1
            ) ||
          b.perfectWeeks -
            a.perfectWeeks ||
          a.name.localeCompare(
            b.name,
          ),
      )
      .map(
        (row, index) => ({
          ...row,
          rank:
            index + 1,
        }),
      );

    return NextResponse.json({
      success: true,

      viewerTeamId:
        user.teamId,

      seasons,

      selectedSeason,

      standings:
        rows,
    });
  } catch (error) {
    console.error(
      "Failed to load NCAA Pick 'Em standings",
      error,
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to load NCAA Pick 'Em standings.",
      },
      {
        status: 500,
      },
    );
  }
}
