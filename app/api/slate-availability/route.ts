export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type SlateRecord = {
  id: number;
  start_date: string;
  end_date: string;
  nba_team_abbreviations: string[] | null;
};

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
      .select("id, start_date, end_date, nba_team_abbreviations")
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

    const normalizedTeamCodes = (safeSlate.nba_team_abbreviations ?? [])
      .map((code) => normalizeTeamCode(code))
      .filter((code): code is string => Boolean(code));

    if (normalizedTeamCodes.length === 0) {
      return NextResponse.json(
        {
          success: true,
          slateId,
          startDate: safeSlate.start_date,
          endDate: safeSlate.end_date,
          source: "database",
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
        source: "database",
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
