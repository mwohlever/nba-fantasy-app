import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  createClient,
} from "@supabase/supabase-js";


export const dynamic =
  "force-dynamic";


type SeasonRow = {
  id: number;
  season: number;
  status:
    | "open"
    | "locked"
    | "final";
};


type LeagueTeamRow = {
  id: number;
  name: string;
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
    number | null;
  final_points:
    number | null;
};


type NbaTeamRow = {
  abbreviation: string;
  display_name: string;
};


type TeamRecordRow = {
  nba_team_abbreviation: string;
  wins: number;
  losses: number;
  games_played: number;
};


const OWNER_NAMES =
  [
    "Mark",
    "Josh",
    "Jon",
    "Andy",
  ] as const;


function getSupabaseAdmin() {
  const url =
    process.env
      .NEXT_PUBLIC_SUPABASE_URL ??
    process.env
      .SUPABASE_URL;

  const serviceKey =
    process.env
      .SUPABASE_SERVICE_ROLE_KEY ??
    process.env
      .SUPABASE_SERVICE_KEY;

  if (
    !url ||
    !serviceKey
  ) {
    throw new Error(
      "Missing Supabase URL/service-role key for NBA Skins standings.",
    );
  }

  return createClient(
    url,
    serviceKey,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );
}


export async function GET(
  request: NextRequest,
) {
  try {
    const supabase =
      getSupabaseAdmin();

    const {
      data:
        seasonRowsRaw,
      error:
        seasonsError,
    } =
      await supabase
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

    const seasonRows =
      (
        seasonRowsRaw ??
        []
      ) as unknown as
        SeasonRow[];

    if (
      seasonRows.length ===
      0
    ) {
      return NextResponse.json({
        availableSeasons: [],
        selectedSeason: null,
        standings: [],
      });
    }

    const requestedSeason =
      Number(
        request.nextUrl
          .searchParams
          .get("season"),
      );

    const selectedSeason =
      seasonRows.find(
        (row) =>
          Number.isFinite(
            requestedSeason,
          ) &&
          row.season ===
            requestedSeason,
      ) ??
      seasonRows[0];


    const [
      leagueTeamsResult,
      picksResult,
      nbaTeamsResult,
      recordsResult,
      usersResult,
    ] =
      await Promise.all([
        supabase
          .from("teams")
          .select(
            "id, name",
          )
          .in(
            "name",
            [...OWNER_NAMES],
          ),

        supabase
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

        supabase
          .from(
            "nba_skins_nba_teams",
          )
          .select(
            "abbreviation, display_name",
          ),

        supabase
          .from(
            "nba_skins_team_records",
          )
          .select(
            "nba_team_abbreviation, wins, losses, games_played",
          )
          .eq(
            "season_id",
            selectedSeason.id,
          ),

        supabase
          .from(
            "app_users",
          )
          .select(
            "team_id, avatar_url",
          )
          .not(
            "team_id",
            "is",
            null,
          ),
      ]);


    if (
      leagueTeamsResult.error
    ) {
      throw new Error(
        leagueTeamsResult
          .error.message,
      );
    }

    if (
      picksResult.error
    ) {
      throw new Error(
        picksResult
          .error.message,
      );
    }

    if (
      nbaTeamsResult.error
    ) {
      throw new Error(
        nbaTeamsResult
          .error.message,
      );
    }

    if (
      recordsResult.error
    ) {
      throw new Error(
        recordsResult
          .error.message,
      );
    }

    if (
      usersResult.error
    ) {
      throw new Error(
        usersResult
          .error.message,
      );
    }


    const leagueTeams =
      (
        leagueTeamsResult.data ??
        []
      ) as unknown as
        LeagueTeamRow[];

    const picks =
      (
        picksResult.data ??
        []
      ) as unknown as
        PickRow[];

    const nbaTeams =
      (
        nbaTeamsResult.data ??
        []
      ) as unknown as
        NbaTeamRow[];

    const teamRecords =
      (
        recordsResult.data ??
        []
      ) as unknown as
        TeamRecordRow[];

    const teamUsers =
      (
        usersResult.data ??
        []
      ) as unknown as Array<{
        team_id: number | null;
        avatar_url: string | null;
      }>;


    const avatarByTeamId =
      new Map<
        number,
        string | null
      >();

    teamUsers.forEach(
      (user) => {
        if (
          user.team_id === null ||
          user.team_id === undefined
        ) {
          return;
        }

        avatarByTeamId.set(
          Number(
            user.team_id,
          ),
          user.avatar_url ??
            null,
        );
      },
    );


    const leagueTeamByName =
      new Map(
        leagueTeams.map(
          (row) => [
            row.name,
            row,
          ],
        ),
      );

    const nbaTeamNameByAbbreviation =
      new Map(
        nbaTeams.map(
          (row) => [
            row.abbreviation,
            row.display_name,
          ],
        ),
      );

    const recordByAbbreviation =
      new Map(
        teamRecords.map(
          (row) => [
            row.nba_team_abbreviation,
            row,
          ],
        ),
      );


    const standings =
      OWNER_NAMES.map(
        (ownerName) => {
          const leagueTeam =
            leagueTeamByName.get(
              ownerName,
            );

          const ownerPicks =
            leagueTeam
              ? picks
                  .filter(
                    (pick) =>
                      pick.team_id ===
                      leagueTeam.id,
                  )
                  .sort(
                    (a, b) => {
                      const roundA =
                        a.draft_round ??
                        999;

                      const roundB =
                        b.draft_round ??
                        999;

                      return (
                        roundA -
                        roundB
                      );
                    },
                  )
              : [];

          const hasCompleteFinalPoints =
            ownerPicks.length === 7 &&
            ownerPicks.every(
              (pick) =>
                pick.final_points !==
                null,
            );

          const finalTotal =
            hasCompleteFinalPoints
              ? ownerPicks.reduce(
                  (
                    sum,
                    pick,
                  ) =>
                    sum +
                    Number(
                      pick.final_points ??
                      0,
                    ),
                  0,
                )
              : null;

          return {
            ownerName,

            leagueTeamId:
              leagueTeam?.id ??
              null,

            avatarUrl:
              leagueTeam
                ? avatarByTeamId.get(
                    Number(
                      leagueTeam.id,
                    ),
                  ) ??
                  null
                : null,

            pickCount:
              ownerPicks.length,

            finalTotal,

            hasCompleteFinalPoints,

            picks:
              ownerPicks.map(
                (pick) => {
                  const record =
                    recordByAbbreviation.get(
                      pick.nba_team_abbreviation,
                    );

                  return {
                    id:
                      pick.id,

                    nbaTeamAbbreviation:
                      pick.nba_team_abbreviation,

                    nbaTeamName:
                      nbaTeamNameByAbbreviation.get(
                        pick.nba_team_abbreviation,
                      ) ??
                      pick.nba_team_abbreviation,

                    pickType:
                      pick.pick_type,

                    /*
                     * Historical draft-order data before 2026 is
                     * intentionally not considered authoritative.
                     */
                    draftRound:
                      selectedSeason.season >=
                      2026
                        ? pick.draft_round
                        : null,

                    finalPoints:
                      pick.final_points,

                    record:
                      record
                        ? {
                            wins:
                              record.wins,

                            losses:
                              record.losses,

                            gamesPlayed:
                              record.games_played,
                          }
                        : null,
                  };
                },
              ),
          };
        },
      );


    const ranked =
      standings
        .filter(
          (entry) =>
            entry.finalTotal !==
            null,
        )
        .sort(
          (a, b) =>
            Number(
              b.finalTotal,
            ) -
            Number(
              a.finalTotal,
            ),
        );


    const rankByOwner =
      new Map<
        string,
        number
      >();

    let previousTotal:
      | number
      | null = null;

    let previousRank = 0;


    ranked.forEach(
      (
        entry,
        index,
      ) => {
        const total =
          Number(
            entry.finalTotal,
          );

        const rank =
          previousTotal !==
            null &&
          total ===
            previousTotal
            ? previousRank
            : index + 1;

        rankByOwner.set(
          entry.ownerName,
          rank,
        );

        previousTotal =
          total;

        previousRank =
          rank;
      },
    );


    return NextResponse.json({
      availableSeasons:
        seasonRows.map(
          (row) => ({
            season:
              row.season,

            status:
              row.status,
          }),
        ),

      selectedSeason: {
        id:
          selectedSeason.id,

        season:
          selectedSeason.season,

        status:
          selectedSeason.status,
      },

      standings:
        standings
          .map(
            (entry) => ({
              ...entry,

              rank:
                rankByOwner.get(
                  entry.ownerName,
                ) ??
                null,
            }),
          )
          .sort(
            (a, b) => {
              if (
                a.rank !== null &&
                b.rank !== null
              ) {
                return (
                  a.rank -
                  b.rank
                );
              }

              if (
                a.rank !== null
              ) {
                return -1;
              }

              if (
                b.rank !== null
              ) {
                return 1;
              }

              return (
                OWNER_NAMES.indexOf(
                  a.ownerName as
                    (
                      typeof OWNER_NAMES
                    )[number],
                ) -
                OWNER_NAMES.indexOf(
                  b.ownerName as
                    (
                      typeof OWNER_NAMES
                    )[number],
                )
              );
            },
          ),
    });
  } catch (error) {
    console.error(
      "NBA Skins standings error:",
      error,
    );

    return NextResponse.json(
      {
        error:
          error instanceof
          Error
            ? error.message
            : "Failed to load NBA Skins standings.",
      },
      {
        status: 500,
      },
    );
  }
}
