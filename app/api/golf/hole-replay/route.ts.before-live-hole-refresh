import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { fetchGolfHoleReplay } from "@/lib/providers/pgaTourShots";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SlateRow = {
  id: number;
  sport: string;
  display_name: string | null;
  start_date: string;
};

type PlayerRow = {
  id: number;
  display_name: string;
};

function positiveInteger(value: string | null) {
  if (!value) return null;

  const parsed = Number(value);

  return Number.isInteger(parsed) &&
    parsed > 0
    ? parsed
    : null;
}

function noStoreHeaders() {
  return {
    "Cache-Control":
      "private, no-store, max-age=0",
  };
}

export async function GET(
  request: NextRequest,
) {
  try {
    const slateId = positiveInteger(
      request.nextUrl.searchParams.get(
        "slateId",
      ),
    );

    const playerId = positiveInteger(
      request.nextUrl.searchParams.get(
        "playerId",
      ),
    );

    const roundNumber = positiveInteger(
      request.nextUrl.searchParams.get(
        "round",
      ),
    );

    const holeNumber = positiveInteger(
      request.nextUrl.searchParams.get(
        "hole",
      ),
    );

    if (
      !slateId ||
      !playerId ||
      !roundNumber ||
      roundNumber > 4 ||
      !holeNumber ||
      holeNumber > 18
    ) {
      return NextResponse.json(
        {
          error:
            "Valid slateId, playerId, round, and hole parameters are required.",
        },
        {
          status: 400,
          headers: noStoreHeaders(),
        },
      );
    }

    const [
      {
        data: slateData,
        error: slateError,
      },
      {
        data: playerData,
        error: playerError,
      },
    ] = await Promise.all([
      supabaseAdmin
        .from("slates")
        .select(
          "id, sport, display_name, start_date",
        )
        .eq("id", slateId)
        .single(),

      supabaseAdmin
        .from("golf_players")
        .select("id, display_name")
        .eq("id", playerId)
        .single(),
    ]);

    if (
      slateError ||
      !slateData
    ) {
      return NextResponse.json(
        {
          error:
            "Golf slate was not found.",
        },
        {
          status: 404,
          headers: noStoreHeaders(),
        },
      );
    }

    if (
      playerError ||
      !playerData
    ) {
      return NextResponse.json(
        {
          error:
            "Golf player was not found.",
        },
        {
          status: 404,
          headers: noStoreHeaders(),
        },
      );
    }

    const slate =
      slateData as SlateRow;

    const player =
      playerData as PlayerRow;

    if (slate.sport !== "golf") {
      return NextResponse.json(
        {
          error:
            "Hole replay is only available for Golf slates.",
        },
        {
          status: 400,
          headers: noStoreHeaders(),
        },
      );
    }

    const tournamentName =
      slate.display_name?.trim();

    if (!tournamentName) {
      return NextResponse.json(
        {
          error:
            "This Golf slate does not have a tournament name.",
        },
        {
          status: 400,
          headers: noStoreHeaders(),
        },
      );
    }

    const year = Number(
      slate.start_date.slice(0, 4),
    );

    const replay =
      await fetchGolfHoleReplay({
        year,
        tournamentName,
        playerName:
          player.display_name,
        roundNumber,
        holeNumber,
      });

    if (!replay) {
      return NextResponse.json(
        {
          success: true,
          available: false,
          message:
            "Shot tracking is not available for this hole yet.",
          replay: null,
        },
        {
          headers: noStoreHeaders(),
        },
      );
    }

    return NextResponse.json(
      {
        success: true,
        available:
          replay.shots.length > 0,
        replay,
      },
      {
        headers: noStoreHeaders(),
      },
    );
  } catch (error) {
    console.error(
      "Unable to load Golf hole replay",
      error,
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to load hole replay.",
      },
      {
        status: 502,
        headers: noStoreHeaders(),
      },
    );
  }
}
