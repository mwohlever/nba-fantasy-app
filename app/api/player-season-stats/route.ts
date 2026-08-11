import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  supabaseAdmin,
} from "@/lib/supabaseAdmin";

export const dynamic =
  "force-dynamic";

type Sport =
  | "nba"
  | "nfl"
  | "golf";

type NbaSeasonAverageRow = {
  season: string;
  nba_player_id: number;
  player_name: string;

  games_played:
    number | null;

  points:
    number | null;

  rebounds:
    number | null;

  assists:
    number | null;

  steals:
    number | null;

  blocks:
    number | null;

  turnovers:
    number | null;

  fantasy_points:
    number | null;
};

type LocalPlayerRow = {
  id: number;
  name: string;

  nba_player_id:
    number | null;

  position_group:
    string | null;

  team_abbreviation:
    string | null;

  is_active:
    boolean | null;
};

type NflSeasonStatRow = {
  season: number;
  nfl_player_id: number;
  player_name: string;

  position:
    string | null;

  team_abbreviation:
    string | null;

  games_played:
    number | null;

  passing_yards:
    number | null;

  passing_tds:
    number | null;

  passing_ints:
    number | null;

  rushing_yards:
    number | null;

  rushing_tds:
    number | null;

  receiving_targets:
    number | null;

  receptions:
    number | null;

  receiving_yards:
    number | null;

  receiving_tds:
    number | null;

  fumbles_lost:
    number | null;

  fantasy_points:
    number | null;

  passing_yards_per_game:
    number | null;

  passing_tds_per_game:
    number | null;

  passing_ints_per_game:
    number | null;

  rushing_yards_per_game:
    number | null;

  rushing_tds_per_game:
    number | null;

  receiving_targets_per_game:
    number | null;

  receptions_per_game:
    number | null;

  receiving_yards_per_game:
    number | null;

  receiving_tds_per_game:
    number | null;

  fumbles_lost_per_game:
    number | null;

  fantasy_points_per_game:
    number | null;
};

type LocalNflPlayerRow = {
  id: number;
  name: string;

  nfl_player_id:
    number | null;

  position:
    string | null;

  team_abbreviation:
    string | null;
};

function noStoreHeaders() {
  return {
    "Cache-Control":
      "no-store, max-age=0",
  };
}

function getNbaSeason(
  appSeason:
    number,
) {
  return (
    `${appSeason - 1}-` +
    `${String(appSeason).slice(-2)}`
  );
}

/*
 * 111 Sports season 2026 corresponds to
 * the 2025 NFL regular season.
 */
function getNflSeason(
  appSeason:
    number,
) {
  return (
    appSeason - 1
  );
}

function round1(
  value:
    unknown,
) {
  const numeric =
    Number(value);

  if (
    !Number.isFinite(
      numeric,
    )
  ) {
    return null;
  }

  return (
    Math.round(
      numeric * 10,
    ) / 10
  );
}

function round2(
  value:
    unknown,
) {
  const numeric =
    Number(value);

  if (
    !Number.isFinite(
      numeric,
    )
  ) {
    return null;
  }

  return (
    Math.round(
      numeric * 100,
    ) / 100
  );
}

function calculateNbaFantasyPoints(
  row:
    NbaSeasonAverageRow,
) {
  const points =
    Number(
      row.points ?? 0,
    );

  const rebounds =
    Number(
      row.rebounds ?? 0,
    );

  const assists =
    Number(
      row.assists ?? 0,
    );

  const steals =
    Number(
      row.steals ?? 0,
    );

  const blocks =
    Number(
      row.blocks ?? 0,
    );

  const turnovers =
    Number(
      row.turnovers ?? 0,
    );

  return round1(
    points +
      rebounds * 1.2 +
      assists * 1.5 +
      steals * 2 +
      blocks * 2 -
      turnovers,
  );
}

function calculateNflFantasyPoints({
  passingYards,
  passingTds,
  passingInts,
  rushingYards,
  rushingTds,
  receivingYards,
  receivingTds,
  receptions,
  fumblesLost,
}: {
  passingYards:
    number;

  passingTds:
    number;

  passingInts:
    number;

  rushingYards:
    number;

  rushingTds:
    number;

  receivingYards:
    number;

  receivingTds:
    number;

  receptions:
    number;

  fumblesLost:
    number;
}) {
  return (
    passingYards /
      25 +
    passingTds *
      4 -
    passingInts *
      2 +
    rushingYards /
      10 +
    rushingTds *
      6 +
    receivingYards /
      10 +
    receivingTds *
      6 +
    receptions -
    fumblesLost *
      2
  );
}

export async function GET(
  request:
    NextRequest,
) {
  try {
    const sportParam =
      request.nextUrl
        .searchParams
        .get(
          "sport",
        );

    const seasonParam =
      request.nextUrl
        .searchParams
        .get(
          "season",
        );

    const sport:
      Sport =
      sportParam ===
      "nfl"
        ? "nfl"
        : sportParam ===
            "golf"
          ? "golf"
          : "nba";

    if (
      seasonParam ===
      "all"
    ) {
      return NextResponse.json(
        {
          success:
            true,

          mode:
            "season_stats",

          sport,

          season:
            "all",

          available:
            false,

          playerStats:
            [],

          message:
            "Choose a specific season to view professional season statistics.",
        },
        {
          headers:
            noStoreHeaders(),
        },
      );
    }

    const parsedSeason =
      Number(
        seasonParam ??
          2026,
      );

    const season =
      Number.isFinite(
        parsedSeason,
      )
        ? parsedSeason
        : 2026;

    /*
     * ==================================================
     * NBA
     * ==================================================
     */
    if (
      sport ===
      "nba"
    ) {
      const nbaSeason =
        getNbaSeason(
          season,
        );

      const [
        seasonStatsResult,
        playersResult,
      ] =
        await Promise.all([
          supabaseAdmin
            .from(
              "player_nba_season_averages",
            )
            .select(
              `
              season,
              nba_player_id,
              player_name,
              games_played,
              points,
              rebounds,
              assists,
              steals,
              blocks,
              turnovers,
              fantasy_points
            `,
            )
            .eq(
              "season",
              nbaSeason,
            )
            .order(
              "fantasy_points",
              {
                ascending:
                  false,
              },
            )
            .range(
              0,
              5000,
            ),

          supabaseAdmin
            .from(
              "players",
            )
            .select(
              `
              id,
              name,
              nba_player_id,
              position_group,
              team_abbreviation,
              is_active
            `,
            )
            .not(
              "nba_player_id",
              "is",
              null,
            )
            .range(
              0,
              5000,
            ),
        ]);

      if (
        seasonStatsResult.error
      ) {
        return NextResponse.json(
          {
            error:
              `Failed to load NBA season statistics: ${seasonStatsResult.error.message}`,
          },
          {
            status:
              500,

            headers:
              noStoreHeaders(),
          },
        );
      }

      if (
        playersResult.error
      ) {
        return NextResponse.json(
          {
            error:
              `Failed to load NBA player identities: ${playersResult.error.message}`,
          },
          {
            status:
              500,

            headers:
              noStoreHeaders(),
          },
        );
      }

      const seasonRows =
        (
          seasonStatsResult.data ??
          []
        ) as
          NbaSeasonAverageRow[];

      const localPlayers =
        (
          playersResult.data ??
          []
        ) as
          LocalPlayerRow[];

      const localPlayerByNbaId =
        new Map<
          number,
          LocalPlayerRow
        >();

      for (
        const player
        of localPlayers
      ) {
        if (
          player.nba_player_id ===
            null ||
          player.nba_player_id ===
            undefined
        ) {
          continue;
        }

        localPlayerByNbaId.set(
          Number(
            player.nba_player_id,
          ),
          player,
        );
      }

      const playerStats =
        seasonRows.map(
          (
            row,
          ) => {
            const nbaPlayerId =
              Number(
                row.nba_player_id,
              );

            const localPlayer =
              localPlayerByNbaId.get(
                nbaPlayerId,
              ) ??
              null;

            const playerId =
              localPlayer?.id ??
              nbaPlayerId;

            const calculatedFantasyPoints =
              calculateNbaFantasyPoints(
                row,
              );

            return {
              player_id:
                playerId,

              player_name:
                row.player_name,

              nba_player_id:
                nbaPlayerId,

              position_group:
                localPlayer
                  ?.position_group ??
                null,

              team_abbreviation:
                localPlayer
                  ?.team_abbreviation ??
                null,

              is_active:
                localPlayer
                  ?.is_active ??
                null,

              games_played:
                row.games_played ??
                null,

              points:
                round1(
                  row.points,
                ),

              rebounds:
                round1(
                  row.rebounds,
                ),

              assists:
                round1(
                  row.assists,
                ),

              steals:
                round1(
                  row.steals,
                ),

              blocks:
                round1(
                  row.blocks,
                ),

              turnovers:
                round1(
                  row.turnovers,
                ),

              fantasy_points:
                calculatedFantasyPoints,

              source_fantasy_points:
                round1(
                  row.fantasy_points,
                ),
            };
          },
        );

      return NextResponse.json(
        {
          success:
            true,

          mode:
            "season_stats",

          sport:
            "nba",

          season,

          professionalSeason:
            nbaSeason,

          available:
            true,

          playerCount:
            playerStats.length,

          playerStats,
        },
        {
          headers:
            noStoreHeaders(),
        },
      );
    }

    /*
     * ==================================================
     * NFL
     * ==================================================
     */
    if (
      sport ===
      "nfl"
    ) {
      const nflSeason =
        getNflSeason(
          season,
        );

      const [
        seasonStatsResult,
        playersResult,
      ] =
        await Promise.all([
          supabaseAdmin
            .from(
              "player_nfl_season_stats",
            )
            .select(
              `
              season,
              nfl_player_id,
              player_name,
              position,
              team_abbreviation,
              games_played,
              passing_yards,
              passing_tds,
              passing_ints,
              rushing_yards,
              rushing_tds,
              receiving_targets,
              receptions,
              receiving_yards,
              receiving_tds,
              fumbles_lost,
              fantasy_points,
              passing_yards_per_game,
              passing_tds_per_game,
              passing_ints_per_game,
              rushing_yards_per_game,
              rushing_tds_per_game,
              receiving_targets_per_game,
              receptions_per_game,
              receiving_yards_per_game,
              receiving_tds_per_game,
              fumbles_lost_per_game,
              fantasy_points_per_game
            `,
            )
            .eq(
              "season",
              nflSeason,
            )
            .order(
              "fantasy_points_per_game",
              {
                ascending:
                  false,
              },
            )
            .range(
              0,
              5000,
            ),

          supabaseAdmin
            .from(
              "players_nfl",
            )
            .select(
              `
              id,
              name,
              nfl_player_id,
              position,
              team_abbreviation
            `,
            )
            .not(
              "nfl_player_id",
              "is",
              null,
            )
            .range(
              0,
              5000,
            ),
        ]);

      if (
        seasonStatsResult.error
      ) {
        return NextResponse.json(
          {
            error:
              `Failed to load NFL season statistics: ${seasonStatsResult.error.message}`,
          },
          {
            status:
              500,

            headers:
              noStoreHeaders(),
          },
        );
      }

      if (
        playersResult.error
      ) {
        return NextResponse.json(
          {
            error:
              `Failed to load NFL player identities: ${playersResult.error.message}`,
          },
          {
            status:
              500,

            headers:
              noStoreHeaders(),
          },
        );
      }

      const seasonRows =
        (
          seasonStatsResult.data ??
          []
        ) as
          NflSeasonStatRow[];

      const localPlayers =
        (
          playersResult.data ??
          []
        ) as
          LocalNflPlayerRow[];

      const localPlayerByNflId =
        new Map<
          number,
          LocalNflPlayerRow
        >();

      for (
        const player
        of localPlayers
      ) {
        if (
          player.nfl_player_id ===
            null ||
          player.nfl_player_id ===
            undefined
        ) {
          continue;
        }

        localPlayerByNflId.set(
          Number(
            player.nfl_player_id,
          ),
          player,
        );
      }

      const playerStats =
        seasonRows.map(
          (
            row,
          ) => {
            const nflPlayerId =
              Number(
                row.nfl_player_id,
              );

            const localPlayer =
              localPlayerByNflId.get(
                nflPlayerId,
              ) ??
              null;

            const playerId =
              localPlayer?.id ??
              nflPlayerId;

            const passingYardsPerGame =
              Number(
                row.passing_yards_per_game ??
                  0,
              );

            const passingTdsPerGame =
              Number(
                row.passing_tds_per_game ??
                  0,
              );

            const passingIntsPerGame =
              Number(
                row.passing_ints_per_game ??
                  0,
              );

            const rushingYardsPerGame =
              Number(
                row.rushing_yards_per_game ??
                  0,
              );

            const rushingTdsPerGame =
              Number(
                row.rushing_tds_per_game ??
                  0,
              );

            const receivingYardsPerGame =
              Number(
                row.receiving_yards_per_game ??
                  0,
              );

            const receivingTdsPerGame =
              Number(
                row.receiving_tds_per_game ??
                  0,
              );

            const receptionsPerGame =
              Number(
                row.receptions_per_game ??
                  0,
              );

            const fumblesLostPerGame =
              Number(
                row.fumbles_lost_per_game ??
                  0,
              );

            /*
             * Recalculate FP/G from the component stats
             * so the endpoint always follows 111 scoring.
             */
            const calculatedFantasyPointsPerGame =
              calculateNflFantasyPoints(
                {
                  passingYards:
                    passingYardsPerGame,

                  passingTds:
                    passingTdsPerGame,

                  passingInts:
                    passingIntsPerGame,

                  rushingYards:
                    rushingYardsPerGame,

                  rushingTds:
                    rushingTdsPerGame,

                  receivingYards:
                    receivingYardsPerGame,

                  receivingTds:
                    receivingTdsPerGame,

                  receptions:
                    receptionsPerGame,

                  fumblesLost:
                    fumblesLostPerGame,
                },
              );

            return {
              player_id:
                playerId,

              player_name:
                row.player_name,

              nfl_player_id:
                nflPlayerId,

              position:
                localPlayer?.position ??
                row.position ??
                null,

              position_group:
                localPlayer?.position ??
                row.position ??
                null,

              team_abbreviation:
                localPlayer
                  ?.team_abbreviation ??
                row.team_abbreviation ??
                null,

              games_played:
                Number(
                  row.games_played ??
                    0,
                ),

              /*
               * Season totals
               */
              passing_yards:
                round1(
                  row.passing_yards,
                ),

              passing_tds:
                round1(
                  row.passing_tds,
                ),

              passing_ints:
                round1(
                  row.passing_ints,
                ),

              rushing_yards:
                round1(
                  row.rushing_yards,
                ),

              rushing_tds:
                round1(
                  row.rushing_tds,
                ),

              receiving_targets:
                round1(
                  row.receiving_targets,
                ),

              receptions:
                round1(
                  row.receptions,
                ),

              receiving_yards:
                round1(
                  row.receiving_yards,
                ),

              receiving_tds:
                round1(
                  row.receiving_tds,
                ),

              fumbles_lost:
                round1(
                  row.fumbles_lost,
                ),

              fantasy_points:
                round1(
                  row.fantasy_points,
                ),

              /*
               * Per-game research stats.
               */
              passing_yards_per_game:
                round2(
                  row.passing_yards_per_game,
                ),

              passing_tds_per_game:
                round2(
                  row.passing_tds_per_game,
                ),

              passing_ints_per_game:
                round2(
                  row.passing_ints_per_game,
                ),

              rushing_yards_per_game:
                round2(
                  row.rushing_yards_per_game,
                ),

              rushing_tds_per_game:
                round2(
                  row.rushing_tds_per_game,
                ),

              receiving_targets_per_game:
                round2(
                  row.receiving_targets_per_game,
                ),

              receptions_per_game:
                round2(
                  row.receptions_per_game,
                ),

              receiving_yards_per_game:
                round2(
                  row.receiving_yards_per_game,
                ),

              receiving_tds_per_game:
                round2(
                  row.receiving_tds_per_game,
                ),

              fumbles_lost_per_game:
                round2(
                  row.fumbles_lost_per_game,
                ),

              fantasy_points_per_game:
                round2(
                  calculatedFantasyPointsPerGame,
                ),

              source_fantasy_points_per_game:
                round2(
                  row.fantasy_points_per_game,
                ),
            };
          },
        );

      return NextResponse.json(
        {
          success:
            true,

          mode:
            "season_stats",

          sport:
            "nfl",

          season,

          professionalSeason:
            nflSeason,

          available:
            true,

          playerCount:
            playerStats.length,

          playerStats,
        },
        {
          headers:
            noStoreHeaders(),
        },
      );
    }

    /*
     * ==================================================
     * GOLF
     * ==================================================
     */
    const [
      golfStatsResult,
      golfPlayersResult,
    ] =
      await Promise.all([
        supabaseAdmin
          .from(
            "player_golf_season_stats",
          )
          .select(
            `
            season,
            player_id,
            espn_player_id,
            player_name,
            tournaments_played,
            rounds_played,
            holes_played,
            cuts_made,
            cuts_made_pct,
            has_detailed_stats,
            wins,
            top_5_finishes,
            top_10_finishes,
            second_place,
            third_place,
            fourth_place,
            fifth_place,
            scoring_average,
            adjusted_scoring_average,
            birdies,
            eagles,
            pars,
            bogeys,
            doubles,
            triple_bogeys_or_worse,
            birdies_per_round,
            birdie_rate,
            eagle_rate,
            bogey_rate,
            greens_in_reg_pct,
            driving_accuracy_pct,
            driving_distance,
            putts_per_gir,
            sand_save_pct,
            fedex_cup_points
          `,
          )
          .eq(
            "season",
            season,
          )
          .range(
            0,
            5000,
          ),

        supabaseAdmin
          .from(
            "golf_players",
          )
          .select(
            `
            id,
            display_name,
            espn_player_id,
            headshot_url,
            country,
            owgr_rank
          `,
          )
          .range(
            0,
            5000,
          ),
      ]);

    if (
      golfStatsResult.error
    ) {
      return NextResponse.json(
        {
          error:
            `Failed to load Golf season statistics: ${golfStatsResult.error.message}`,
        },
        {
          status:
            500,

          headers:
            noStoreHeaders(),
        },
      );
    }

    if (
      golfPlayersResult.error
    ) {
      return NextResponse.json(
        {
          error:
            `Failed to load Golf player identities: ${golfPlayersResult.error.message}`,
        },
        {
          status:
            500,

          headers:
            noStoreHeaders(),
        },
      );
    }

    const golfPlayerById =
      new Map<
        number,
        any
      >();

    for (
      const player
      of golfPlayersResult.data ??
        []
    ) {
      golfPlayerById.set(
        Number(
          player.id,
        ),
        player,
      );
    }

    const golfPlayerStats =
      (
        golfStatsResult.data ??
        []
      ).map(
        (
          row:
            any,
        ) => {
          const player =
            golfPlayerById.get(
              Number(
                row.player_id,
              ),
            ) ??
            null;

          return {
            player_id:
              Number(
                row.player_id,
              ),

            player_name:
              String(
                row.player_name ??
                  player?.display_name ??
                  "Unknown Golfer",
              ),

            espn_golf_player_id:
              String(
                row.espn_player_id ??
                  player?.espn_player_id ??
                  "",
              ) ||
              null,

            headshot_url:
              player?.headshot_url ??
              null,

            country:
              player?.country ??
              null,

            owgr_rank:
              player?.owgr_rank ===
                null ||
              player?.owgr_rank ===
                undefined
                ? null
                : Number(
                    player.owgr_rank,
                  ),

            tournaments_played:
              Number(
                row.tournaments_played ??
                  0,
              ),

            rounds_played:
              Number(
                row.rounds_played ??
                  0,
              ),

            holes_played:
              Number(
                row.holes_played ??
                  0,
              ),

            cuts_made:
              Number(
                row.cuts_made ??
                  0,
              ),

            cuts_made_pct:
              row.cuts_made_pct ===
                null ||
              row.cuts_made_pct ===
                undefined
                ? null
                : Number(
                    row.cuts_made_pct,
                  ),

            has_detailed_stats:
              Boolean(
                row.has_detailed_stats,
              ),

            wins:
              Number(
                row.wins ??
                  0,
              ),

            top_5_finishes:
              Number(
                row.top_5_finishes ??
                  0,
              ),

            top_10_finishes:
              Number(
                row.top_10_finishes ??
                  0,
              ),

            scoring_average:
              row.scoring_average ===
                null ||
              row.scoring_average ===
                undefined
                ? null
                : Number(
                    row.scoring_average,
                  ),

            adjusted_scoring_average:
              row.adjusted_scoring_average ===
                null ||
              row.adjusted_scoring_average ===
                undefined
                ? null
                : Number(
                    row.adjusted_scoring_average,
                  ),

            birdies_per_round:
              row.birdies_per_round ===
                null ||
              row.birdies_per_round ===
                undefined
                ? null
                : Number(
                    row.birdies_per_round,
                  ),

            birdie_rate:
              row.birdie_rate ===
                null ||
              row.birdie_rate ===
                undefined
                ? null
                : Number(
                    row.birdie_rate,
                  ),

            bogey_rate:
              row.bogey_rate ===
                null ||
              row.bogey_rate ===
                undefined
                ? null
                : Number(
                    row.bogey_rate,
                  ),

            greens_in_reg_pct:
              row.greens_in_reg_pct ===
                null ||
              row.greens_in_reg_pct ===
                undefined
                ? null
                : Number(
                    row.greens_in_reg_pct,
                  ),

            driving_accuracy_pct:
              row.driving_accuracy_pct ===
                null ||
              row.driving_accuracy_pct ===
                undefined
                ? null
                : Number(
                    row.driving_accuracy_pct,
                  ),

            driving_distance:
              row.driving_distance ===
                null ||
              row.driving_distance ===
                undefined
                ? null
                : Number(
                    row.driving_distance,
                  ),

            putts_per_gir:
              row.putts_per_gir ===
                null ||
              row.putts_per_gir ===
                undefined
                ? null
                : Number(
                    row.putts_per_gir,
                  ),

            sand_save_pct:
              row.sand_save_pct ===
                null ||
              row.sand_save_pct ===
                undefined
                ? null
                : Number(
                    row.sand_save_pct,
                  ),

            fedex_cup_points:
              row.fedex_cup_points ===
                null ||
              row.fedex_cup_points ===
                undefined
                ? null
                : Number(
                    row.fedex_cup_points,
                  ),

            birdies:
              Number(
                row.birdies ??
                  0,
              ),

            eagles:
              Number(
                row.eagles ??
                  0,
              ),

            pars:
              Number(
                row.pars ??
                  0,
              ),

            bogeys:
              Number(
                row.bogeys ??
                  0,
              ),
          };
        },
      )
      .sort(
        (
          a,
          b,
        ) => {
          const aAverage =
            a.scoring_average ??
            999;

          const bAverage =
            b.scoring_average ??
            999;

          if (
            aAverage !==
            bAverage
          ) {
            return (
              aAverage -
              bAverage
            );
          }

          return (
            a.player_name.localeCompare(
              b.player_name,
            )
          );
        },
      );

    return NextResponse.json(
      {
        success:
          true,

        mode:
          "season_stats",

        sport:
          "golf",

        season,

        professionalSeason:
          season,

        available:
          true,

        playerCount:
          golfPlayerStats.length,

        playerStats:
          golfPlayerStats,
      },
      {
        headers:
          noStoreHeaders(),
      },
    );
  } catch (
    error
  ) {
    console.error(
      "Unexpected player season stats error:",
      error,
    );

    return NextResponse.json(
      {
        error:
          "Unexpected server error while loading season statistics.",
      },
      {
        status:
          500,

        headers:
          noStoreHeaders(),
      },
    );
  }
}
