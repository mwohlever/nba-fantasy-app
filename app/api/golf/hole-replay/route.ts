import { reconcileGolf } from "@/lib/golf/reconcileGolf";
import { shotcastObservation } from "@/lib/golf/holeAcceptance";
import { authorizeSlateResource } from "@/lib/security/resourceAuthorization";
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

    const authorization = await authorizeSlateResource(request, slateId);
    if (!authorization.ok) return authorization.response;

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

    const refreshToken =
      request.nextUrl.searchParams.get(
        "refresh",
      );

    const observedAt = new Date().toISOString();
    const replay =
      await fetchGolfHoleReplay({
        year,
        tournamentName,
        playerName:
          player.display_name,
        roundNumber,
        holeNumber,
        cacheBust:
          refreshToken?.trim() || null,
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

    const { data: eventPlayer, error: eventError } = await supabaseAdmin
      .from("golf_event_players").select("id, golf_rounds(id, round_number)")
      .eq("slate_id", slateId).eq("player_id", playerId).maybeSingle();
    if (eventError) throw new Error(eventError.message);
    const round = eventPlayer?.golf_rounds.find(r => r.round_number === roundNumber);
    const observation = shotcastObservation({ holeNumber, par: replay.par, shots: replay.shots }, replay.observedAt);
    const accepted = await reconcileGolf(slateId, {
      observedAt, holes: round && observation ? [{ ...observation, round_id: Number(round.id) }] : [],
    });
    const acceptedRound = accepted.events.find(e => Number(e.player_id) === playerId)?.golf_rounds
      ?.find((r: { round_number: number }) => r.round_number === roundNumber);
    const hole = acceptedRound?.golf_holes?.find((h: { hole_number: number }) => h.hole_number === holeNumber);
    const reconciledHole = hole ? {
      hole_number: hole.hole_number, strokes: hole.strokes, relative_to_par: hole.relative_to_par,
      score_display: hole.score_display, holes_completed: acceptedRound.holes_completed,
      round_score_to_par: acceptedRound.score_to_par, round_strokes: acceptedRound.strokes,
      accepted_revision: acceptedRound.accepted_revision ?? 0,
    } : null;

    return NextResponse.json(
      {
        success: true,
        available:
          replay.shots.length > 0,
        replay,
        reconciledHole,
        acceptedRevision: accepted.revision,
        scoringChanged: accepted.scoringChanged,
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
