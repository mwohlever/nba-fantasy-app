import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { getNcaaPickEmAccess } from "@/lib/ncaaPickEm/access";

const ESPN_CFB_BASE =
  "https://site.api.espn.com/apis/site/v2/sports/football/college-football";

function eventId(value: string | null) {
  return value && /^\d+$/.test(value) ? value : null;
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
    const id = eventId(params.get("eventId"));

    if (!id) {
      return NextResponse.json(
        { error: "A valid ESPN event ID is required." },
        { status: 400 },
      );
    }

    const response = await fetch(
      `${ESPN_CFB_BASE}/summary?event=${id}`,
      {
        cache: "no-store",
        headers: {
          Accept: "application/json",
        },
      },
    );

    if (!response.ok) {
      throw new Error(
        `ESPN NCAA game summary failed: ${response.status}`,
      );
    }

    const summary = await response.json();

    return NextResponse.json({
      success: true,
      eventId: id,
      header: summary?.header ?? null,
      drives: summary?.drives ?? null,
      scoringPlays: Array.isArray(summary?.scoringPlays)
        ? summary.scoringPlays
        : [],
      boxscore: summary?.boxscore ?? null,
      leaders: Array.isArray(summary?.leaders)
        ? summary.leaders
        : [],
      gameInfo: summary?.gameInfo ?? null,
      predictor: summary?.predictor ?? null,
      lastFiveGames: Array.isArray(summary?.lastFiveGames)
        ? summary.lastFiveGames
        : [],
    });
  } catch (error) {
    console.error("Failed to load NCAA game detail", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to load NCAA game detail.",
      },
      { status: 500 },
    );
  }
}
