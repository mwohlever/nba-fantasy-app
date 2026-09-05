import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { getNcaaPickEmAccess } from "@/lib/ncaaPickEm/access";
import { fetchNcaaPickEmWeek } from "@/lib/providers/ncaa";

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

    if (!season || !week) {
      return NextResponse.json(
        { error: "Season and week are required." },
        { status: 400 },
      );
    }

    const result = await fetchNcaaPickEmWeek({
      season,
      week,
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
