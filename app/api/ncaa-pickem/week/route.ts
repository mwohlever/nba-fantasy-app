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

type PickEmWeekRow = {
  id: number;
  season: number;
  week_number: number;
  label: string;
  lock_at: string | null;
  status: "open" | "locked" | "final";
  analysis: string | null;
  show_analysis: boolean;
};

function numericParam(
  value: string | null,
): number | null {
  if (!value) return null;

  const number =
    Number(value);

  return Number.isInteger(number) &&
    number > 0
    ? number
    : null;
}

function isWeekLocked(
  week: PickEmWeekRow,
) {
  if (week.status !== "open") {
    return true;
  }

  if (!week.lock_at) {
    return false;
  }

  const lockTime =
    new Date(
      week.lock_at,
    ).getTime();

  return (
    Number.isFinite(lockTime) &&
    Date.now() >= lockTime
  );
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
        { status: 401 },
      );
    }

    const { searchParams } =
      new URL(request.url);

    const requestedSeason =
      numericParam(
        searchParams.get(
          "season",
        ),
      );

    const requestedWeek =
      numericParam(
        searchParams.get(
          "week",
        ),
      );

    const {
      data: weeksData,
      error: weeksError,
    } = await supabaseAdmin
      .from("ncaa_pickem_weeks")
      .select(
        "id, season, week_number, label, lock_at, status, analysis, show_analysis",
      )
      .order(
        "season",
        {
          ascending: false,
        },
      )
      .order(
        "week_number",
        {
          ascending: false,
        },
      );

    if (weeksError) {
      return NextResponse.json(
        {
          error:
            weeksError.message,
        },
        { status: 500 },
      );
    }

    const weeks =
      (weeksData ??
        []) as PickEmWeekRow[];

    let selectedWeek:
      | PickEmWeekRow
      | null =
      null;

    if (
      requestedSeason !== null &&
      requestedWeek !== null
    ) {
      selectedWeek =
        weeks.find(
          (week) =>
            Number(
              week.season,
            ) ===
              requestedSeason &&
            Number(
              week.week_number,
            ) ===
              requestedWeek,
        ) ?? null;
    }

    if (!selectedWeek) {
      selectedWeek =
        weeks[0] ?? null;
    }

    if (!selectedWeek) {
      return NextResponse.json({
        success: true,

        viewer: {
          teamId:
            user.teamId,

          displayName:
            user.displayName,

          avatarUrl:
            user.avatarUrl,
        },

        weeks,
        week: null,
        games: [],
        picks: [],
        groupPicks: [],
        locked: false,
      });
    }

    const locked =
      isWeekLocked(
        selectedWeek,
      );

    const [
      gamesResult,
      viewerPicksResult,
      teamsResult,
    ] =
      await Promise.all([
        supabaseAdmin
          .from(
            "ncaa_pickem_games",
          )
          .select("*")
          .eq(
            "week_id",
            selectedWeek.id,
          )
          .eq(
            "included",
            true,
          )
          .order(
            "kickoff_at",
            {
              ascending: true,
            },
          ),

        supabaseAdmin
          .from(
            "ncaa_pickem_picks",
          )
          .select(
            "id, week_id, game_id, team_id, picked_team_id, is_correct",
          )
          .eq(
            "week_id",
            selectedWeek.id,
          )
          .eq(
            "team_id",
            user.teamId,
          ),

        supabaseAdmin
          .from("teams")
          .select(
            "id, name",
          )
          .order(
            "id",
            {
              ascending: true,
            },
          ),
      ]);

    if (gamesResult.error) {
      return NextResponse.json(
        {
          error:
            gamesResult.error.message,
        },
        { status: 500 },
      );
    }

    if (
      viewerPicksResult.error
    ) {
      return NextResponse.json(
        {
          error:
            viewerPicksResult.error.message,
        },
        { status: 500 },
      );
    }

    if (teamsResult.error) {
      return NextResponse.json(
        {
          error:
            teamsResult.error.message,
        },
        { status: 500 },
      );
    }

    const {
      data: appUsers,
      error: usersError,
    } = await supabaseAdmin
      .from("app_users")
      .select(
        "team_id, display_name, avatar_url",
      )
      .eq(
        "is_active",
        true,
      );

    if (usersError) {
      return NextResponse.json(
        {
          error:
            usersError.message,
        },
        { status: 500 },
      );
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
      of appUsers ?? []
    ) {
      userByTeamId.set(
        Number(
          appUser.team_id,
        ),
        {
          displayName:
            String(
              appUser.display_name ??
                "",
            ),

          avatarUrl:
            appUser.avatar_url ??
            null,
        },
      );
    }

    const participants =
      (teamsResult.data ??
        []).map(
        (team) => {
          const teamId =
            Number(team.id);

          const appUser =
            userByTeamId.get(
              teamId,
            );

          return {
            teamId,

            name:
              appUser?.displayName ||
              String(
                team.name,
              ),

            avatarUrl:
              appUser?.avatarUrl ??
              null,
          };
        },
      );

    let groupPicks:
      Array<{
        game_id: number;
        team_id: number;
        picked_team_id:
          string;
        is_correct:
          boolean | null;
      }> = [];

    /*
     * CRITICAL:
     * Other players' picked_team_id values are not queried
     * at all until the weekly card is locked.
     *
     * This is server-side secrecy, not UI hiding.
     */
    if (locked) {
      const {
        data,
        error,
      } = await supabaseAdmin
        .from(
          "ncaa_pickem_picks",
        )
        .select(
          "game_id, team_id, picked_team_id, is_correct",
        )
        .eq(
          "week_id",
          selectedWeek.id,
        );

      if (error) {
        return NextResponse.json(
          {
            error:
              error.message,
          },
          { status: 500 },
        );
      }

      groupPicks =
        (data ?? []).map(
          (row) => ({
            game_id:
              Number(
                row.game_id,
              ),

            team_id:
              Number(
                row.team_id,
              ),

            picked_team_id:
              String(
                row.picked_team_id,
              ),

            is_correct:
              row.is_correct ??
              null,
          }),
        );
    }

    return NextResponse.json({
      success: true,

      viewer: {
        teamId:
          user.teamId,

        displayName:
          user.displayName,

        avatarUrl:
          user.avatarUrl,
      },

      participants,
      weeks,

      week:
        selectedWeek,

      games:
        gamesResult.data ??
        [],

      picks:
        viewerPicksResult.data ??
        [],

      groupPicks,

      locked,
    });
  } catch (error) {
    console.error(
      "Failed to load NCAA Pick 'Em week",
      error,
    );

    return NextResponse.json(
      {
        error:
          "Unable to load NCAA Pick 'Em.",
      },
      { status: 500 },
    );
  }
}
