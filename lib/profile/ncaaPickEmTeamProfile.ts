import {
  NextResponse,
} from "next/server";

import {
  supabaseAdmin,
} from "@/lib/supabaseAdmin";

import type {
  ProfileScope,
} from "@/lib/profile/profileScope";

type SeasonValue =
  number | "all";

type PickRow = {
  id: number;
  week_id: number;
  game_id: number;
  team_id: number;
  picked_team_id: string;
  is_correct: boolean | null;
};

type WeekRow = {
  id: number;
  season: number;
  week_number: number;
  label: string;
  status: string;
};

type GameRow = {
  id: number;
  week_id: number;
  kickoff_at: string;
  included: boolean;
  winner_team_id: string | null;
};

type WeekSummary = {
  weekId: number;
  season: number;
  weekNumber: number;
  label: string;

  correct: number;
  incorrect: number;
  total: number;
  pickPct: number | null;

  perfect: boolean;
  complete: boolean;
};

function round(
  value: number,
  digits = 1,
) {
  return Number(
    value.toFixed(
      digits,
    ),
  );
}

function emptyFantasySummary() {
  return {
    slatesPlayed: 0,
    wins: 0,
    runnerUps: 0,
    podiumFinishes: 0,
    winRate: null,
    avgFinish: null,
    avgScore: null,
    currentWinStreak: 0,
    longestWinStreak: 0,
  };
}

function emptyFantasyMilestones() {
  return {
    score175: 0,
    score200: 0,
    score225: 0,
    score250: 0,
    backToBackWins: 0,
    threePeats: 0,
    longestPodiumStreak: 0,
    photoFinishWins: 0,
    statementWins: 0,
    closestWinningMargin: null,
    largestWinningMargin: null,
  };
}

function getCorrectStreaks(
  picks: Array<
    PickRow & {
      kickoffAt: string;
      weekNumber: number;
      season: number;
    }
  >,
) {
  const chronological =
    [...picks].sort(
      (a, b) => {
        const seasonDiff =
          a.season -
          b.season;

        if (seasonDiff !== 0) {
          return seasonDiff;
        }

        const weekDiff =
          a.weekNumber -
          b.weekNumber;

        if (weekDiff !== 0) {
          return weekDiff;
        }

        const timeDiff =
          new Date(
            a.kickoffAt,
          ).getTime() -
          new Date(
            b.kickoffAt,
          ).getTime();

        if (timeDiff !== 0) {
          return timeDiff;
        }

        return (
          a.game_id -
          b.game_id
        );
      },
    );

  let longest = 0;
  let running = 0;

  for (
    const pick
    of chronological
  ) {
    if (
      pick.is_correct ===
      true
    ) {
      running += 1;

      longest =
        Math.max(
          longest,
          running,
        );
    } else {
      running = 0;
    }
  }

  let current = 0;

  for (
    let index =
      chronological.length -
      1;
    index >= 0;
    index -= 1
  ) {
    if (
      chronological[index]
        .is_correct === true
    ) {
      current += 1;
      continue;
    }

    break;
  }

  return {
    current,
    longest,
  };
}

function summarizeWeeks(
  rows: WeekSummary[],
  gradedPicks: Array<
    PickRow & {
      kickoffAt: string;
      weekNumber: number;
      season: number;
    }
  >,
) {
  const correct =
    gradedPicks.filter(
      (pick) =>
        pick.is_correct ===
        true,
    ).length;

  const incorrect =
    gradedPicks.filter(
      (pick) =>
        pick.is_correct ===
        false,
    ).length;

  const total =
    correct +
    incorrect;

  const perfectWeeks =
    rows.filter(
      (row) =>
        row.perfect,
    ).length;

  const completedWeeks =
    rows.filter(
      (row) =>
        row.complete,
    );

  const streaks =
    getCorrectStreaks(
      gradedPicks,
    );

  const bestWeek =
    [...completedWeeks]
      .sort(
        (a, b) => {
          const pctA =
            a.pickPct ??
            0;

          const pctB =
            b.pickPct ??
            0;

          if (
            pctA !== pctB
          ) {
            return (
              pctB -
              pctA
            );
          }

          if (
            a.correct !==
            b.correct
          ) {
            return (
              b.correct -
              a.correct
            );
          }

          return (
            b.weekNumber -
            a.weekNumber
          );
        },
      )[0] ??
    null;

  return {
    weeksPlayed:
      completedWeeks.length,

    correct,
    incorrect,
    total,

    pickPct:
      total > 0
        ? round(
            (
              correct /
              total
            ) *
              100,
          )
        : null,

    perfectWeeks,

    currentCorrectStreak:
      streaks.current,

    longestCorrectStreak:
      streaks.longest,

    bestWeek:
      bestWeek
        ? {
            weekId:
              bestWeek.weekId,

            season:
              bestWeek.season,

            weekNumber:
              bestWeek.weekNumber,

            label:
              bestWeek.label,

            correct:
              bestWeek.correct,

            total:
              bestWeek.total,

            pickPct:
              bestWeek.pickPct,
          }
        : null,
  };
}

export async function getNcaaPickEmTeamProfile(
  teamId: number,
  seasonParam:
    string | null,
  scope: ProfileScope,
) {
  const [teamResult, weeksResult, teamsResult] =
    await Promise.all([
      supabaseAdmin
        .from(
          "teams",
        )
        .select(
          "id, name, user_id",
        )
        .eq(
          "id",
          teamId,
        )
        .eq(
          "group_id",
          scope.groupId,
        )
        .maybeSingle(),

      supabaseAdmin
        .from(
          "ncaa_pickem_weeks",
        )
        .select(
          "id, season, week_number, label, status, league_id",
        )
        .eq(
          "league_id",
          scope.leagueId,
        )
        .order(
          "season",
          {
            ascending:
              true,
          },
        )
        .order(
          "week_number",
          {
            ascending:
              true,
          },
        ),

      supabaseAdmin
        .from(
          "teams",
        )
        .select(
          "id, name",
        )
        .eq(
          "group_id",
          scope.groupId,
        ),
    ]);

  if (
    teamResult.error
  ) {
    return NextResponse.json(
      {
        error:
          teamResult.error
            .message,
      },
      {
        status: 500,
      },
    );
  }

  if (
    weeksResult.error
  ) {
    return NextResponse.json(
      {
        error:
          weeksResult.error
            .message,
      },
      {
        status: 500,
      },
    );
  }

  const scopedWeekIds = (weeksResult.data ?? []).map((week) => Number(week.id));
  const scopedTeamIds = (teamsResult.data ?? []).map((team) => Number(team.id));
  const teamUserId = teamResult.data?.user_id ? String(teamResult.data.user_id) : null;
  const [userResult, gamesResult, picksResult] = await Promise.all([
    teamUserId
      ? supabaseAdmin.from("app_users").select("id, avatar_url").eq("id", teamUserId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    scopedWeekIds.length
      ? supabaseAdmin.from("ncaa_pickem_games").select("id, week_id, kickoff_at, included, winner_team_id").in("week_id", scopedWeekIds).eq("included", true).order("kickoff_at", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    scopedWeekIds.length && scopedTeamIds.length
      ? supabaseAdmin.from("ncaa_pickem_picks").select("id, week_id, game_id, team_id, picked_team_id, is_correct").in("week_id", scopedWeekIds).in("team_id", scopedTeamIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (userResult.error) {
    return NextResponse.json({ error: userResult.error.message }, { status: 500 });
  }

  if (
    gamesResult.error
  ) {
    return NextResponse.json(
      {
        error:
          gamesResult.error
            .message,
      },
      {
        status: 500,
      },
    );
  }

  if (
    picksResult.error
  ) {
    return NextResponse.json(
      {
        error:
          picksResult.error
            .message,
      },
      {
        status: 500,
      },
    );
  }

  const team =
    teamResult.data ?? {
      id:
        teamId,

      name:
        `Team ${teamId}`,
    };

  const profileUser = userResult.data;

  const weeks =
    (
      weeksResult.data ??
      []
    ) as WeekRow[];

  const games =
    (
      gamesResult.data ??
      []
    ) as GameRow[];

  const allPicks =
    (
      picksResult.data ??
      []
    ) as PickRow[];

  const teamPicks =
    allPicks.filter(
      (pick) =>
        Number(
          pick.team_id,
        ) ===
        teamId,
    );

  const latestSeason =
    weeks.length > 0
      ? Math.max(
          ...weeks.map(
            (week) =>
              Number(
                week.season,
              ),
          ),
        )
      : new Date()
          .getFullYear();

  const isAllTime =
    !seasonParam ||
    seasonParam ===
      "all";

  const requestedSeason =
    Number(
      seasonParam,
    );

  const selectedSeason:
    SeasonValue =
    isAllTime
      ? "all"
      : Number.isFinite(
            requestedSeason,
          )
        ? requestedSeason
        : latestSeason;

  const weekById =
    new Map<
      number,
      WeekRow
    >(
      weeks.map(
        (week) => [
          Number(
            week.id,
          ),
          week,
        ],
      ),
    );

  const gameById =
    new Map<
      number,
      GameRow
    >(
      games.map(
        (game) => [
          Number(
            game.id,
          ),
          game,
        ],
      ),
    );

  const gamesByWeek =
    new Map<
      number,
      GameRow[]
    >();

  for (
    const game
    of games
  ) {
    const weekId =
      Number(
        game.week_id,
      );

    const existing =
      gamesByWeek.get(
        weekId,
      ) ??
      [];

    existing.push(
      game,
    );

    gamesByWeek.set(
      weekId,
      existing,
    );
  }

  const picksByWeek =
    new Map<
      number,
      PickRow[]
    >();

  for (
    const pick
    of teamPicks
  ) {
    if (
      !gameById.has(
        Number(
          pick.game_id,
        ),
      )
    ) {
      continue;
    }

    const weekId =
      Number(
        pick.week_id,
      );

    const existing =
      picksByWeek.get(
        weekId,
      ) ??
      [];

    existing.push(
      pick,
    );

    picksByWeek.set(
      weekId,
      existing,
    );
  }

  const weekSummaries:
    WeekSummary[] =
    weeks
      .map(
        (week) => {
          const weekId =
            Number(
              week.id,
            );

          const weekGames =
            gamesByWeek.get(
              weekId,
            ) ??
            [];

          const picks =
            picksByWeek.get(
              weekId,
            ) ??
            [];

          const pickByGame =
            new Map(
              picks.map(
                (pick) => [
                  Number(
                    pick.game_id,
                  ),
                  pick,
                ],
              ),
            );

          const gameFullyGraded =
            weekGames.length >
              0 &&
            weekGames.every(
              (game) =>
                Boolean(
                  game.winner_team_id,
                ),
            );

          const playerHasAllPicks =
            weekGames.length >
              0 &&
            weekGames.every(
              (game) =>
                pickByGame.has(
                  Number(
                    game.id,
                  ),
                ),
            );

          const playerGradesComplete =
            weekGames.length >
              0 &&
            weekGames.every(
              (game) => {
                const pick =
                  pickByGame.get(
                    Number(
                      game.id,
                    ),
                  );

                return (
                  pick?.is_correct ===
                    true ||
                  pick?.is_correct ===
                    false
                );
              },
            );

          const complete =
            gameFullyGraded &&
            playerHasAllPicks &&
            playerGradesComplete;

          const graded =
            picks.filter(
              (pick) =>
                pick.is_correct ===
                  true ||
                pick.is_correct ===
                  false,
            );

          const correct =
            graded.filter(
              (pick) =>
                pick.is_correct ===
                true,
            ).length;

          const incorrect =
            graded.filter(
              (pick) =>
                pick.is_correct ===
                false,
            ).length;

          const total =
            correct +
            incorrect;

          return {
            weekId,

            season:
              Number(
                week.season,
              ),

            weekNumber:
              Number(
                week.week_number,
              ),

            label:
              week.label,

            correct,
            incorrect,
            total,

            pickPct:
              total > 0
                ? round(
                    (
                      correct /
                      total
                    ) *
                      100,
                  )
                : null,

            complete,

            perfect:
              complete &&
              total > 0 &&
              incorrect === 0,
          };
        },
      )
      .filter(
        (row) =>
          (
            gamesByWeek.get(
              row.weekId,
            ) ??
            []
          ).length >
          0,
      );

  const gradedTeamPicks =
    teamPicks
      .filter(
        (pick) =>
          (
            pick.is_correct ===
              true ||
            pick.is_correct ===
              false
          ) &&
          gameById.has(
            Number(
              pick.game_id,
            ),
          ) &&
          weekById.has(
            Number(
              pick.week_id,
            ),
          ),
      )
      .map(
        (pick) => {
          const game =
            gameById.get(
              Number(
                pick.game_id,
              ),
            )!;

          const week =
            weekById.get(
              Number(
                pick.week_id,
              ),
            )!;

          return {
            ...pick,

            kickoffAt:
              game.kickoff_at,

            weekNumber:
              Number(
                week.week_number,
              ),

            season:
              Number(
                week.season,
              ),
          };
        },
      );

  const selectedWeekRows =
    selectedSeason ===
      "all"
      ? weekSummaries
      : weekSummaries.filter(
          (row) =>
            row.season ===
            selectedSeason,
        );

  const selectedGradedPicks =
    selectedSeason ===
      "all"
      ? gradedTeamPicks
      : gradedTeamPicks.filter(
          (pick) =>
            pick.season ===
            selectedSeason,
        );

  const selectedSummary =
    summarizeWeeks(
      selectedWeekRows,
      selectedGradedPicks,
    );

  const careerSummary =
    summarizeWeeks(
      weekSummaries,
      gradedTeamPicks,
    );

  const recentWeeks =
    selectedWeekRows
      .filter(
        (row) =>
          row.complete,
      )
      .sort(
        (a, b) =>
          b.season -
            a.season ||
          b.weekNumber -
            a.weekNumber,
      )
      .slice(
        0,
        8,
      );

  const careerPerfectWeeks =
    careerSummary
      .perfectWeeks;

  const careerPickPct =
    careerSummary
      .pickPct;

  const milestones = {
    fiveStraight:
      careerSummary
        .longestCorrectStreak >=
      5,

    tenStraight:
      careerSummary
        .longestCorrectStreak >=
      10,

    firstPerfectWeek:
      careerPerfectWeeks >=
      1,

    twoPerfectWeeks:
      careerPerfectWeeks >=
      2,

    fivePerfectWeeks:
      careerPerfectWeeks >=
      5,

    accuracy75:
      careerSummary.total >=
        20 &&
      Number(
        careerPickPct ??
          0,
      ) >= 75,

    accuracy75Progress: {
      correct:
        careerSummary.correct,

      total:
        careerSummary.total,

      pickPct:
        careerPickPct,

      minimumPicks:
        20,
    },
  };

  /*
   * Season championships are intentionally conservative.
   *
   * A championship exists only when:
   *   1. every Pick 'Em week with included games in that
   *      season is marked final;
   *   2. every included game has a winner;
   *   3. there is one unique leader in correct picks.
   *
   * No midseason "championship" trophies.
   */
  const championships:
    Array<{
      season: number;
      correct: number;
      total: number;
      pickPct:
        number | null;
    }> = [];

  const seasons =
    Array.from(
      new Set(
        weeks.map(
          (week) =>
            Number(
              week.season,
            ),
        ),
      ),
    );

  for (
    const season
    of seasons
  ) {
    const seasonWeeks =
      weeks.filter(
        (week) =>
          Number(
            week.season,
          ) ===
            season &&
          (
            gamesByWeek.get(
              Number(
                week.id,
              ),
            ) ??
            []
          ).length >
            0,
      );

    if (
      seasonWeeks.length ===
      0
    ) {
      continue;
    }

    const seasonComplete =
      seasonWeeks.every(
        (week) =>
          week.status ===
            "final" &&
          (
            gamesByWeek.get(
              Number(
                week.id,
              ),
            ) ??
            []
          ).every(
            (game) =>
              Boolean(
                game.winner_team_id,
              ),
          ),
      );

    if (!seasonComplete) {
      continue;
    }

    const seasonWeekIds =
      new Set(
        seasonWeeks.map(
          (week) =>
            Number(
              week.id,
            ),
        ),
      );

    const seasonGameIds =
      new Set(
        games
          .filter(
            (game) =>
              seasonWeekIds.has(
                Number(
                  game.week_id,
                ),
              ),
          )
          .map(
            (game) =>
              Number(
                game.id,
              ),
          ),
      );

    const teamScores =
      new Map<
        number,
        {
          correct: number;
          total: number;
        }
      >();

    for (
      const pick
      of allPicks
    ) {
      if (
        !seasonWeekIds.has(
          Number(
            pick.week_id,
          ),
        ) ||
        !seasonGameIds.has(
          Number(
            pick.game_id,
          ),
        ) ||
        (
          pick.is_correct !==
            true &&
          pick.is_correct !==
            false
        )
      ) {
        continue;
      }

      const row =
        teamScores.get(
          Number(
            pick.team_id,
          ),
        ) ?? {
          correct: 0,
          total: 0,
        };

      row.total += 1;

      if (
        pick.is_correct ===
        true
      ) {
        row.correct += 1;
      }

      teamScores.set(
        Number(
          pick.team_id,
        ),
        row,
      );
    }

    const leaderboard =
      [...teamScores.entries()]
        .map(
          ([
            contenderTeamId,
            row,
          ]) => ({
            teamId:
              contenderTeamId,

            ...row,
          }),
        )
        .sort(
          (a, b) =>
            b.correct -
              a.correct ||
            b.total -
              a.total,
        );

    if (
      leaderboard.length ===
      0
    ) {
      continue;
    }

    const leader =
      leaderboard[0];

    const tiedLeader =
      leaderboard
        .slice(
          1,
        )
        .some(
          (row) =>
            row.correct ===
            leader.correct,
        );

    if (
      tiedLeader ||
      leader.teamId !==
        teamId
    ) {
      continue;
    }

    championships.push({
      season,

      correct:
        leader.correct,

      total:
        leader.total,

      pickPct:
        leader.total > 0
          ? round(
              (
                leader.correct /
                leader.total
              ) *
                100,
            )
          : null,
    });
  }

  championships.sort(
    (a, b) =>
      b.season -
      a.season,
  );

  const emptySeason =
    emptyFantasySummary();

  return NextResponse.json({
    success: true,

    sport:
      "ncaa",

    scope: {
      groupId:
        scope.groupId,

      leagueId:
        scope.leagueId,
    },

    team: {
      id:
        Number(
          team.id,
        ),

      name:
        team.name,

      avatarUrl:
        profileUser
          ?.avatar_url ??
        null,
    },

    latestSeason,

    selectedSeason,

    /*
     * Keep the common profile response contract intact.
     * NCAA's real numbers live in ncaaPickEm below.
     */
    seasonSummary:
      emptySeason,

    careerSummary: {
      ...emptySeason,

      bestScore:
        null,

      worstScore:
        null,

      favoritePlayer:
        null,

      bestAvgPlayer:
        null,

      bestPickEver:
        null,

      bestSlate:
        null,

      worstSlate:
        null,
    },

    milestones:
      emptyFantasyMilestones(),

    milestoneThresholds: {
      score175: 0,
      score200: 0,
      score225: 0,
      score250: 0,
      photoFinishMargin: 0,
      statementWinMargin: 0,
    },

    leagueAwards: [],
    recentSlates: [],

    ncaaPickEm: {
      selectedSummary,
      careerSummary,
      recentWeeks,
      milestones,
      seasonChampionships:
        championships,

      availableSeasons:
        [...seasons].sort(
          (a, b) =>
            b - a,
        ),
    },
  });
}
