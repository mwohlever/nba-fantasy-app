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


export const dynamic =
  "force-dynamic";


const OWNER_NAMES =
  [
    "Mark",
    "Josh",
    "Jon",
    "Andy",
  ] as const;


type SeasonRow = {
  id: number;
  season: number;
  status:
    | "open"
    | "locked"
    | "final";
};


type TeamRow = {
  id: number;
  name: string;
};


type NbaTeamRow = {
  abbreviation: string;
  display_name: string;
  is_active?: boolean | null;
};


type PickRow = {
  id: number;
  season_id: number;
  team_id: number;
  nba_team_abbreviation: string;
  pick_type:
    | "wins"
    | "losses";
  draft_round:
    | number
    | null;
  final_points:
    | number
    | null;
};


type DraftOrderRow =
  Record<
    string,
    unknown
  > & {
    season_id?: number;
    team_id?: number;
  };


type SavePickInput = {
  pickNumber: number;
  round: number;
  teamId: number;
  nbaTeamAbbreviation: string;
  pickType:
    | "wins"
    | "losses";
};


function seasonLabel(
  season: number,
) {
  return `${season}-${String(
    season + 1,
  ).slice(-2)}`;
}


function getDraftPosition(
  row: DraftOrderRow,
) {
  const candidates = [
    row.draft_order,
    row.draft_position,
    row.position,
  ];

  for (
    const candidate
    of candidates
  ) {
    const value =
      Number(candidate);

    if (
      Number.isInteger(value) &&
      value >= 1
    ) {
      return value;
    }
  }

  return null;
}


function buildSnakeOwners(
  orderedTeams: TeamRow[],
) {
  const slots: Array<{
    pickNumber: number;
    round: number;
    roundPick: number;
    teamId: number;
    teamName: string;
  }> = [];

  for (
    let round = 1;
    round <= 7;
    round += 1
  ) {
    const roundTeams =
      round % 2 === 1
        ? orderedTeams
        : [...orderedTeams]
            .reverse();

    roundTeams.forEach(
      (
        team,
        index,
      ) => {
        slots.push({
          pickNumber:
            slots.length + 1,

          round,

          roundPick:
            index + 1,

          teamId:
            team.id,

          teamName:
            team.name,
        });
      },
    );
  }

  return slots;
}


async function loadDraft(
  requestedSeason?: number,
) {
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
    ) as SeasonRow[];

  if (
    seasons.length === 0
  ) {
    throw new Error(
      "No NBA Skins seasons exist.",
    );
  }

  const selectedSeason =
    seasons.find(
      (row) =>
        row.season ===
        requestedSeason,
    ) ??
    seasons[0];


  const [
    teamsResult,
    nbaTeamsResult,
    draftOrderResult,
    picksResult,
  ] =
    await Promise.all([
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
          "nba_skins_nba_teams",
        )
        .select(
          "*",
        )
        .order(
          "display_name",
          {
            ascending: true,
          },
        ),

      supabaseAdmin
        .from(
          "nba_skins_draft_order",
        )
        .select(
          "*",
        )
        .eq(
          "season_id",
          selectedSeason.id,
        ),

      supabaseAdmin
        .from(
          "nba_skins_picks",
        )
        .select(
          [
            "id",
            "season_id",
            "team_id",
            "nba_team_abbreviation",
            "pick_type",
            "draft_round",
            "final_points",
          ].join(","),
        )
        .eq(
          "season_id",
          selectedSeason.id,
        ),
    ]);


  if (
    teamsResult.error
  ) {
    throw new Error(
      teamsResult.error.message,
    );
  }

  if (
    nbaTeamsResult.error
  ) {
    throw new Error(
      nbaTeamsResult.error.message,
    );
  }

  if (
    draftOrderResult.error
  ) {
    throw new Error(
      draftOrderResult.error.message,
    );
  }

  if (
    picksResult.error
  ) {
    throw new Error(
      picksResult.error.message,
    );
  }


  const teams =
    (
      teamsResult.data ??
      []
    ) as TeamRow[];

  const nbaTeams =
    (
      nbaTeamsResult.data ??
      []
    ) as NbaTeamRow[];

  const draftOrder =
    (
      draftOrderResult.data ??
      []
    ) as DraftOrderRow[];

  const picks =
    (
      picksResult.data ??
      []
    ) as unknown as PickRow[];


  const teamById =
    new Map(
      teams.map(
        (team) => [
          Number(team.id),
          team,
        ],
      ),
    );


  const orderedTeams =
    draftOrder
      .map(
        (row) => {
          const team =
            teamById.get(
              Number(
                row.team_id,
              ),
            );

          const position =
            getDraftPosition(
              row,
            );

          if (
            !team ||
            position === null
          ) {
            return null;
          }

          return {
            ...team,
            draftPosition:
              position,
          };
        },
      )
      .filter(
        (
          value,
        ): value is TeamRow & {
          draftPosition: number;
        } =>
          value !== null,
      )
      .sort(
        (a, b) =>
          a.draftPosition -
          b.draftPosition,
      );


  const hasValidDraftOrder =
    orderedTeams.length === 4 &&
    new Set(
      orderedTeams.map(
        (team) =>
          team.id,
      ),
    ).size === 4;


  const slots =
    hasValidDraftOrder
      ? buildSnakeOwners(
          orderedTeams,
        )
      : [];


  const pickByTeamRound =
    new Map<
      string,
      PickRow
    >();

  for (
    const pick
    of picks
  ) {
    if (
      pick.draft_round ===
      null
    ) {
      continue;
    }

    pickByTeamRound.set(
      `${pick.team_id}:${pick.draft_round}`,
      pick,
    );
  }


  return {
    seasons,

    selectedSeason,

    orderedTeams,

    hasValidDraftOrder,

    nbaTeams:
      nbaTeams
        .filter(
          (team) =>
            team.is_active !==
            false,
        )
        .map(
          (team) => ({
            abbreviation:
              team.abbreviation,

            displayName:
              team.display_name,
          }),
        ),

    slots:
      slots.map(
        (slot) => {
          const savedPick =
            pickByTeamRound.get(
              `${slot.teamId}:${slot.round}`,
            );

          return {
            ...slot,

            nbaTeamAbbreviation:
              savedPick
                ?.nba_team_abbreviation ??
              "",

            pickType:
              savedPick
                ?.pick_type ??
              "wins",
          };
        },
      ),
  };
}


export async function GET(
  request: NextRequest,
) {
  try {
    const rawSeason =
      request.nextUrl
        .searchParams
        .get("season");

    const requestedSeason =
      rawSeason
        ? Number(
            rawSeason,
          )
        : undefined;

    const draft =
      await loadDraft(
        Number.isInteger(
          requestedSeason,
        )
          ? requestedSeason
          : undefined,
      );

    const currentUser =
      await getCurrentUser();

    return NextResponse.json({
      success: true,

      currentUser:
        currentUser
          ? {
              teamId:
                currentUser.teamId,

              displayName:
                currentUser.displayName,

              role:
                currentUser.role,
            }
          : null,

      availableSeasons:
        draft.seasons.map(
          (season) => ({
            season:
              season.season,

            label:
              seasonLabel(
                season.season,
              ),

            status:
              season.status,
          }),
        ),

      season: {
        id:
          draft.selectedSeason.id,

        season:
          draft.selectedSeason.season,

        label:
          seasonLabel(
            draft.selectedSeason.season,
          ),

        status:
          draft.selectedSeason.status,

        editable:
          draft.selectedSeason.status ===
            "open" &&
          currentUser?.role ===
            "admin",
      },

      draftOrder:
        draft.orderedTeams.map(
          (team) => ({
            teamId:
              team.id,

            teamName:
              team.name,

            draftPosition:
              team.draftPosition,
          }),
        ),

      hasValidDraftOrder:
        draft.hasValidDraftOrder,

      nbaTeams:
        draft.nbaTeams,

      picks:
        draft.slots,
    });
  } catch (error) {
    console.error(
      "NBA Skins draft load error:",
      error,
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to load NBA Skins draft.",
      },
      {
        status: 500,
      },
    );
  }
}


export async function PUT(
  request: NextRequest,
) {
  try {
    const currentUser =
      await getCurrentUser();

    if (!currentUser) {
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

    if (
      currentUser.role !==
      "admin"
    ) {
      return NextResponse.json(
        {
          error:
            "Only an admin can save the NBA Skins draft.",
        },
        {
          status: 403,
        },
      );
    }


    const body =
      await request.json();

    const season =
      Number(
        body?.season,
      );

    const submittedPicks =
      Array.isArray(
        body?.picks,
      )
        ? body.picks
        : [];


    if (
      !Number.isInteger(
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


    const draft =
      await loadDraft(
        season,
      );


    if (
      draft.selectedSeason.season !==
      season
    ) {
      return NextResponse.json(
        {
          error:
            `NBA Skins season ${season} was not found.`,
        },
        {
          status: 404,
        },
      );
    }


    if (
      draft.selectedSeason.status !==
      "open"
    ) {
      return NextResponse.json(
        {
          error:
            `The ${seasonLabel(
              season,
            )} NBA Skins draft is ${draft.selectedSeason.status} and cannot be edited.`,
        },
        {
          status: 409,
        },
      );
    }


    if (
      !draft.hasValidDraftOrder
    ) {
      return NextResponse.json(
        {
          error:
            "A valid four-team draft order must be configured before saving.",
        },
        {
          status: 409,
        },
      );
    }


    if (
      submittedPicks.length !==
      28
    ) {
      return NextResponse.json(
        {
          error:
            "All 28 draft picks must be completed before saving.",
        },
        {
          status: 400,
        },
      );
    }


    const expectedSlots =
      draft.slots;

    const normalizedPicks:
      SavePickInput[] =
      [];


    for (
      let index = 0;
      index <
      expectedSlots.length;
      index += 1
    ) {
      const expected =
        expectedSlots[index];

      const raw =
        submittedPicks[index] ??
        {};

      const pickNumber =
        Number(
          raw.pickNumber,
        );

      const round =
        Number(
          raw.round,
        );

      const teamId =
        Number(
          raw.teamId,
        );

      const nbaTeamAbbreviation =
        String(
          raw.nbaTeamAbbreviation ??
            "",
        )
          .trim()
          .toUpperCase();

      const pickType =
        raw.pickType ===
        "losses"
          ? "losses"
          : raw.pickType ===
              "wins"
            ? "wins"
            : null;


      if (
        pickNumber !==
          expected.pickNumber ||
        round !==
          expected.round ||
        teamId !==
          expected.teamId
      ) {
        return NextResponse.json(
          {
            error:
              `Pick ${expected.pickNumber} does not match the configured draft order.`,
          },
          {
            status: 400,
          },
        );
      }


      if (
        !nbaTeamAbbreviation
      ) {
        return NextResponse.json(
          {
            error:
              `Pick ${expected.pickNumber} is missing an NBA team.`,
          },
          {
            status: 400,
          },
        );
      }


      if (!pickType) {
        return NextResponse.json(
          {
            error:
              `Pick ${expected.pickNumber} must be Wins or Losses.`,
          },
          {
            status: 400,
          },
        );
      }


      normalizedPicks.push({
        pickNumber,
        round,
        teamId,
        nbaTeamAbbreviation,
        pickType,
      });
    }


    const nbaTeamSet =
      new Set(
        draft.nbaTeams.map(
          (team) =>
            team.abbreviation,
        ),
      );


    for (
      const pick
      of normalizedPicks
    ) {
      if (
        !nbaTeamSet.has(
          pick.nbaTeamAbbreviation,
        )
      ) {
        return NextResponse.json(
          {
            error:
              `${pick.nbaTeamAbbreviation} is not an active NBA Skins team.`,
          },
          {
            status: 400,
          },
        );
      }
    }


    const selectedCodes =
      normalizedPicks.map(
        (pick) =>
          pick.nbaTeamAbbreviation,
      );


    if (
      new Set(
        selectedCodes,
      ).size !==
      28
    ) {
      return NextResponse.json(
        {
          error:
            "Each NBA team can only be drafted once.",
        },
        {
          status: 400,
        },
      );
    }


    const picksPerOwner =
      new Map<
        number,
        number
      >();

    normalizedPicks.forEach(
      (pick) => {
        picksPerOwner.set(
          pick.teamId,
          (
            picksPerOwner.get(
              pick.teamId,
            ) ??
            0
          ) + 1,
        );
      },
    );


    if (
      draft.orderedTeams.some(
        (team) =>
          picksPerOwner.get(
            team.id,
          ) !== 7,
      )
    ) {
      return NextResponse.json(
        {
          error:
            "Each league member must have exactly seven picks.",
        },
        {
          status: 400,
        },
      );
    }


    /*
     * This page is intentionally a whole-draft worksheet.
     *
     * Save replaces the open season's draft in one pass rather
     * than pretending individual rows are live draft turns.
     */
    const {
      error: deleteError,
    } =
      await supabaseAdmin
        .from(
          "nba_skins_picks",
        )
        .delete()
        .eq(
          "season_id",
          draft.selectedSeason.id,
        );


    if (deleteError) {
      throw new Error(
        `Failed to clear existing draft picks: ${deleteError.message}`,
      );
    }


    const now =
      new Date()
        .toISOString();


    const rows =
      normalizedPicks.map(
        (pick) => ({
          season_id:
            draft.selectedSeason.id,

          team_id:
            pick.teamId,

          nba_team_abbreviation:
            pick.nbaTeamAbbreviation,

          pick_type:
            pick.pickType,

          draft_round:
            pick.round,

          overall_pick:
            pick.pickNumber,

          final_points:
            null,

          created_at:
            now,

          updated_at:
            now,
        }),
      );


    const {
      error: insertError,
    } =
      await supabaseAdmin
        .from(
          "nba_skins_picks",
        )
        .insert(
          rows,
        );


    if (insertError) {
      throw new Error(
        `Failed to save NBA Skins draft: ${insertError.message}`,
      );
    }


    return NextResponse.json({
      success: true,

      message:
        `${seasonLabel(
          season,
        )} NBA Skins draft saved successfully.`,

      picksSaved:
        rows.length,
    });
  } catch (error) {
    console.error(
      "NBA Skins draft save error:",
      error,
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to save NBA Skins draft.",
      },
      {
        status: 500,
      },
    );
  }
}
