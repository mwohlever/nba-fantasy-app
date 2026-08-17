import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type PickEmWeekRow = {
  id: number;
  season: number;
  week_number: number;
  label: string;
  lock_at: string | null;
  status: "open" | "locked" | "final";
};

function numericParam(
  value: string | null,
): number | null {
  if (!value) return null;

  const number = Number(value);

  return Number.isInteger(number) && number > 0
    ? number
    : null;
}

export async function GET(
  request: NextRequest,
) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        { error: "Login required." },
        { status: 401 },
      );
    }

    const { searchParams } =
      new URL(request.url);

    const requestedSeason =
      numericParam(searchParams.get("season"));

    const requestedWeek =
      numericParam(searchParams.get("week"));

    const {
      data: weeksData,
      error: weeksError,
    } = await supabaseAdmin
      .from("ncaa_pickem_weeks")
      .select(
        "id, season, week_number, label, lock_at, status",
      )
      .order("season", {
        ascending: false,
      })
      .order("week_number", {
        ascending: false,
      });

    if (weeksError) {
      return NextResponse.json(
        {
          error:
            weeksError.message ||
            "Failed to load NCAA Pick 'Em weeks.",
        },
        { status: 500 },
      );
    }

    const weeks =
      (weeksData ?? []) as PickEmWeekRow[];

    let selectedWeek: PickEmWeekRow | null =
      null;

    if (
      requestedSeason !== null &&
      requestedWeek !== null
    ) {
      selectedWeek =
        weeks.find(
          (week) =>
            Number(week.season) ===
              requestedSeason &&
            Number(week.week_number) ===
              requestedWeek,
        ) ?? null;
    }

    /*
     * Until the ESPN importer is added, newest persisted week
     * is the default. Foundation 2 will make current/upcoming
     * week selection smarter.
     */
    if (!selectedWeek) {
      selectedWeek = weeks[0] ?? null;
    }

    if (!selectedWeek) {
      return NextResponse.json({
        success: true,
        viewer: {
          teamId: user.teamId,
          displayName: user.displayName,
          avatarUrl: user.avatarUrl,
        },
        weeks,
        week: null,
        games: [],
        picks: [],
        locked: false,
      });
    }

    const [
      gamesResult,
      picksResult,
    ] = await Promise.all([
      supabaseAdmin
        .from("ncaa_pickem_games")
        .select("*")
        .eq("week_id", selectedWeek.id)
        .eq("included", true)
        .order("kickoff_at", {
          ascending: true,
        }),

      supabaseAdmin
        .from("ncaa_pickem_picks")
        .select(
          "id, week_id, game_id, team_id, picked_team_id, is_correct",
        )
        .eq("week_id", selectedWeek.id)
        .eq("team_id", user.teamId),
    ]);

    if (gamesResult.error) {
      return NextResponse.json(
        {
          error:
            gamesResult.error.message ||
            "Failed to load NCAA Pick 'Em games.",
        },
        { status: 500 },
      );
    }

    if (picksResult.error) {
      return NextResponse.json(
        {
          error:
            picksResult.error.message ||
            "Failed to load NCAA Pick 'Em picks.",
        },
        { status: 500 },
      );
    }

    const lockAt =
      selectedWeek.lock_at
        ? new Date(
            selectedWeek.lock_at,
          ).getTime()
        : null;

    const locked =
      selectedWeek.status !== "open" ||
      (
        lockAt !== null &&
        Number.isFinite(lockAt) &&
        Date.now() >= lockAt
      );

    return NextResponse.json({
      success: true,

      viewer: {
        teamId: user.teamId,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
      },

      weeks,
      week: selectedWeek,
      games: gamesResult.data ?? [],
      picks: picksResult.data ?? [],
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
