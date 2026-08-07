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

function relativeScoreDisplay(
  relativeToPar: number,
) {
  if (relativeToPar === 0) {
    return "E";
  }

  return relativeToPar > 0
    ? `+${relativeToPar}`
    : String(relativeToPar);
}

async function reconcileCompletedReplayHole(input: {
  slateId: number;
  playerId: number;
  roundNumber: number;
  holeNumber: number;
  replay: {
    par: number | null;
    shots: Array<{
      strokeNumber: number;
      finalStroke: boolean;
    }>;
  };
}) {
  /*
   * Only persist a hole when PGA explicitly identifies a final
   * stroke. A live/current-ball hole must never be promoted to
   * a completed scorecard result.
   */
  const finalShot =
    input.replay.shots.find(
      (shot) => shot.finalStroke,
    ) ?? null;

  if (!finalShot) {
    return null;
  }

  const strokes = Math.max(
    ...input.replay.shots.map(
      (shot) => Number(shot.strokeNumber ?? 0),
    ),
  );

  if (
    !Number.isFinite(strokes) ||
    strokes <= 0 ||
    input.replay.par === null ||
    !Number.isFinite(Number(input.replay.par))
  ) {
    return null;
  }

  const par = Number(input.replay.par);
  const relativeToPar =
    strokes - par;

  const {
    data: eventPlayer,
    error: eventPlayerError,
  } = await supabaseAdmin
    .from("golf_event_players")
    .select(
      "id, status, rounds_completed",
    )
    .eq("slate_id", input.slateId)
    .eq("player_id", input.playerId)
    .maybeSingle();

  if (
    eventPlayerError ||
    !eventPlayer
  ) {
    if (eventPlayerError) {
      console.warn(
        "ShotCast reconciliation could not resolve event player",
        eventPlayerError.message,
      );
    }

    return null;
  }

  const {
    data: round,
    error: roundError,
  } = await supabaseAdmin
    .from("golf_rounds")
    .select("id")
    .eq(
      "event_player_id",
      Number(eventPlayer.id),
    )
    .eq(
      "round_number",
      input.roundNumber,
    )
    .maybeSingle();

  if (
    roundError ||
    !round
  ) {
    if (roundError) {
      console.warn(
        "ShotCast reconciliation could not resolve Golf round",
        roundError.message,
      );
    }

    return null;
  }

  const roundId =
    Number(round.id);

  const {
    data: existingHole,
    error: existingHoleError,
  } = await supabaseAdmin
    .from("golf_holes")
    .select("round_id, hole_number")
    .eq("round_id", roundId)
    .eq(
      "hole_number",
      input.holeNumber,
    )
    .maybeSingle();

  if (existingHoleError) {
    console.warn(
      "ShotCast reconciliation could not inspect existing hole",
      existingHoleError.message,
    );

    return null;
  }

  const holeRow = {
    round_id: roundId,
    hole_number:
      input.holeNumber,
    strokes,
    relative_to_par:
      relativeToPar,
    score_display:
      relativeScoreDisplay(
        relativeToPar,
      ),
    updated_at:
      new Date().toISOString(),
  };

  /*
   * Use one idempotent write for both the initial insert and later
   * refreshes. Hole Replay can issue overlapping requests while a
   * hole is live; upsert prevents two completed-hole requests from
   * racing into the golf_holes unique constraint.
   */
  const holeMutation =
    await supabaseAdmin
      .from("golf_holes")
      .upsert(
        holeRow,
        {
          onConflict:
            "round_id,hole_number",
        },
      );

  if (holeMutation.error) {
    console.warn(
      "ShotCast reconciliation could not persist completed hole",
      holeMutation.error.message,
    );

    return null;
  }

  /*
   * Recalculate the round from every persisted completed hole.
   * This lets the scorecard immediately advance from ESPN's
   * stale "Thru 7" to PGA's authoritative Hole 8 result.
   */
  const {
    data: roundHoles,
    error: roundHolesError,
  } = await supabaseAdmin
    .from("golf_holes")
    .select(
      "hole_number, strokes, relative_to_par",
    )
    .eq("round_id", roundId);

  if (roundHolesError) {
    console.warn(
      "ShotCast reconciliation could not recalculate round",
      roundHolesError.message,
    );

    return null;
  }

  const completedHoles =
    (roundHoles ?? []).filter(
      (hole) =>
        hole.strokes !== null &&
        hole.strokes !== undefined,
    );

  const holesCompleted =
    completedHoles.length;

  const roundStrokes =
    completedHoles.reduce(
      (sum, hole) =>
        sum +
        Number(
          hole.strokes ?? 0,
        ),
      0,
    );

  const roundToPar =
    completedHoles.reduce(
      (sum, hole) =>
        sum +
        Number(
          hole.relative_to_par ?? 0,
        ),
      0,
    );

  const roundFinished =
    holesCompleted >= 18;

  const {
    error: roundUpdateError,
  } = await supabaseAdmin
    .from("golf_rounds")
    .update({
      strokes:
        holesCompleted > 0
          ? roundStrokes
          : null,
      score_to_par:
        holesCompleted > 0
          ? roundToPar
          : null,
      score_display:
        holesCompleted > 0
          ? relativeScoreDisplay(
              roundToPar,
            )
          : null,
      holes_completed:
        holesCompleted,
      status:
        roundFinished
          ? "finished"
          : "active",
      updated_at:
        new Date().toISOString(),
    })
    .eq("id", roundId);

  if (roundUpdateError) {
    console.warn(
      "ShotCast reconciliation could not update Golf round",
      roundUpdateError.message,
    );
  }

  const terminalStatuses =
    new Set([
      "finished",
      "cut",
      "withdrawn",
      "disqualified",
      "did_not_start",
    ]);

  if (
    !terminalStatuses.has(
      String(
        eventPlayer.status ?? "",
      ).toLowerCase(),
    )
  ) {
    const {
      data: allRounds,
      error: allRoundsError,
    } = await supabaseAdmin
      .from("golf_rounds")
      .select(
        "round_number, holes_completed",
      )
      .eq(
        "event_player_id",
        Number(eventPlayer.id),
      );

    if (!allRoundsError) {
      const totalHoles =
        (allRounds ?? []).reduce(
          (sum, row) =>
            sum +
            Number(
              row.holes_completed ?? 0,
            ),
          0,
        );

      const roundsCompleted =
        (allRounds ?? []).filter(
          (row) =>
            Number(
              row.holes_completed ?? 0,
            ) >= 18,
        ).length;

      await supabaseAdmin
        .from("golf_event_players")
        .update({
          holes_completed:
            totalHoles,
          rounds_completed:
            Math.max(
              roundsCompleted,
              Number(
                eventPlayer.rounds_completed ??
                  0,
              ),
            ),
          current_round:
            input.roundNumber,
          last_hole:
            input.holeNumber,
          status:
            roundFinished
              ? "round_complete"
              : "active",
          updated_at:
            new Date().toISOString(),
        })
        .eq(
          "id",
          Number(
            eventPlayer.id,
          ),
        );
    }
  }

  console.log(
    "ShotCast completed-hole reconciliation",
    {
      slateId:
        input.slateId,
      playerId:
        input.playerId,
      round:
        input.roundNumber,
      hole:
        input.holeNumber,
      strokes,
      relativeToPar,
      holesCompleted,
    },
  );

  return {
    hole_number:
      input.holeNumber,
    strokes,
    relative_to_par:
      relativeToPar,
    score_display:
      relativeScoreDisplay(
        relativeToPar,
      ),
    holes_completed:
      holesCompleted,
    round_score_to_par:
      roundToPar,
    round_strokes:
      roundStrokes,
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

    const refreshToken =
      request.nextUrl.searchParams.get(
        "refresh",
      );

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

    const reconciledHole =
      await reconcileCompletedReplayHole({
        slateId,
        playerId,
        roundNumber,
        holeNumber,
        replay,
      });

    return NextResponse.json(
      {
        success: true,
        available:
          replay.shots.length > 0,
        replay,
        reconciledHole,
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
