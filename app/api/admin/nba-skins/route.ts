import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  supabaseAdmin,
} from "@/lib/supabaseAdmin";

import {
  requireAdminApi,
} from "@/lib/requireAdminApi";


export const dynamic =
  "force-dynamic";


const OWNER_NAMES =
  [
    "Mark",
    "Josh",
    "Jon",
    "Andy",
  ] as const;


type SeasonStatus =
  | "open"
  | "locked"
  | "final";


type TeamRow = {
  id: number;
  name: string;
};


type SeasonRow = {
  id: number;
  season: number;
  status: SeasonStatus;
  draft_locked_at:
    | string
    | null;
  finalized_at:
    | string
    | null;
  created_at: string;
};


type DraftOrderRow = {
  season_id: number;
  team_id: number;
  draft_position: number;
};


function seasonLabel(
  season: number,
) {
  return `${season}-${String(
    season + 1,
  ).slice(-2)}`;
}


async function loadAdminData() {
  const [
    seasonsResult,
    teamsResult,
    orderResult,
    picksResult,
  ] =
    await Promise.all([
      supabaseAdmin
        .from(
          "nba_skins_seasons",
        )
        .select(
          [
            "id",
            "season",
            "status",
            "draft_locked_at",
            "finalized_at",
            "created_at",
          ].join(","),
        )
        .order(
          "season",
          {
            ascending: false,
          },
        ),

      supabaseAdmin
        .from("teams")
        .select(
          "id, name",
        )
        .in(
          "name",
          [...OWNER_NAMES],
        ),

      supabaseAdmin
        .from(
          "nba_skins_draft_order",
        )
        .select(
          "season_id, team_id, draft_position",
        )
        .order(
          "draft_position",
          {
            ascending: true,
          },
        ),

      supabaseAdmin
        .from(
          "nba_skins_picks",
        )
        .select(
          "season_id, id",
        ),
    ]);


  if (
    seasonsResult.error
  ) {
    throw new Error(
      seasonsResult.error.message,
    );
  }

  if (
    teamsResult.error
  ) {
    throw new Error(
      teamsResult.error.message,
    );
  }

  if (
    orderResult.error
  ) {
    throw new Error(
      orderResult.error.message,
    );
  }

  if (
    picksResult.error
  ) {
    throw new Error(
      picksResult.error.message,
    );
  }


  const seasons =
    (
      seasonsResult.data ??
      []
    ) as unknown as
      SeasonRow[];

  const teams =
    (
      teamsResult.data ??
      []
    ) as unknown as
      TeamRow[];

  const draftOrder =
    (
      orderResult.data ??
      []
    ) as unknown as
      DraftOrderRow[];

  const picks =
    (
      picksResult.data ??
      []
    ) as Array<{
      season_id: number;
      id: number;
    }>;


  const teamNameById =
    new Map(
      teams.map(
        (team) => [
          team.id,
          team.name,
        ],
      ),
    );


  return {
    teams:
      teams
        .sort(
          (a, b) =>
            OWNER_NAMES.indexOf(
              a.name as
                (
                  typeof OWNER_NAMES
                )[number],
            ) -
            OWNER_NAMES.indexOf(
              b.name as
                (
                  typeof OWNER_NAMES
                )[number],
            ),
        ),

    seasons:
      seasons.map(
        (season) => {
          const order =
            draftOrder
              .filter(
                (row) =>
                  Number(
                    row.season_id,
                  ) ===
                  Number(
                    season.id,
                  ),
              )
              .sort(
                (a, b) =>
                  a.draft_position -
                  b.draft_position,
              )
              .map(
                (row) => ({
                  teamId:
                    Number(
                      row.team_id,
                    ),

                  teamName:
                    teamNameById.get(
                      Number(
                        row.team_id,
                      ),
                    ) ??
                    "Unknown",

                  draftPosition:
                    Number(
                      row.draft_position,
                    ),
                }),
              );

          const pickCount =
            picks.filter(
              (pick) =>
                Number(
                  pick.season_id,
                ) ===
                Number(
                  season.id,
                ),
            ).length;

          return {
            ...season,

            label:
              seasonLabel(
                season.season,
              ),

            draftOrder:
              order,

            pickCount,

            /*
             * Historical imported seasons are protected.
             *
             * Upcoming/test seasons can be deleted as long
             * as they have not been finalized.
             */
            canDelete:
              season.season >=
                2026 &&
              season.status !==
                "final",
          };
        },
      ),
  };
}


export async function GET() {
  const authError =
    await requireAdminApi();

  if (authError) {
    return authError;
  }

  try {
    return NextResponse.json({
      success: true,
      ...(await loadAdminData()),
    });
  } catch (error) {
    console.error(
      "NBA Skins admin load error:",
      error,
    );

    return NextResponse.json(
      {
        error:
          error instanceof
          Error
            ? error.message
            : "Failed to load NBA Skins admin.",
      },
      {
        status: 500,
      },
    );
  }
}


export async function POST(
  request: NextRequest,
) {
  const authError =
    await requireAdminApi();

  if (authError) {
    return authError;
  }

  try {
    const body =
      await request.json();

    const season =
      Number(
        body?.season,
      );


    if (
      !Number.isInteger(
        season,
      ) ||
      season < 2022 ||
      season > 2100
    ) {
      return NextResponse.json(
        {
          error:
            "Enter a valid NBA season starting year.",
        },
        {
          status: 400,
        },
      );
    }


    const {
      data: existing,
      error:
        existingError,
    } =
      await supabaseAdmin
        .from(
          "nba_skins_seasons",
        )
        .select(
          "id",
        )
        .eq(
          "season",
          season,
        )
        .maybeSingle();


    if (existingError) {
      throw new Error(
        existingError.message,
      );
    }


    if (existing) {
      return NextResponse.json(
        {
          error:
            `${seasonLabel(
              season,
            )} already exists.`,
        },
        {
          status: 409,
        },
      );
    }


    const now =
      new Date()
        .toISOString();


    const {
      data:
        createdSeason,
      error:
        createError,
    } =
      await supabaseAdmin
        .from(
          "nba_skins_seasons",
        )
        .insert({
          season,
          status:
            "open",
          draft_locked_at:
            null,
          finalized_at:
            null,
          updated_at:
            now,
        })
        .select(
          "id, season, status",
        )
        .single();


    if (createError) {
      throw new Error(
        createError.message,
      );
    }


    return NextResponse.json({
      success: true,

      message:
        `${seasonLabel(
          season,
        )} NBA Skins season created.`,

      season:
        createdSeason,
    });
  } catch (error) {
    console.error(
      "NBA Skins season create error:",
      error,
    );

    return NextResponse.json(
      {
        error:
          error instanceof
          Error
            ? error.message
            : "Failed to create NBA Skins season.",
      },
      {
        status: 500,
      },
    );
  }
}


export async function PATCH(
  request: NextRequest,
) {
  const authError =
    await requireAdminApi();

  if (authError) {
    return authError;
  }

  try {
    const body =
      await request.json();

    const seasonId =
      Number(
        body?.seasonId,
      );

    const action =
      String(
        body?.action ??
        "",
      );


    if (
      !Number.isInteger(
        seasonId,
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


    const {
      data: season,
      error:
        seasonError,
    } =
      await supabaseAdmin
        .from(
          "nba_skins_seasons",
        )
        .select(
          "id, season, status",
        )
        .eq(
          "id",
          seasonId,
        )
        .maybeSingle();


    if (
      seasonError ||
      !season
    ) {
      return NextResponse.json(
        {
          error:
            seasonError
              ?.message ??
            "NBA Skins season not found.",
        },
        {
          status: 404,
        },
      );
    }


    if (
      action ===
      "save-order"
    ) {
      if (
        season.status ===
        "final"
      ) {
        return NextResponse.json(
          {
            error:
              "A finalized season's draft order cannot be changed.",
          },
          {
            status: 409,
          },
        );
      }


      const order =
        (
          Array.isArray(
            body?.order,
          )
            ? body.order
            : []
        ) as Array<{
          teamId: number;
          draftPosition?: number;
        }>;


      if (
        order.length !== 4
      ) {
        return NextResponse.json(
          {
            error:
              "Draft order must contain exactly four league members.",
          },
          {
            status: 400,
          },
        );
      }


      const {
        data: teams,
        error:
          teamsError,
      } =
        await supabaseAdmin
          .from("teams")
          .select(
            "id, name",
          )
          .in(
            "name",
            [...OWNER_NAMES],
          );


      if (teamsError) {
        throw new Error(
          teamsError.message,
        );
      }


      const validTeamIds =
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


      const teamIds =
        order.map(
          (entry) =>
            Number(
              entry?.teamId,
            ),
        );


      if (
        new Set(
          teamIds,
        ).size !== 4 ||
        teamIds.some(
          (teamId) =>
            !validTeamIds.has(
              teamId,
            ),
        )
      ) {
        return NextResponse.json(
          {
            error:
              "Draft order must contain Mark, Josh, Jon, and Andy exactly once.",
          },
          {
            status: 400,
          },
        );
      }


      /*
       * Delete then insert avoids transient unique-position
       * conflicts when swapping positions.
       */
      const {
        error:
          deleteOrderError,
      } =
        await supabaseAdmin
          .from(
            "nba_skins_draft_order",
          )
          .delete()
          .eq(
            "season_id",
            seasonId,
          );


      if (deleteOrderError) {
        throw new Error(
          `Failed to clear draft order: ${deleteOrderError.message}`,
        );
      }


      const rows =
        teamIds.map(
          (
            teamId,
            index,
          ) => ({
            season_id:
              seasonId,

            team_id:
              teamId,

            draft_position:
              index + 1,
          }),
        );


      const {
        error:
          insertOrderError,
      } =
        await supabaseAdmin
          .from(
            "nba_skins_draft_order",
          )
          .insert(
            rows,
          );


      if (insertOrderError) {
        throw new Error(
          `Failed to save draft order: ${insertOrderError.message}`,
        );
      }


      return NextResponse.json({
        success: true,

        message:
          `${seasonLabel(
            Number(
              season.season,
            ),
          )} draft order saved.`,
      });
    }


    if (
      action ===
      "set-status"
    ) {
      const status =
        String(
          body?.status ??
          "",
        ) as
          SeasonStatus;


      if (
        ![
          "open",
          "locked",
        ].includes(
          status,
        )
      ) {
        return NextResponse.json(
          {
            error:
              "Admin draft status can only be Open or Locked here.",
          },
          {
            status: 400,
          },
        );
      }


      if (
        season.status ===
        "final"
      ) {
        return NextResponse.json(
          {
            error:
              "A finalized NBA Skins season cannot be reopened from Draft Admin.",
          },
          {
            status: 409,
          },
        );
      }


      if (
        status ===
        "locked"
      ) {
        const [
          orderResult,
          picksResult,
        ] =
          await Promise.all([
            supabaseAdmin
              .from(
                "nba_skins_draft_order",
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
                seasonId,
              ),

            supabaseAdmin
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
                seasonId,
              ),
          ]);


        if (
          orderResult.error ||
          picksResult.error
        ) {
          throw new Error(
            orderResult.error
              ?.message ??
            picksResult.error
              ?.message ??
            "Failed to validate draft.",
          );
        }


        if (
          orderResult.count !==
            4 ||
          picksResult.count !==
            28
        ) {
          return NextResponse.json(
            {
              error:
                "Complete the four-person draft order and all 28 picks before locking.",
            },
            {
              status: 409,
            },
          );
        }
      }


      const now =
        new Date()
          .toISOString();


      const {
        error:
          updateError,
      } =
        await supabaseAdmin
          .from(
            "nba_skins_seasons",
          )
          .update({
            status,

            draft_locked_at:
              status ===
              "locked"
                ? now
                : null,

            updated_at:
              now,
          })
          .eq(
            "id",
            seasonId,
          );


      if (updateError) {
        throw new Error(
          updateError.message,
        );
      }


      return NextResponse.json({
        success: true,

        message:
          status ===
          "locked"
            ? `${seasonLabel(
                Number(
                  season.season,
                ),
              )} draft locked.`
            : `${seasonLabel(
                Number(
                  season.season,
                ),
              )} draft reopened.`,
      });
    }


    return NextResponse.json(
      {
        error:
          "Unknown NBA Skins admin action.",
      },
      {
        status: 400,
      },
    );
  } catch (error) {
    console.error(
      "NBA Skins admin update error:",
      error,
    );

    return NextResponse.json(
      {
        error:
          error instanceof
          Error
            ? error.message
            : "Failed to update NBA Skins.",
      },
      {
        status: 500,
      },
    );
  }
}


export async function DELETE(
  request: NextRequest,
) {
  const authError =
    await requireAdminApi();

  if (authError) {
    return authError;
  }

  try {
    const body =
      await request.json();

    const seasonId =
      Number(
        body?.seasonId,
      );


    if (
      !Number.isInteger(
        seasonId,
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


    const {
      data: season,
      error:
        seasonError,
    } =
      await supabaseAdmin
        .from(
          "nba_skins_seasons",
        )
        .select(
          "id, season, status",
        )
        .eq(
          "id",
          seasonId,
        )
        .maybeSingle();


    if (
      seasonError ||
      !season
    ) {
      return NextResponse.json(
        {
          error:
            seasonError
              ?.message ??
            "NBA Skins season not found.",
        },
        {
          status: 404,
        },
      );
    }


    if (
      Number(
        season.season,
      ) < 2026
    ) {
      return NextResponse.json(
        {
          error:
            "Historical NBA Skins seasons cannot be deleted from this page.",
        },
        {
          status: 409,
        },
      );
    }


    if (
      season.status ===
      "final"
    ) {
      return NextResponse.json(
        {
          error:
            "Final NBA Skins seasons cannot be deleted.",
        },
        {
          status: 409,
        },
      );
    }


    const {
      error:
        deleteError,
    } =
      await supabaseAdmin
        .from(
          "nba_skins_seasons",
        )
        .delete()
        .eq(
          "id",
          seasonId,
        );


    if (deleteError) {
      throw new Error(
        deleteError.message,
      );
    }


    return NextResponse.json({
      success: true,

      message:
        `${seasonLabel(
          Number(
            season.season,
          ),
        )} deleted.`,
    });
  } catch (error) {
    console.error(
      "NBA Skins delete season error:",
      error,
    );

    return NextResponse.json(
      {
        error:
          error instanceof
          Error
            ? error.message
            : "Failed to delete NBA Skins season.",
      },
      {
        status: 500,
      },
    );
  }
}
