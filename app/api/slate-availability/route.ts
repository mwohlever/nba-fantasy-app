export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type SlateRecord = {
  id: number;
  start_date: string;
  end_date: string;
};

type ScoreboardV3Team = {
  teamTricode?: string;
  tricode?: string;
  teamCode?: string;
};

type ScoreboardV3Game = {
  homeTeam?: ScoreboardV3Team;
  awayTeam?: ScoreboardV3Team;
};

type ScoreboardV3Payload = {
  scoreboard?: {
    games?: ScoreboardV3Game[];
  };
  games?: ScoreboardV3Game[];
};

function buildDateRange(startDate: string, endDate: string) {
  const result: string[] = [];
  const current = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);

  while (current <= end) {
    const year = current.getFullYear();
    const month = String(current.getMonth() + 1).padStart(2, "0");
    const day = String(current.getDate()).padStart(2, "0");
    result.push(`${year}-${month}-${day}`);
    current.setDate(current.getDate() + 1);
  }

  return result;
}

function formatForNbaStats(gameDateIso: string) {
  const [year, month, day] = gameDateIso.split("-");
  return `${month}/${day}/${year}`;
}

function getGamesFromPayload(payload: ScoreboardV3Payload) {
  return payload.scoreboard?.games ?? payload.games ?? [];
}

function normalizeTeamCode(raw: string | null) {
  if (!raw) return null;

  const code = raw.trim().toUpperCase();
  if (!code) return null;

  const aliasMap: Record<string, string> = {
    PHO: "PHX",
    BRK: "BKN",
    UTH: "UTA",
    GS: "GSW",
    SA: "SAS",
    NO: "NOP",
  };

  return aliasMap[code] ?? code;
}

function getTeamTricode(team?: ScoreboardV3Team) {
  const raw = team?.teamTricode ?? team?.tricode ?? team?.teamCode ?? null;
  return normalizeTeamCode(typeof raw === "string" ? raw : null);
}

async function fetchScoreboardForDate(gameDateIso: string) {
  const formattedDate = formatForNbaStats(gameDateIso);

  const url = `https://stats.nba.com/stats/scoreboardv3?GameDate=${encodeURIComponent(
    formattedDate
  )}&LeagueID=00`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9",
      Connection: "keep-alive",
      Origin: "https://www.nba.com",
      Referer: "https://www.nba.com/",
      "User-Agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Scoreboard request failed for ${formattedDate} with status ${response.status}: ${text}`
    );
  }

  return (await response.json()) as ScoreboardV3Payload;
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
    const dates = buildDateRange(safeSlate.start_date, safeSlate.end_date);

    const activeTeamCodes = new Set<string>();

    for (const gameDate of dates) {
      try {
        const payload = await fetchScoreboardForDate(gameDate);
        const games = getGamesFromPayload(payload);

        for (const game of games) {
          const homeCode = getTeamTricode(game.homeTeam);
          const awayCode = getTeamTricode(game.awayTeam);

          if (homeCode) activeTeamCodes.add(homeCode);
          if (awayCode) activeTeamCodes.add(awayCode);
        }
      } catch (error) {
        console.error(`Failed loading scoreboard for ${gameDate}:`, error);
      }
    }

    const normalizedTeamCodes = Array.from(activeTeamCodes).sort();

    if (normalizedTeamCodes.length === 0) {
      return NextResponse.json(
        {
          success: true,
          slateId,
          startDate: safeSlate.start_date,
          endDate: safeSlate.end_date,
          debugTeamAbbreviations: [],
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
      .in("team_abbreviation", normalizedTeamCodes);

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
        debugTeamAbbreviations: normalizedTeamCodes,
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
