import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { getNcaaPickEmAccess } from "@/lib/ncaaPickEm/access";

const ESPN_PLAYER_BASE =
  "https://site.web.api.espn.com/apis/common/v3/sports/football/college-football/athletes";

function numericParam(value: string | null) {
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

    const athleteId = numericParam(params.get("athleteId"));
    const teamId = numericParam(params.get("teamId"));
    const season = Number(params.get("season"));

    if (
      !athleteId ||
      !teamId ||
      !Number.isInteger(season) ||
      season < 2000 ||
      season > 2100
    ) {
      return NextResponse.json(
        { error: "Valid athlete, team, and season are required." },
        { status: 400 },
      );
    }

    const [statsResponse, gameLogResponse] = await Promise.all([
      fetch(
        `${ESPN_PLAYER_BASE}/${athleteId}/stats?season=${season}`,
        {
          cache: "no-store",
          headers: { Accept: "application/json" },
        },
      ),
      fetch(
        `${ESPN_PLAYER_BASE}/${athleteId}/gamelog?season=${season}`,
        {
          cache: "no-store",
          headers: { Accept: "application/json" },
        },
      ),
    ]);

    const statsPayload = statsResponse.ok
      ? await statsResponse.json()
      : null;

    const gameLogPayload = gameLogResponse.ok
      ? await gameLogResponse.json()
      : null;

    const seasonCategories: Array<{
      name: string;
      displayName: string;
      labels: string[];
      stats: string[];
    }> = [];

    for (const category of Array.isArray(statsPayload?.categories)
      ? statsPayload.categories
      : []) {
      const rows = Array.isArray(category?.statistics)
        ? category.statistics
        : [];

      const currentRow = rows.find(
        (row: {
          teamId?: string;
          season?: { year?: number };
        }) =>
          String(row?.teamId || "") === teamId &&
          Number(row?.season?.year) === season,
      );

      if (!currentRow || !Array.isArray(currentRow?.stats)) {
        continue;
      }

      seasonCategories.push({
        name: String(category?.name || ""),
        displayName: String(
          category?.displayName ||
            category?.name ||
            "Stats",
        ),
        labels: Array.isArray(category?.labels)
          ? category.labels.map(String)
          : [],
        stats: currentRow.stats.map(String),
      });
    }

    const eventStatMap = new Map<string, string[]>();

    for (const seasonType of Array.isArray(
      gameLogPayload?.seasonTypes,
    )
      ? gameLogPayload.seasonTypes
      : []) {
      for (const category of Array.isArray(
        seasonType?.categories,
      )
        ? seasonType.categories
        : []) {
        for (const eventRow of Array.isArray(category?.events)
          ? category.events
          : []) {
          if (!eventRow?.eventId || !Array.isArray(eventRow?.stats)) {
            continue;
          }

          eventStatMap.set(
            String(eventRow.eventId),
            eventRow.stats.map(String),
          );
        }
      }
    }

    const gameLogEvents: Array<{
      eventId: string;
      gameDate?: string;
      atVs?: string;
      gameResult?: string;
      score?: string;
      opponent?: {
        id?: string;
        abbreviation?: string;
        displayName?: string;
        shortDisplayName?: string;
      };
      stats: string[];
    }> = [];

    const events =
      gameLogPayload?.events &&
      typeof gameLogPayload.events === "object"
        ? Object.values(gameLogPayload.events)
        : [];

    for (const rawEvent of events) {
      if (!rawEvent || typeof rawEvent !== "object") continue;

      const event = rawEvent as {
        id?: string;
        gameDate?: string;
        atVs?: string;
        gameResult?: string;
        score?: string;
        homeTeamId?: string;
        awayTeamId?: string;
        opponent?: {
          id?: string;
          abbreviation?: string;
          displayName?: string;
          shortDisplayName?: string;
        };
      };

      const involved =
        String(event.homeTeamId || "") === teamId ||
        String(event.awayTeamId || "") === teamId;

      if (!involved || !event.id) continue;

      gameLogEvents.push({
        eventId: String(event.id),
        gameDate: event.gameDate,
        atVs: event.atVs,
        gameResult: event.gameResult,
        score: event.score,
        opponent: event.opponent,
        stats: eventStatMap.get(String(event.id)) || [],
      });
    }

    gameLogEvents.sort(
      (a, b) =>
        new Date(b.gameDate || 0).getTime() -
        new Date(a.gameDate || 0).getTime(),
    );

    return NextResponse.json({
      success: true,
      athleteId,
      teamId,
      season,
      seasonCategories,
      gameLog: {
        labels: Array.isArray(gameLogPayload?.labels)
          ? gameLogPayload.labels.map(String)
          : [],
        displayNames: Array.isArray(gameLogPayload?.displayNames)
          ? gameLogPayload.displayNames.map(String)
          : [],
        events: gameLogEvents,
      },
    });
  } catch (error) {
    console.error("Failed to load NCAA player detail", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to load player details.",
      },
      { status: 500 },
    );
  }
}
