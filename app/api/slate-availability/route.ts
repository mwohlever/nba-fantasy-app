export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type SlateRecord = {
  id: number;
  start_date: string;
  end_date: string;
};

type ScoreboardTeam = {
  teamTricode?: string;
  tricode?: string;
  teamCode?: string;
};

type ScoreboardGame = {
  gameId?: string;
  gameCode?: string;
  homeTeam?: ScoreboardTeam;
  awayTeam?: ScoreboardTeam;
};

type ScoreboardPayload = {
  scoreboard?: {
    games?: ScoreboardGame[];
  };
  games?: ScoreboardGame[];
};

function buildDateCodeRange(startDate: string, endDate: string) {
  const result: string[] = [];
  const current = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);

  while (current <= end) {
    const year = current.getFullYear();
    const month = String(current.getMonth() + 1).padStart(2, "0");
    const day = String(current.getDate()).padStart(2, "0");
    result.push(`${year}${month}${day}`);
    current.setDate(current.getDate() + 1);
  }

  return result;
}

function getGamesFromPayload(payload: ScoreboardPayload) {
  return payload.scoreboard?.games ?? payload.games ?? [];
}

function getTeamTricode(team?: ScoreboardTeam) {
  const raw = team?.teamTricode ?? team?.tricode ?? team?.teamCode ?? null;

  if (!raw || typeof raw !== "string") return null;

  const trimmed = raw.trim().toUpperCase();
  return trimmed === "" ? null : trimmed;
}

async function fetchScoreboardForDate(dateCode: string) {
  const url = `https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_${dateCode}.json`;

  const response = await fetch(url, {
    method: "GET",
    cache: "no-store",
  });

  if (!response.ok) {
    return null;
  }

  return (await response.json()) as ScoreboardPayload;
}

export async function GET(request: NextRequest) {
  try {
    const slateIdParam = request.nextUrl.searchParams.get("slateId");

    if (!slateIdParam) {
      return NextResponse.json(
        { error: "slateId is required." },
        {
          status: 400,
          headers: {
            "Cache-Control": "no-store, max-age=0",
          },
        }
      );
    }

    const slateId = Number(slateIdParam);

    if (!Number.isFinite(slateId)) {
      return NextResponse.json(
        { error: "slateId must be a valid number." },
        {
          status: 400,
          headers: {
            "Cache-Control": "no-store, max-age=0",
          },
        }
      );
    }

    const { data: slate, error: slateError } = await supabaseAdmin
      .from("slates")
      .select("id, start_date, end_date")
      .eq("id", slateId)
      .single();

    if (slateError || !slate) {
      return NextResponse.json(
        { error: "Slate not found." },
        {
          status: 404,
          headers: {
            "Cache-Control": "no-store, max-age=0",
          },
        }
      );
    }

    const safeSlate = slate as SlateRecord;
    const dateCodes = buildDateCodeRange(safeSlate.start_date, safeSlate.end_date);

    const activeTeamCodes = new Set<string>();

    for (const dateCode of dateCodes) {
      try {
        const payload = await fetchScoreboardForDate(dateCode);
        if (!payload) continue;

        const games = getGamesFromPayload(payload);

        for (const game of games) {
          const homeCode = getTeamTricode(game.homeTeam);
          const awayCode = getTeamTricode(game.awayTeam);

          if (homeCode) activeTeamCodes.add(homeCode);
          if (awayCode) activeTeamCodes.add(awayCode);
        }
      } catch (error) {
        console.error(`Failed loading scoreboard for ${dateCode}:`, error);
      }
    }

    if (activeTeamCodes.size === 0) {
      return NextResponse.json(
        {
          success: true,
          slateId,
          startDate: safeSlate.start_date,
          endDate: safeSlate.end_date,
          activeTeamAbbreviations: [],
          availablePlayerIds: [],
        },
        {
          headers: {
            "Cache-Control": "no-store, max-age=0",
          },
        }
      );
    }

    const { data: matchingPlayers, error: playersError } = await supabaseAdmin
      .from("players")
      .select("id, team_abbreviation")
      .eq("is_active", true)
      .in("team_abbreviation", Array.from(activeTeamCodes));

    if (playersError) {
      return NextResponse.json(
        { error: `Failed to load players for slate: ${playersError.message}` },
        {
          status: 500,
          headers: {
            "Cache-Control": "no-store, max-age=0",
          },
        }
      );
    }

    const availablePlayerIds = (matchingPlayers ?? [])
      .map((player) => player.id)
      .filter((id): id is number => typeof id === "number");

    return NextResponse.json(
      {
        success: true,
        slateId,
        startDate: safeSlate.start_date,
        endDate: safeSlate.end_date,
        activeTeamAbbreviations: Array.from(activeTeamCodes).sort(),
        availablePlayerIds,
      },
      {
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      }
    );
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Unexpected server error while loading slate availability." },
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      }
    );
  }
}
