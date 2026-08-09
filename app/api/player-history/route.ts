import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  supabaseAdmin,
} from "@/lib/supabaseAdmin";

type SlateRow = {
  id: number;
  start_date: string | null;
  date: string;
  is_locked: boolean;
};

type PlayerRow = {
  id: number;
  name: string;
  external_id: number | null;
};

type LineupRow = {
  id: number;
  slate_id: number;
  team_id: number;
};

type LineupPlayerRow = {
  lineup_id: number;
  player_id: number;
};

type PlayerSlateStatRow = {
  slate_id: number;
  player_id: number;
  fantasy_points: number | null;
};

type TeamSlateResultRow = {
  slate_id: number;
  team_id: number;
  finish_position: number | null;
};

function getSeasonFromDate(
  dateString: string,
) {
  return new Date(
    `${dateString}T00:00:00`,
  ).getFullYear();
}

function roundTo(
  value: number,
  digits = 2,
) {
  return Number(
    value.toFixed(digits),
  );
}

function numberOrNull(
  value: unknown,
) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const parsed =
    Number(value);

  return Number.isFinite(parsed)
    ? parsed
    : null;
}

async function getGolfPlayerHistory(
  seasonParam: string | null,
) {
  const db =
    supabaseAdmin as any;

  const isAllTime =
    seasonParam === "all";

  const selectedSeason =
    isAllTime
      ? "all"
      : seasonParam &&
          Number.isFinite(
            Number(seasonParam),
          )
        ? Number(seasonParam)
        : 2026;

  const [
    slateResponse,
    golferResponse,
  ] = await Promise.all([
    db
      .from("slates")
      .select(
        "id, date, start_date, end_date, display_name, is_locked",
      )
      .eq("sport", "golf"),

    db
      .from("golf_players")
      .select(
        "id, display_name, short_name, espn_player_id, headshot_url, country, owgr_rank",
      )
      .order(
        "display_name",
        {
          ascending: true,
        },
      ),
  ]);

  const setupError =
    slateResponse.error ??
    golferResponse.error;

  if (setupError) {
    return NextResponse.json(
      {
        error:
          setupError.message ??
          "Unable to load Golf player history setup.",
      },
      { status: 500 },
    );
  }

  const slates =
    (slateResponse.data ??
      []) as any[];

  const golfers =
    (golferResponse.data ??
      []) as any[];

  const selectedSlates =
    slates.filter(
      (slate) => {
        if (isAllTime) {
          return true;
        }

        const date =
          slate.start_date ??
          slate.date ??
          "";

        return (
          Number(
            String(date).slice(
              0,
              4,
            ),
          ) ===
          selectedSeason
        );
      },
    );

  const slateIds =
    selectedSlates.map(
      (slate) =>
        Number(slate.id),
    );

  if (
    slateIds.length === 0
  ) {
    return NextResponse.json({
      success: true,
      season:
        selectedSeason,
      sport: "golf",
      playerHistory: [],
    });
  }

  const [
    lineupResponse,
    resultResponse,
    eventPlayerResponse,
  ] = await Promise.all([
    db
      .from("lineups")
      .select(
        `
        id,
        slate_id,
        team_id,
        lineup_players (
          player_id
        )
      `,
      )
      .in(
        "slate_id",
        slateIds,
      ),

    db
      .from(
        "team_slate_results",
      )
      .select(
        "slate_id, team_id, fantasy_points, finish_position",
      )
      .in(
        "slate_id",
        slateIds,
      ),

    db
      .from(
        "golf_event_players",
      )
      .select(
        `
        id,
        slate_id,
        player_id,
        leaderboard_order,
        official_score_to_par,
        fantasy_score,
        penalty_strokes,
        status,
        rounds_completed,
        holes_completed,
        current_round,
        golf_rounds (
          id,
          round_number,
          score_to_par,
          strokes,
          holes_completed,
          status,
          golf_holes (
            hole_number,
            strokes,
            relative_to_par
          )
        )
      `,
      )
      .in(
        "slate_id",
        slateIds,
      ),
  ]);

  const dataError =
    lineupResponse.error ??
    resultResponse.error ??
    eventPlayerResponse.error;

  if (dataError) {
    return NextResponse.json(
      {
        error:
          dataError.message ??
          "Unable to load Golf player history data.",
      },
      { status: 500 },
    );
  }

  const lineups =
    lineupResponse.data ??
    [];

  const results =
    resultResponse.data ??
    [];

  const eventPlayers =
    eventPlayerResponse.data ??
    [];

  const golferById =
    new Map(
      golfers.map(
        (golfer) => [
          Number(
            golfer.id,
          ),
          golfer,
        ],
      ),
    );

  const slateById =
    new Map(
      selectedSlates.map(
        (slate) => [
          Number(
            slate.id,
          ),
          slate,
        ],
      ),
    );

  const resultBySlateTeam =
    new Map<string, any>();

  results.forEach(
    (result: any) => {
      resultBySlateTeam.set(
        `${Number(
          result.slate_id,
        )}:${Number(
          result.team_id,
        )}`,
        result,
      );
    },
  );

  const eventPlayerBySlatePlayer =
    new Map<string, any>();

  eventPlayers.forEach(
    (eventPlayer: any) => {
      eventPlayerBySlatePlayer.set(
        `${Number(
          eventPlayer.slate_id,
        )}:${Number(
          eventPlayer.player_id,
        )}`,
        eventPlayer,
      );
    },
  );

  type GolfAccumulator = {
    playerId: number;
    playerName: string;
    espnPlayerId:
      string | null;
    headshotUrl:
      string | null;
    country:
      string | null;
    owgrRank:
      number | null;

    timesDrafted: number;

    scores: number[];

    wins: number;
    runnerUps: number;
    podiums: number;
    finishes: number[];

    cutsMade: number;
    cutOpportunities: number;

    completedRounds: number;
    roundsUnderPar: number;

    birdies: number;
    eagles: number;
    albatrosses: number;
    holesInOne: number;
    pars: number;
    bogeys: number;
    doubleBogeysOrWorse:
      number;
  };

  const accumulatorByPlayerId =
    new Map<
      number,
      GolfAccumulator
    >();

  function getAccumulator(
    playerId: number,
  ) {
    const existing =
      accumulatorByPlayerId.get(
        playerId,
      );

    if (existing) {
      return existing;
    }

    const golfer =
      golferById.get(
        playerId,
      );

    if (!golfer) {
      return null;
    }

    const created:
      GolfAccumulator = {
        playerId,
        playerName:
          String(
            golfer.display_name ??
              "Unknown Golfer",
          ),
        espnPlayerId:
          golfer.espn_player_id ??
          null,
        headshotUrl:
          golfer.headshot_url ??
          null,
        country:
          golfer.country ??
          null,
        owgrRank:
          numberOrNull(
            golfer.owgr_rank,
          ),

        timesDrafted: 0,

        scores: [],

        wins: 0,
        runnerUps: 0,
        podiums: 0,
        finishes: [],

        cutsMade: 0,
        cutOpportunities: 0,

        completedRounds: 0,
        roundsUnderPar: 0,

        birdies: 0,
        eagles: 0,
        albatrosses: 0,
        holesInOne: 0,
        pars: 0,
        bogeys: 0,
        doubleBogeysOrWorse:
          0,
      };

    accumulatorByPlayerId.set(
      playerId,
      created,
    );

    return created;
  }

  /*
   * A golfer's league history is based only on
   * tournaments where that golfer was drafted.
   */
  for (
    const lineup
    of lineups
  ) {
    const slateId =
      Number(
        lineup.slate_id,
      );

    const teamId =
      Number(
        lineup.team_id,
      );

    const slate =
      slateById.get(
        slateId,
      );

    const result =
      resultBySlateTeam.get(
        `${slateId}:${teamId}`,
      );

    for (
      const lineupPlayer
      of lineup.lineup_players ??
      []
    ) {
      const playerId =
        Number(
          lineupPlayer.player_id,
        );

      const accumulator =
        getAccumulator(
          playerId,
        );

      if (!accumulator) {
        continue;
      }

      accumulator.timesDrafted +=
        1;

      const eventPlayer =
        eventPlayerBySlatePlayer.get(
          `${slateId}:${playerId}`,
        );

      if (eventPlayer) {
        const score =
          numberOrNull(
            eventPlayer.official_score_to_par,
          );

        if (score !== null) {
          accumulator.scores.push(
            score,
          );
        }

        const status =
          String(
            eventPlayer.status ??
              "",
          ).toLowerCase();

        const roundsCompleted =
          Number(
            eventPlayer.rounds_completed ??
              0,
          );

        const holesCompleted =
          Number(
            eventPlayer.holes_completed ??
              0,
          );

        /*
         * A cut opportunity exists once the golfer
         * has reached the 36-hole decision point.
         */
        const reachedCutDecision =
          roundsCompleted >= 2 ||
          holesCompleted >= 36 ||
          [
            "cut",
            "finished",
          ].includes(
            status,
          );

        if (
          reachedCutDecision
        ) {
          accumulator.cutOpportunities +=
            1;

          if (
            ![
              "cut",
              "withdrawn",
              "disqualified",
              "did_not_start",
            ].includes(
              status,
            )
          ) {
            accumulator.cutsMade +=
              1;
          }
        }

        for (
          const round
          of eventPlayer.golf_rounds ??
          []
        ) {
          const roundScore =
            numberOrNull(
              round.score_to_par,
            );

          const roundHoles =
            Number(
              round.holes_completed ??
                0,
            );

          if (
            roundHoles >= 18
          ) {
            accumulator.completedRounds +=
              1;

            if (
              roundScore !== null &&
              roundScore < 0
            ) {
              accumulator.roundsUnderPar +=
                1;
            }
          }

          for (
            const hole
            of round.golf_holes ??
            []
          ) {
            const relative =
              numberOrNull(
                hole.relative_to_par,
              );

            const strokes =
              numberOrNull(
                hole.strokes,
              );

            if (
              strokes === 1
            ) {
              accumulator.holesInOne +=
                1;
            }

            if (
              relative === null
            ) {
              continue;
            }

            if (
              relative <= -3
            ) {
              accumulator.albatrosses +=
                1;
            } else if (
              relative === -2
            ) {
              accumulator.eagles +=
                1;
            } else if (
              relative === -1
            ) {
              accumulator.birdies +=
                1;
            } else if (
              relative === 0
            ) {
              accumulator.pars +=
                1;
            } else if (
              relative === 1
            ) {
              accumulator.bogeys +=
                1;
            } else if (
              relative >= 2
            ) {
              accumulator.doubleBogeysOrWorse +=
                1;
            }
          }
        }
      }

      /*
       * Wins/finishes are league-team results, not PGA
       * leaderboard finishes. Only finalized slates count.
       */
      if (
        slate?.is_locked &&
        result?.finish_position !==
          null &&
        result?.finish_position !==
          undefined
      ) {
        const finish =
          Number(
            result.finish_position,
          );

        accumulator.finishes.push(
          finish,
        );

        if (
          finish === 1
        ) {
          accumulator.wins +=
            1;
        }

        if (
          finish === 2
        ) {
          accumulator.runnerUps +=
            1;
        }

        if (
          finish >= 1 &&
          finish <= 3
        ) {
          accumulator.podiums +=
            1;
        }
      }
    }
  }

  const playerHistory =
    Array.from(
      accumulatorByPlayerId.values(),
    )
      .map(
        (row) => {
          const avgScore =
            row.scores.length > 0
              ? roundTo(
                  row.scores.reduce(
                    (
                      sum,
                      score,
                    ) =>
                      sum +
                      score,
                    0,
                  ) /
                    row.scores.length,
                )
              : 0;

          const bestScore =
            row.scores.length > 0
              ? Math.min(
                  ...row.scores,
                )
              : 0;

          const worstScore =
            row.scores.length > 0
              ? Math.max(
                  ...row.scores,
                )
              : 0;

          const avgFinish =
            row.finishes.length > 0
              ? roundTo(
                  row.finishes.reduce(
                    (
                      sum,
                      finish,
                    ) =>
                      sum +
                      finish,
                    0,
                  ) /
                    row.finishes.length,
                )
              : null;

          return {
            player_id:
              row.playerId,
            player_name:
              row.playerName,

            nba_player_id:
              null,
            nfl_player_id:
              null,

            espn_golf_player_id:
              row.espnPlayerId,
            headshot_url:
              row.headshotUrl,
            country:
              row.country,
            owgr_rank:
              row.owgrRank,

            times_drafted:
              row.timesDrafted,

            /*
             * Keep the existing generic field names so the
             * current page can consume this response before
             * Patch 2 changes its Golf UI.
             */
            avg_score:
              avgScore,
            high_score:
              bestScore,
            low_score:
              worstScore,

            winning_lineups:
              row.wins,
            runner_up_lineups:
              row.runnerUps,
            podium_lineups:
              row.podiums,
            avg_finish:
              avgFinish,

            cuts_made:
              row.cutsMade,
            cut_opportunities:
              row.cutOpportunities,
            cuts_made_pct:
              row.cutOpportunities >
              0
                ? roundTo(
                    (
                      row.cutsMade /
                      row.cutOpportunities
                    ) *
                      100,
                    1,
                  )
                : null,

            completed_rounds:
              row.completedRounds,
            rounds_under_par:
              row.roundsUnderPar,

            birdies:
              row.birdies,
            eagles:
              row.eagles,
            albatrosses:
              row.albatrosses,
            holes_in_one:
              row.holesInOne,
            pars:
              row.pars,
            bogeys:
              row.bogeys,
            double_bogeys_or_worse:
              row.doubleBogeysOrWorse,
          };
        },
      )
      .sort(
        (a, b) =>
          b.times_drafted -
            a.times_drafted ||
          a.avg_score -
            b.avg_score ||
          a.player_name.localeCompare(
            b.player_name,
          ),
      );

  return NextResponse.json({
    success: true,
    season:
      selectedSeason,
    sport: "golf",
    playerHistory,
  });
}

export async function GET(
  request: NextRequest,
) {
  try {
    const seasonParam =
      request.nextUrl.searchParams.get(
        "season",
      );

    const sportParam =
      request.nextUrl.searchParams.get(
        "sport",
      );

    if (
      sportParam === "golf"
    ) {
      return getGolfPlayerHistory(
        seasonParam,
      );
    }

    const sport =
      sportParam === "nfl"
        ? "nfl"
        : "nba";

    const isAllTime =
      seasonParam === "all";

    const selectedSeason =
      isAllTime
        ? "all"
        : seasonParam &&
            Number.isFinite(
              Number(
                seasonParam,
              ),
            )
          ? Number(
              seasonParam,
            )
          : 2026;

    const [
      {
        data: slates,
        error: slatesError,
      },
      {
        data: players,
        error: playersError,
      },
      {
        data: lineups,
        error: lineupsError,
      },
      {
        data: lineupPlayers,
        error:
          lineupPlayersError,
      },
      {
        data: playerSlateStats,
        error:
          playerSlateStatsError,
      },
      {
        data: teamSlateResults,
        error:
          teamSlateResultsError,
      },
    ] = await Promise.all([
      supabaseAdmin
        .from("slates")
        .select(
          "id, start_date, date, is_locked",
        )
        .eq(
          "is_locked",
          true,
        )
        .eq(
          "sport",
          sport,
        ),

      supabaseAdmin
        .from(
          sport === "nfl"
            ? "players_nfl"
            : "players",
        )
        .select(
          sport === "nfl"
            ? "id, name, external_id:nfl_player_id"
            : "id, name, external_id:nba_player_id",
        )
        .order(
          "name",
          {
            ascending: true,
          },
        ),

      supabaseAdmin
        .from("lineups")
        .select(
          "id, slate_id, team_id",
        ),

      supabaseAdmin
        .from(
          "lineup_players",
        )
        .select(
          "lineup_id, player_id",
        ),

      supabaseAdmin
        .from(
          sport === "nfl"
            ? "player_nfl_slate_stats"
            : "player_slate_stats",
        )
        .select(
          "slate_id, player_id, fantasy_points",
        ),

      supabaseAdmin
        .from(
          "team_slate_results",
        )
        .select(
          "slate_id, team_id, finish_position",
        ),
    ]);

    if (
      slatesError ||
      playersError ||
      lineupsError ||
      lineupPlayersError ||
      playerSlateStatsError ||
      teamSlateResultsError
    ) {
      return NextResponse.json(
        {
          error:
            slatesError?.message ||
            playersError?.message ||
            lineupsError?.message ||
            lineupPlayersError?.message ||
            playerSlateStatsError?.message ||
            teamSlateResultsError?.message ||
            "Failed to load player history data.",
        },
        { status: 500 },
      );
    }

    const safeSlates =
      (slates ??
        []) as SlateRow[];

    const safePlayers =
      (players ??
        []) as PlayerRow[];

    const safeLineups =
      (lineups ??
        []) as LineupRow[];

    const safeLineupPlayers =
      (lineupPlayers ??
        []) as LineupPlayerRow[];

    const safePlayerSlateStats =
      (playerSlateStats ??
        []) as PlayerSlateStatRow[];

    const safeTeamSlateResults =
      (teamSlateResults ??
        []) as TeamSlateResultRow[];

    const seasonSlateIds =
      new Set(
        safeSlates
          .filter(
            (slate) => {
              if (
                isAllTime
              ) {
                return true;
              }

              const effectiveDate =
                slate.start_date ??
                slate.date;

              return (
                getSeasonFromDate(
                  effectiveDate,
                ) ===
                selectedSeason
              );
            },
          )
          .map(
            (slate) =>
              slate.id,
          ),
      );

    const seasonLineups =
      safeLineups.filter(
        (lineup) =>
          seasonSlateIds.has(
            lineup.slate_id,
          ),
      );

    const lineupMap =
      new Map<
        number,
        LineupRow
      >();

    seasonLineups.forEach(
      (lineup) =>
        lineupMap.set(
          lineup.id,
          lineup,
        ),
    );

    const playerSlateStatMap =
      new Map<
        string,
        number
      >();

    safePlayerSlateStats.forEach(
      (row) => {
        if (
          !seasonSlateIds.has(
            row.slate_id,
          )
        ) {
          return;
        }

        playerSlateStatMap.set(
          `${row.slate_id}-${row.player_id}`,
          Number(
            row.fantasy_points ??
              0,
          ),
        );
      },
    );

    const finishMap =
      new Map<
        string,
        number | null
      >();

    safeTeamSlateResults.forEach(
      (row) => {
        if (
          !seasonSlateIds.has(
            row.slate_id,
          )
        ) {
          return;
        }

        finishMap.set(
          `${row.slate_id}-${row.team_id}`,
          row.finish_position ??
            null,
        );
      },
    );

    const playerAggMap =
      new Map<
        number,
        {
          player_id:
            number;
          player_name:
            string;
          external_id:
            number | null;
          times_drafted:
            number;
          scores:
            number[];
          winning_lineups:
            number;
          runner_up_lineups:
            number;
          finishes:
            number[];
        }
      >();

    safeLineupPlayers.forEach(
      (
        lineupPlayer,
      ) => {
        const lineup =
          lineupMap.get(
            lineupPlayer.lineup_id,
          );

        if (!lineup) {
          return;
        }

        const player =
          safePlayers.find(
            (candidate) =>
              candidate.id ===
              lineupPlayer.player_id,
          );

        if (!player) {
          return;
        }

        const scoreKey =
          `${lineup.slate_id}-${lineupPlayer.player_id}`;

        const finishKey =
          `${lineup.slate_id}-${lineup.team_id}`;

        const fantasyPoints =
          playerSlateStatMap.get(
            scoreKey,
          ) ?? 0;

        const finishPosition =
          finishMap.get(
            finishKey,
          ) ?? null;

        const current =
          playerAggMap.get(
            player.id,
          ) ?? {
            player_id:
              player.id,
            player_name:
              player.name,
            external_id:
              player.external_id,
            times_drafted:
              0,
            scores: [],
            winning_lineups:
              0,
            runner_up_lineups:
              0,
            finishes: [],
          };

        current.times_drafted +=
          1;

        current.scores.push(
          fantasyPoints,
        );

        if (
          finishPosition === 1
        ) {
          current.winning_lineups +=
            1;
        }

        if (
          finishPosition !==
          null
        ) {
          current.finishes.push(
            finishPosition,
          );
        }

        if (
          finishPosition === 2
        ) {
          current.runner_up_lineups +=
            1;
        }

        playerAggMap.set(
          player.id,
          current,
        );
      },
    );

    const playerHistory =
      Array.from(
        playerAggMap.values(),
      )
        .map(
          (row) => {
            const scoringGames =
              row.scores.filter(
                (score) =>
                  Number(
                    score,
                  ) > 0,
              );

            const avgScore =
              scoringGames.length >
              0
                ? roundTo(
                    scoringGames.reduce(
                      (
                        sum,
                        value,
                      ) =>
                        sum +
                        value,
                      0,
                    ) /
                      scoringGames.length,
                  )
                : 0;

            const highScore =
              scoringGames.length >
              0
                ? roundTo(
                    Math.max(
                      ...scoringGames,
                    ),
                  )
                : 0;

            const avgFinish =
              row.finishes.length >
              0
                ? roundTo(
                    row.finishes.reduce(
                      (
                        a,
                        b,
                      ) =>
                        a +
                        b,
                      0,
                    ) /
                      row.finishes.length,
                  )
                : null;

            const lowScore =
              scoringGames.length >
              0
                ? roundTo(
                    Math.min(
                      ...scoringGames,
                    ),
                  )
                : 0;

            return {
              player_id:
                row.player_id,
              player_name:
                row.player_name,

              nba_player_id:
                sport ===
                "nba"
                  ? row.external_id
                  : null,

              nfl_player_id:
                sport ===
                "nfl"
                  ? row.external_id
                  : null,

              times_drafted:
                row.times_drafted,
              avg_score:
                avgScore,
              high_score:
                highScore,
              low_score:
                lowScore,
              winning_lineups:
                row.winning_lineups,
              runner_up_lineups:
                row.runner_up_lineups,
              avg_finish:
                avgFinish,
            };
          },
        )
        .sort(
          (a, b) => {
            if (
              b.times_drafted !==
              a.times_drafted
            ) {
              return (
                b.times_drafted -
                a.times_drafted
              );
            }

            if (
              b.avg_score !==
              a.avg_score
            ) {
              return (
                b.avg_score -
                a.avg_score
              );
            }

            return (
              a.player_name.localeCompare(
                b.player_name,
              )
            );
          },
        );

    return NextResponse.json({
      success: true,
      season:
        selectedSeason,
      sport,
      playerHistory,
    });
  } catch (error) {
    console.error(
      error,
    );

    return NextResponse.json(
      {
        error:
          "Unexpected server error while loading player history.",
      },
      { status: 500 },
    );
  }
}
