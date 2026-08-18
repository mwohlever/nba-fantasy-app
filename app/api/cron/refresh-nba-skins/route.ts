import {
  NextResponse,
} from "next/server";

import {
  supabaseAdmin,
} from "@/lib/supabaseAdmin";

import {
  fetchNbaSkinsSeasonProjections,
  fetchNbaSkinsSeasonRecords,
} from "@/lib/providers/nbaSkinsRecords.mjs";


export const runtime =
  "nodejs";

export const dynamic =
  "force-dynamic";

export const maxDuration =
  60;


type SeasonRow = {
  id: number;
  season: number;
  status:
    | "open"
    | "locked"
    | "final";
};


type PickRow = {
  id: number;
  nba_team_abbreviation: string;
  pick_type:
    | "wins"
    | "losses";
};


function authorized(
  request: Request,
) {
  const secret =
    process.env
      .GOLF_CRON_SECRET
      ?.trim();

  if (!secret) {
    return false;
  }

  return (
    request.headers.get(
      "authorization",
    ) ===
    `Bearer ${secret}`
  );
}


async function findRefreshSeason() {
  const {
    data: seasonsRaw,
    error: seasonsError,
  } =
    await supabaseAdmin
      .from(
        "nba_skins_seasons",
      )
      .select(
        "id, season, status",
      )
      .neq(
        "status",
        "final",
      )
      .order(
        "season",
        {
          ascending: false,
        },
      );

  if (seasonsError) {
    throw new Error(
      seasonsError.message,
    );
  }

  const seasons =
    (
      seasonsRaw ??
      []
    ) as unknown as
      SeasonRow[];


  /*
   * A Skins season should not begin live record maintenance
   * merely because its season row exists.
   *
   * The annual draft is authoritative. Only a complete
   * 28-pick draft activates the season.
   */
  for (
    const season
    of seasons
  ) {
    const {
      count,
      error,
    } =
      await supabaseAdmin
        .from(
          "nba_skins_picks",
        )
        .select(
          "id",
          {
            count:
              "exact",
            head:
              true,
          },
        )
        .eq(
          "season_id",
          season.id,
        );

    if (error) {
      throw new Error(
        error.message,
      );
    }

    if (count === 28) {
      return season;
    }
  }

  return null;
}


export async function GET(
  request: Request,
) {
  if (
    !authorized(
      request,
    )
  ) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Unauthorized.",
      },
      {
        status: 401,
      },
    );
  }


  try {
    const season =
      await findRefreshSeason();


    if (!season) {
      return NextResponse.json({
        success: true,
        skipped: true,
        reason:
          "No non-final NBA Skins season has a complete 28-pick draft.",
      });
    }


    let recordResult:
      Awaited<
        ReturnType<
          typeof fetchNbaSkinsSeasonRecords
        >
      >;


    try {
      recordResult =
        await fetchNbaSkinsSeasonRecords(
          season.season,
        );
    } catch (error) {
      /*
       * Before ESPN publishes the upcoming season's full
       * standings payload, the existing provider can correctly
       * reject it for not containing all 30 teams.
       *
       * That is an offseason/preseason skip, not something that
       * should make the entire app heartbeat fail.
       */
      const message =
        error instanceof Error
          ? error.message
          : "Unable to load ESPN NBA standings.";

      if (
        message.includes(
          "Expected 30 NBA teams",
        )
      ) {
        return NextResponse.json({
          success: true,
          skipped: true,
          season:
            season.season,
          reason:
            message,
        });
      }

      throw error;
    }


    const {
      espnSeason,
      records,
    } =
      recordResult;


    /*
     * Projection trouble must never prevent actual NBA
     * records / Skins points from refreshing.
     *
     * ESPN may not publish BPI projections immediately
     * before a season begins, and its page shape may
     * occasionally change independently of standings.
     */
    let projectionResult:
      Awaited<
        ReturnType<
          typeof fetchNbaSkinsSeasonProjections
        >
      > | null =
      null;

    let projectionError:
      string | null =
      null;


    try {
      projectionResult =
        await fetchNbaSkinsSeasonProjections(
          season.season,
        );
    } catch (error) {
      projectionError =
        error instanceof Error
          ? error.message
          : "Unable to load ESPN BPI projections.";

      console.warn(
        "NBA Skins BPI projection refresh skipped:",
        projectionError,
      );
    }


    const now =
      new Date()
        .toISOString();


    const projectionByTeam =
      new Map(
        (
          projectionResult
            ?.projections ??
          []
        ).map(
          (projection) => [
            projection.abbreviation,
            projection,
          ],
        ),
      );


    const teamRows =
      records.map(
        (record) => {
          const projection =
            projectionByTeam.get(
              record.abbreviation,
            );

          return {
            season_id:
              season.id,

            nba_team_abbreviation:
              record.abbreviation,

            wins:
              record.wins,

            losses:
              record.losses,

            games_played:
              record.gamesPlayed,

            source_updated_at:
              now,

            updated_at:
              now,

            /*
             * Only write projection fields when ESPN BPI
             * returned a complete, validated 30-team set.
             *
             * If projections are unavailable, omission keeps
             * the last known valid projections untouched.
             */
            ...(projection
              ? {
                  projected_wins:
                    projection.projectedWins,

                  projected_losses:
                    projection.projectedLosses,

                  projection_source:
                    projectionResult?.source ??
                    "ESPN BPI",
                }
              : {}),
          };
        },
      );


    const {
      error: recordsError,
    } =
      await supabaseAdmin
        .from(
          "nba_skins_team_records",
        )
        .upsert(
          teamRows,
          {
            onConflict:
              "season_id,nba_team_abbreviation",
          },
        );


    if (recordsError) {
      throw new Error(
        `Failed to save NBA Skins records: ${recordsError.message}`,
      );
    }


    /*
     * Keep NBA team identity metadata synchronized from the
     * same authoritative ESPN response.
     */
    await Promise.all(
      records.map(
        async (
          record,
        ) => {
          const {
            error,
          } =
            await supabaseAdmin
              .from(
                "nba_skins_nba_teams",
              )
              .update({
                display_name:
                  record.displayName,

                espn_team_id:
                  record.espnTeamId,

                updated_at:
                  now,
              })
              .eq(
                "abbreviation",
                record.abbreviation,
              );

          if (error) {
            throw new Error(
              `Failed updating ${record.abbreviation}: ${error.message}`,
            );
          }
        },
      ),
    );


    const {
      data: picksRaw,
      error: picksError,
    } =
      await supabaseAdmin
        .from(
          "nba_skins_picks",
        )
        .select(
          "id, nba_team_abbreviation, pick_type",
        )
        .eq(
          "season_id",
          season.id,
        );


    if (picksError) {
      throw new Error(
        picksError.message,
      );
    }


    const picks =
      (
        picksRaw ??
        []
      ) as unknown as
        PickRow[];


    const recordByTeam =
      new Map(
        records.map(
          (record) => [
            record.abbreviation,
            record,
          ],
        ),
      );


    /*
     * final_points doubles as the persisted current score while
     * a season is live. On finalization it naturally becomes
     * the final score without a different data path.
     */
    await Promise.all(
      picks.map(
        async (
          pick,
        ) => {
          const record =
            recordByTeam.get(
              pick.nba_team_abbreviation,
            );

          if (!record) {
            throw new Error(
              `No ESPN NBA record found for ${pick.nba_team_abbreviation}.`,
            );
          }

          const points =
            pick.pick_type ===
            "losses"
              ? record.losses
              : record.wins;

          const {
            error,
          } =
            await supabaseAdmin
              .from(
                "nba_skins_picks",
              )
              .update({
                final_points:
                  points,

                updated_at:
                  now,
              })
              .eq(
                "id",
                pick.id,
              );

          if (error) {
            throw new Error(
              `Failed updating NBA Skins pick ${pick.id}: ${error.message}`,
            );
          }
        },
      ),
    );


    return NextResponse.json({
      success: true,
      skipped: false,

      skinsSeason:
        season.season,

      espnSeason,

      teamsUpdated:
        records.length,

      picksUpdated:
        picks.length,

      projectionsUpdated:
        projectionResult
          ?.projections.length ??
        0,

      projectionSource:
        projectionResult
          ?.source ??
        null,

      projectionSkipped:
        projectionResult ===
        null,

      projectionError,

      refreshedAt:
        now,
    });
  } catch (error) {
    console.error(
      "NBA Skins automatic refresh failed:",
      error,
    );

    return NextResponse.json(
      {
        success: false,

        error:
          error instanceof Error
            ? error.message
            : "Unexpected NBA Skins refresh failure.",
      },
      {
        status: 500,
      },
    );
  }
}
