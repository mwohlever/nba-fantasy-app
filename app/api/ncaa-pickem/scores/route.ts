import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { getNcaaPickEmAccess } from "@/lib/ncaaPickEm/access";
import { fetchNcaaSetupScoreboard } from "@/lib/ncaaPickEm/weekSetup";
import { fetchNcaaPickEmWeek } from "@/lib/providers/ncaa";
import { currentFootballCompetitionPeriod } from "@/lib/live-scores/competitionPeriod";

function positive(value: string | null) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        { error: "Login required." },
        { status: 401 },
      );
    }

    const access = await getNcaaPickEmAccess(user);

    if (!access) {
      return NextResponse.json(
        { error: "NCAA Pick 'Em is not enabled for this Group." },
        { status: 404 },
      );
    }

    const params = new URL(request.url).searchParams;
    const season = positive(params.get("season"));
    const week = positive(params.get("week"));
    const hasSeason = params.has("season");
    const hasWeek = params.has("week");

    if (hasSeason !== hasWeek || (hasSeason && (!season || !week))) {
      return NextResponse.json(
        { error: "Season and week must be provided together." },
        { status: 400 },
      );
    }

    const current = !hasSeason
      ? currentFootballCompetitionPeriod(await fetchNcaaSetupScoreboard())
      : null;

    if (!hasSeason && !current) {
      return NextResponse.json(
        { error: "Unable to determine the current NCAA week." },
        { status: 502 },
      );
    }

    const result = await fetchNcaaPickEmWeek({
      season: season ?? current!.season,
      week: week ?? current!.week,
    });

    return NextResponse.json({
      success: true,
      season: result.season,
      week: result.week,
      label: result.label,
      games: result.scheduleGames,
    });
  } catch (error) {
    console.error(
      "Failed to load NCAA scores",
      error,
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to load NCAA scores.",
      },
      { status: 500 },
    );
  }
}
