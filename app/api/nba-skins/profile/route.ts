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


type TeamRow = {
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
  final_points:
    number | null;
};


type NbaTeamRow = {
  abbreviation: string;
  display_name: string;
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
      "Missing Supabase URL/service-role key for NBA Skins profile.",
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


export async function GET(
  request: NextRequest,
) {
  try {
    const teamId =
      Number(
        request.nextUrl
          .searchParams
          .get("teamId"),
      );

    if (
      !Number.isFinite(
        teamId,
      ) ||
      teamId <= 0
    ) {
      return NextResponse.json(
        {
          error:
            "Missing or invalid teamId.",
        },
        {
          status: 400,
        },
      );
    }


    const supabase =
      getSupabaseAdmin();


    const [
      teamsResult,
      seasonsResult,
      picksResult,
      nbaTeamsResult,
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
            "nba_skins_seasons",
          )
          .select(
            "id, season, status",
          )
          .order(
            "season",
            {
              ascending: true,
            },
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
              "final_points",
            ].join(","),
          ),

        supabase
          .from(
            "nba_skins_nba_teams",
          )
          .select(
            "abbreviation, display_name",
          ),
      ]);


    if (
      teamsResult.error
    ) {
      throw new Error(
        teamsResult
          .error.message,
      );
    }

    if (
      seasonsResult.error
    ) {
      throw new Error(
        seasonsResult
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


    const teams =
      (
        teamsResult.data ??
        []
      ) as unknown as TeamRow[];

    const seasons =
      (
        seasonsResult.data ??
        []
      ) as unknown as SeasonRow[];

    const picks =
      (
        picksResult.data ??
        []
      ) as unknown as PickRow[];

    const nbaTeams =
      (
        nbaTeamsResult.data ??
        []
      ) as unknown as NbaTeamRow[];


    const team =
      teams.find(
        (row) =>
          Number(row.id) ===
          teamId,
      );

    if (!team) {
      return NextResponse.json(
        {
          error:
            "NBA Skins team not found.",
        },
        {
          status: 404,
        },
      );
    }


    const teamNameById =
      new Map(
        teams.map(
          (row) => [
            Number(row.id),
            row.name,
          ],
        ),
      );

    const nbaTeamNameByCode =
      new Map(
        nbaTeams.map(
          (row) => [
            row.abbreviation,
            row.display_name,
          ],
        ),
      );


    /*
     * Only fully scored seasons belong in historical
     * career standings.
     *
     * 2026 can already exist as an open season without
     * polluting the completed-career statistics.
     */
    const completedSeasons =
      seasons.filter(
        (season) => {
          const seasonPicks =
            picks.filter(
              (pick) =>
                Number(
                  pick.season_id,
                ) ===
                Number(
                  season.id,
                ),
            );

          if (
            seasonPicks.length !==
            28
          ) {
            return false;
          }

          return seasonPicks.every(
            (pick) =>
              pick.final_points !==
              null,
          );
        },
      );


    const seasonHistory =
      completedSeasons.map(
        (season) => {
          const seasonPicks =
            picks.filter(
              (pick) =>
                Number(
                  pick.season_id,
                ) ===
                Number(
                  season.id,
                ),
            );


          const totals =
            teams.map(
              (owner) => {
                const ownerPicks =
                  seasonPicks.filter(
                    (pick) =>
                      Number(
                        pick.team_id,
                      ) ===
                      Number(
                        owner.id,
                      ),
                  );

                const total =
                  ownerPicks.reduce(
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
                  );

                return {
                  teamId:
                    Number(
                      owner.id,
                    ),

                  teamName:
                    owner.name,

                  total,
                };
              },
            )
            .sort(
              (a, b) =>
                b.total -
                a.total,
            );


          const rankByTeam =
            new Map<
              number,
              number
            >();

          let previousScore:
            | number
            | null = null;

          let previousRank = 0;


          totals.forEach(
            (
              row,
              index,
            ) => {
              const rank =
                previousScore !==
                  null &&
                row.total ===
                  previousScore
                  ? previousRank
                  : index + 1;

              rankByTeam.set(
                row.teamId,
                rank,
              );

              previousScore =
                row.total;

              previousRank =
                rank;
            },
          );


          const ownerPicks =
            seasonPicks
              .filter(
                (pick) =>
                  Number(
                    pick.team_id,
                  ) ===
                  teamId,
              )
              .map(
                (pick) => ({
                  id:
                    Number(
                      pick.id,
                    ),

                  nbaTeamAbbreviation:
                    pick.nba_team_abbreviation,

                  nbaTeamName:
                    nbaTeamNameByCode.get(
                      pick.nba_team_abbreviation,
                    ) ??
                    pick.nba_team_abbreviation,

                  pickType:
                    pick.pick_type,

                  points:
                    Number(
                      pick.final_points ??
                        0,
                    ),
                }),
              );


          const teamTotal =
            totals.find(
              (row) =>
                row.teamId ===
                teamId,
            )?.total ?? 0;


          return {
            season:
              Number(
                season.season,
              ),

            finish:
              rankByTeam.get(
                teamId,
              ) ??
              null,

            points:
              teamTotal,

            picks:
              ownerPicks,

            standings:
              totals.map(
                (row) => ({
                  ...row,

                  finish:
                    rankByTeam.get(
                      row.teamId,
                    ) ??
                    null,
                }),
              ),
          };
        },
      );


    const seasonsPlayed =
      seasonHistory.length;

    const championships =
      seasonHistory.filter(
        (season) =>
          season.finish === 1,
      ).length;

    const runnerUps =
      seasonHistory.filter(
        (season) =>
          season.finish === 2,
      ).length;

    const podiumFinishes =
      seasonHistory.filter(
        (season) =>
          season.finish !==
            null &&
          season.finish <= 3,
      ).length;

    const careerPoints =
      seasonHistory.reduce(
        (
          sum,
          season,
        ) =>
          sum +
          season.points,
        0,
      );

    const avgPoints =
      seasonsPlayed > 0
        ? round(
            careerPoints /
              seasonsPlayed,
          )
        : null;

    const finishValues =
      seasonHistory
        .map(
          (season) =>
            season.finish,
        )
        .filter(
          (
            value,
          ): value is number =>
            value !== null,
        );

    const avgFinish =
      finishValues.length > 0
        ? round(
            finishValues.reduce(
              (
                sum,
                finish,
              ) =>
                sum +
                finish,
              0,
            ) /
              finishValues.length,
          )
        : null;


    const allOwnerPicks =
      seasonHistory.flatMap(
        (season) =>
          season.picks.map(
            (pick) => ({
              ...pick,

              season:
                season.season,
            }),
          ),
      );


    const bestPick =
      allOwnerPicks.length > 0
        ? [...allOwnerPicks].sort(
            (a, b) =>
              b.points -
              a.points,
          )[0]
        : null;

    const worstPick =
      allOwnerPicks.length > 0
        ? [...allOwnerPicks].sort(
            (a, b) =>
              a.points -
              b.points,
          )[0]
        : null;


    const bestSeason =
      seasonHistory.length > 0
        ? [...seasonHistory].sort(
            (a, b) => {
              if (
                b.points !==
                a.points
              ) {
                return (
                  b.points -
                  a.points
                );
              }

              return (
                Number(
                  a.finish ??
                    99,
                ) -
                Number(
                  b.finish ??
                    99,
                )
              );
            },
          )[0]
        : null;


    const winsPicks =
      allOwnerPicks.filter(
        (pick) =>
          pick.pickType ===
          "wins",
      );

    const lossesPicks =
      allOwnerPicks.filter(
        (pick) =>
          pick.pickType ===
          "losses",
      );


    function pickSummary(
      values: typeof allOwnerPicks,
    ) {
      const points =
        values.reduce(
          (
            sum,
            pick,
          ) =>
            sum +
            pick.points,
          0,
        );

      return {
        picks:
          values.length,

        points,

        average:
          values.length > 0
            ? round(
                points /
                  values.length,
              )
            : null,
      };
    }


    return NextResponse.json({
      success: true,

      team: {
        id:
          Number(
            team.id,
          ),

        name:
          team.name,
      },

      availableSeasons:
        completedSeasons
          .map(
            (season) =>
              Number(
                season.season,
              ),
          )
          .sort(
            (a, b) =>
              b - a,
          ),

      career: {
        seasonsPlayed,
        championships,
        runnerUps,
        podiumFinishes,
        careerPoints,
        avgPoints,
        avgFinish,

        bestSeason:
          bestSeason
            ? {
                season:
                  bestSeason.season,

                points:
                  bestSeason.points,

                finish:
                  bestSeason.finish,
              }
            : null,

        bestPick,

        worstPick,

        winsPicks:
          pickSummary(
            winsPicks,
          ),

        lossesPicks:
          pickSummary(
            lossesPicks,
          ),
      },

      seasonHistory:
        [...seasonHistory]
          .sort(
            (a, b) =>
              b.season -
              a.season,
          )
          .map(
            (season) => ({
              season:
                season.season,

              finish:
                season.finish,

              points:
                season.points,

              picks:
                season.picks,
            }),
          ),
    });
  } catch (error) {
    console.error(
      "NBA Skins profile error:",
      error,
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to load NBA Skins profile.",
      },
      {
        status: 500,
      },
    );
  }
}
