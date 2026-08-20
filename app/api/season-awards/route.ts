import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  supabaseAdmin,
} from "@/lib/supabaseAdmin";

import {
  getCurrentUser,
} from "@/lib/auth";

import {
  getActiveLeagueForSport,
  type LeagueSportKey,
} from "@/lib/groups/context";

import {
  leagueSportKeyFromSportKey,
} from "@/lib/sports";


function roundTo(
  value: number,
  digits = 1,
) {
  return Number(
    value.toFixed(
      digits,
    ),
  );
}


function getSeasonFromDate(
  dateString: string,
) {
  return new Date(
    `${dateString}T00:00:00`,
  ).getFullYear();
}


type PlayerRow = {
  id: number;
  name: string;

  position_group:
    | "G"
    | "F/C"
    | null;

  nba_player_id:
    number | null;
};


function emptyAwards(
  season: number,
  scope?: {
    groupId: string;
    leagueId: string;
  },
) {
  return {
    success: true,
    season,

    scope:
      scope ??
      null,

    awards: [],

    firstTeam: {
      guards: [],
      frontcourt: [],
    },
  };
}


export async function GET(
  request: NextRequest,
) {
  try {
    const requestedSeason =
      request.nextUrl
        .searchParams
        .get(
          "season",
        );

    const season =
      requestedSeason
        ? Number(
            requestedSeason,
          )
        : 2026;


    if (
      !Number.isFinite(
        season,
      )
    ) {
      return NextResponse.json(
        {
          error:
            "Invalid season.",
        },
        {
          status: 400,
        },
      );
    }


    const sport =
      String(
        request.nextUrl
          .searchParams
          .get(
            "sport",
          ) ??
          "nba",
      );


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


    const leagueSportKey =
      leagueSportKeyFromSportKey(
        sport,
      ) as LeagueSportKey;


    const activeLeague =
      await getActiveLeagueForSport(
        user,
        leagueSportKey,
      );


    if (!activeLeague) {
      return NextResponse.json(
        {
          error:
            "This League is not enabled for the active Group.",
        },
        {
          status: 404,
        },
      );
    }


    const scope = {
      groupId:
        activeLeague.context.group.id,

      leagueId:
        activeLeague.league.id,
    };


    /*
     * The current Season Awards UI/stat model is NBA-specific:
     * guards/frontcourt, steals, blocks, etc.
     *
     * Other sports should not accidentally inherit NBA awards.
     */
    if (
      sport !== "nba"
    ) {
      return NextResponse.json(
        emptyAwards(
          season,
          scope,
        ),
      );
    }


    const [
      {
        data:
          teams,
        error:
          teamsError,
      },

      {
        data:
          slates,
        error:
          slatesError,
      },

      {
        data:
          players,
        error:
          playersError,
      },
    ] =
      await Promise.all([
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

        supabaseAdmin
          .from(
            "slates",
          )
          .select(
            "id, start_date, league_id",
          )
          .eq(
            "league_id",
            scope.leagueId,
          ),

        supabaseAdmin
          .from(
            "players",
          )
          .select(
            "id, name, position_group, nba_player_id",
          ),
      ]);


    if (
      teamsError ||
      slatesError ||
      playersError
    ) {
      return NextResponse.json(
        {
          error:
            teamsError?.message ||
            slatesError?.message ||
            playersError?.message ||
            "Failed to load Season Awards foundation.",
        },
        {
          status: 500,
        },
      );
    }


    const seasonSlates =
      (
        slates ??
        []
      )
        .filter(
          (slate) =>
            getSeasonFromDate(
              slate.start_date,
            ) ===
            season,
        )
        .sort(
          (
            a,
            b,
          ) =>
            String(
              a.start_date,
            ).localeCompare(
              String(
                b.start_date,
              ),
            ),
        );


    const seasonSlateIds =
      seasonSlates.map(
        (slate) =>
          Number(
            slate.id,
          ),
      );


    if (
      seasonSlateIds.length ===
      0
    ) {
      return NextResponse.json(
        emptyAwards(
          season,
          scope,
        ),
      );
    }


    const [
      {
        data:
          results,
        error:
          resultsError,
      },

      {
        data:
          lineups,
        error:
          lineupsError,
      },

      {
        data:
          stats,
        error:
          statsError,
      },
    ] =
      await Promise.all([
        supabaseAdmin
          .from(
            "team_slate_results",
          )
          .select(
            "slate_id, team_id, fantasy_points, finish_position",
          )
          .in(
            "slate_id",
            seasonSlateIds,
          ),

        supabaseAdmin
          .from(
            "lineups",
          )
          .select(
            "id, slate_id, team_id",
          )
          .in(
            "slate_id",
            seasonSlateIds,
          ),

        supabaseAdmin
          .from(
            "player_slate_stats",
          )
          .select(
            "slate_id, player_id, fantasy_points, steals, blocks",
          )
          .in(
            "slate_id",
            seasonSlateIds,
          ),
      ]);


    if (
      resultsError ||
      lineupsError ||
      statsError
    ) {
      return NextResponse.json(
        {
          error:
            resultsError?.message ||
            lineupsError?.message ||
            statsError?.message ||
            "Failed to load Season Awards data.",
        },
        {
          status: 500,
        },
      );
    }


    const lineupIds =
      (
        lineups ??
        []
      ).map(
        (lineup) =>
          Number(
            lineup.id,
          ),
      );


    const {
      data:
        lineupPlayers,
      error:
        lineupPlayersError,
    } =
      lineupIds.length > 0
        ? await supabaseAdmin
            .from(
              "lineup_players",
            )
            .select(
              "lineup_id, player_id",
            )
            .in(
              "lineup_id",
              lineupIds,
            )
        : {
            data: [],
            error: null,
          };


    if (
      lineupPlayersError
    ) {
      return NextResponse.json(
        {
          error:
            lineupPlayersError.message,
        },
        {
          status: 500,
        },
      );
    }


    const activeTeamIds =
      new Set(
        (
          teams ??
          []
        ).map(
          (team) =>
            Number(
              team.id,
            ),
        ),
      );


    const teamName =
      new Map(
        (
          teams ??
          []
        ).map(
          (team) => [
            Number(
              team.id,
            ),
            team.name,
          ],
        ),
      );


    const playerMap =
      new Map<
        number,
        PlayerRow
      >(
        (
          (
            players ??
            []
          ) as PlayerRow[]
        ).map(
          (player) => [
            Number(
              player.id,
            ),
            player,
          ],
        ),
      );


    const safeResults =
      (
        results ??
        []
      ).filter(
        (result) =>
          activeTeamIds.has(
            Number(
              result.team_id,
            ),
          ),
      );


    const safeLineups =
      (
        lineups ??
        []
      ).filter(
        (lineup) =>
          activeTeamIds.has(
            Number(
              lineup.team_id,
            ),
          ),
      );


    const teamAgg =
      new Map<
        number,
        {
          finishes:
            number[];
          wins:
            number;
        }
      >();


    for (
      const result
      of safeResults
    ) {
      if (
        (
          result.fantasy_points ??
          0
        ) <= 0 ||
        !result.finish_position
      ) {
        continue;
      }


      const teamId =
        Number(
          result.team_id,
        );


      const current =
        teamAgg.get(
          teamId,
        ) ?? {
          finishes: [],
          wins: 0,
        };


      current.finishes.push(
        Number(
          result.finish_position,
        ),
      );


      if (
        result.finish_position ===
        1
      ) {
        current.wins +=
          1;
      }


      teamAgg.set(
        teamId,
        current,
      );
    }


    const teamRows =
      [
        ...teamAgg.entries(),
      ]
        .map(
          (
            [
              teamId,
              row,
            ],
          ) => ({
            teamId,

            name:
              teamName.get(
                teamId,
              ) ??
              `Team ${teamId}`,

            wins:
              row.wins,

            avgFinish:
              row.finishes.length
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
                    2,
                  )
                : null,
          }),
        );


    const champion =
      [...teamRows]
        .sort(
          (
            a,
            b,
          ) =>
            b.wins -
              a.wins ||
            Number(
              a.avgFinish ??
                999,
            ) -
              Number(
                b.avgFinish ??
                  999,
              ),
        )[0];


    const survivor =
      [...teamRows]
        .filter(
          (row) =>
            row.avgFinish !==
            null,
        )
        .sort(
          (
            a,
            b,
          ) =>
            Number(
              a.avgFinish,
            ) -
            Number(
              b.avgFinish,
            ),
        )[0];


    const lineupById =
      new Map(
        safeLineups.map(
          (lineup) => [
            Number(
              lineup.id,
            ),
            lineup,
          ],
        ),
      );


    const statMap =
      new Map(
        (
          stats ??
          []
        ).map(
          (stat) => [
            `${stat.slate_id}:${stat.player_id}`,
            stat,
          ],
        ),
      );


    const playerAgg =
      new Map<
        number,
        {
          playerId:
            number;

          name:
            string;

          positionGroup:
            | "G"
            | "F/C"
            | null;

          nbaPlayerId:
            number | null;

          games:
            number;

          totalFantasy:
            number;

          steals:
            number;

          blocks:
            number;
        }
      >();


    const teamDefenseAgg =
      new Map<
        number,
        {
          slateIds:
            Set<number>;

          steals:
            number;

          blocks:
            number;
        }
      >();


    for (
      const lineupPlayer
      of lineupPlayers ??
        []
    ) {
      const lineup =
        lineupById.get(
          Number(
            lineupPlayer.lineup_id,
          ),
        );


      if (!lineup) {
        continue;
      }


      const stat =
        statMap.get(
          `${lineup.slate_id}:${lineupPlayer.player_id}`,
        );


      if (!stat) {
        continue;
      }


      const player =
        playerMap.get(
          Number(
            lineupPlayer.player_id,
          ),
        );


      if (!player) {
        continue;
      }


      const fantasy =
        Number(
          stat.fantasy_points ??
            0,
        );

      const steals =
        Number(
          stat.steals ??
            0,
        );

      const blocks =
        Number(
          stat.blocks ??
            0,
        );


      if (
        fantasy > 0
      ) {
        const current =
          playerAgg.get(
            player.id,
          ) ?? {
            playerId:
              player.id,

            name:
              player.name,

            positionGroup:
              player.position_group,

            nbaPlayerId:
              player.nba_player_id,

            games: 0,

            totalFantasy:
              0,

            steals: 0,

            blocks: 0,
          };


        current.games +=
          1;

        current.totalFantasy +=
          fantasy;

        current.steals +=
          steals;

        current.blocks +=
          blocks;


        playerAgg.set(
          player.id,
          current,
        );
      }


      const teamId =
        Number(
          lineup.team_id,
        );


      const teamCurrent =
        teamDefenseAgg.get(
          teamId,
        ) ?? {
          slateIds:
            new Set<number>(),

          steals: 0,

          blocks: 0,
        };


      teamCurrent.slateIds.add(
        Number(
          lineup.slate_id,
        ),
      );

      teamCurrent.steals +=
        steals;

      teamCurrent.blocks +=
        blocks;


      teamDefenseAgg.set(
        teamId,
        teamCurrent,
      );
    }


    const playerRows =
      [
        ...playerAgg.values(),
      ].map(
        (player) => ({
          ...player,

          avgFantasy:
            roundTo(
              player.totalFantasy /
                player.games,
              1,
            ),

          stocks:
            player.steals +
            player.blocks,
        }),
      );


    const teamDefenseRows =
      [
        ...teamDefenseAgg.entries(),
      ]
        .map(
          (
            [
              teamId,
              row,
            ],
          ) => {
            const slateCount =
              row.slateIds
                .size ||
              1;

            return {
              teamId,

              name:
                teamName.get(
                  teamId,
                ) ??
                `Team ${teamId}`,

              avgStocks:
                roundTo(
                  (
                    row.steals +
                    row.blocks
                  ) /
                    slateCount,
                  1,
                ),

              totalStocks:
                row.steals +
                row.blocks,
            };
          },
        )
        .sort(
          (
            a,
            b,
          ) =>
            b.avgStocks -
            a.avgStocks,
        );


    const dpoyTeam =
      teamDefenseRows[0];


    const eligible =
      playerRows.filter(
        (player) =>
          player.games >= 5,
      );


    const guards =
      eligible
        .filter(
          (player) =>
            player.positionGroup ===
            "G",
        )
        .sort(
          (
            a,
            b,
          ) =>
            b.avgFantasy -
            a.avgFantasy,
        )
        .slice(
          0,
          2,
        );


    const frontcourt =
      eligible
        .filter(
          (player) =>
            player.positionGroup ===
            "F/C",
        )
        .sort(
          (
            a,
            b,
          ) =>
            b.avgFantasy -
            a.avgFantasy,
        )
        .slice(
          0,
          3,
        );


    const latestSlate =
      seasonSlates[
        seasonSlates.length -
          1
      ];


    const lastLaughResult =
      latestSlate
        ? safeResults.find(
            (result) =>
              Number(
                result.slate_id,
              ) ===
                Number(
                  latestSlate.id,
                ) &&
              result.finish_position ===
                1,
          )
        : null;


    const lastLaughName =
      lastLaughResult
        ? teamName.get(
            Number(
              lastLaughResult.team_id,
            ),
          ) ??
          null
        : null;


    const awards = [
      champion
        ? {
            title:
              "Championship Belt",

            emoji:
              "🏆",

            winner:
              champion.name,

            detail:
              `${season} season champion`,
          }
        : null,

      survivor
        ? {
            title:
              "Consistency King",

            emoji:
              "👑",

            winner:
              survivor.name,

            detail:
              `Best average finish: ${survivor.avgFinish}`,
          }
        : null,

      dpoyTeam
        ? {
            title:
              "DPOY",

            emoji:
              "🛡️",

            winner:
              dpoyTeam.name,

            detail:
              `League-best ${dpoyTeam.avgStocks} steals + blocks per slate`,
          }
        : null,

      lastLaughName
        ? {
            title:
              "Last Laugh Award",

            emoji:
              "😂",

            winner:
              lastLaughName,

            detail:
              "Winner of the final slate",
          }
        : null,
    ].filter(
      (
        award,
      ): award is {
        title: string;
        emoji: string;
        winner: string;
        detail: string;
      } =>
        award !==
        null,
    );


    return NextResponse.json({
      success: true,
      season,
      scope,
      awards,

      firstTeam: {
        guards,
        frontcourt,
      },
    });
  } catch (
    error
  ) {
    console.error(
      error,
    );

    return NextResponse.json(
      {
        error:
          "Unexpected server error while loading season awards.",
      },
      {
        status: 500,
      },
    );
  }
}
