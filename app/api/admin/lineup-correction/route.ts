import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { authorizeSlateResource } from "@/lib/security/resourceAuthorization";
import { recomputeCorrectedSlateResults } from "@/lib/corrections/recomputeSlateResults";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const slateId = Number(body.slateId);
    const teamId = Number(body.teamId);
    const action = String(body.action ?? "");
    const oldPlayerId = body.oldPlayerId ? Number(body.oldPlayerId) : null;
    const newPlayerId = body.newPlayerId ? Number(body.newPlayerId) : null;

    if (!Number.isFinite(slateId) || !Number.isFinite(teamId)) {
      return NextResponse.json(
        { error: "Valid slateId and teamId are required." },
        { status: 400 }
      );
    }

    const authorization = await authorizeSlateResource(
      request,
      slateId,
      { requireCommissioner: true },
    );

    if (!authorization.ok) return authorization.response;

    const sport = authorization.target.sportKey;
    if (sport !== "nba" && sport !== "nfl") {
      return NextResponse.json(
        { error: "Lineup corrections are supported for NBA and NFL slates." },
        { status: 400 }
      );
    }

    const { data: lineup, error: lineupError } = await supabaseAdmin
      .from("lineups")
      .select("id")
      .eq("slate_id", slateId)
      .eq("team_id", teamId)
      .maybeSingle();

    if (lineupError) {
      return NextResponse.json({ error: lineupError.message }, { status: 500 });
    }

    if (!lineup) {
      return NextResponse.json({ error: "Lineup not found." }, { status: 404 });
    }

    if (newPlayerId) {
      const { data: newPlayer, error: playerError } = await supabaseAdmin
        .from(sport === "nfl" ? "players_nfl" : "players")
        .select("id")
        .eq("id", newPlayerId)
        .maybeSingle();

      if (playerError) {
        return NextResponse.json({ error: playerError.message }, { status: 500 });
      }

      if (!newPlayer) {
        return NextResponse.json(
          { error: "Player not found for this sport." },
          { status: 404 }
        );
      }
    }

    if (action === "replace") {
      if (!oldPlayerId || !newPlayerId) {
        return NextResponse.json(
          { error: "oldPlayerId and newPlayerId are required for replace." },
          { status: 400 }
        );
      }

      const { error } = await supabaseAdmin
        .from("lineup_players")
        .update({ player_id: newPlayerId })
        .eq("lineup_id", lineup.id)
        .eq("player_id", oldPlayerId);

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    } else if (action === "add") {
      if (!newPlayerId) {
        return NextResponse.json(
          { error: "newPlayerId is required for add." },
          { status: 400 }
        );
      }

      const { error } = await supabaseAdmin
        .from("lineup_players")
        .insert({ lineup_id: lineup.id, player_id: newPlayerId });

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    } else if (action === "remove") {
      if (!oldPlayerId) {
        return NextResponse.json(
          { error: "oldPlayerId is required for remove." },
          { status: 400 }
        );
      }

      const { error } = await supabaseAdmin
        .from("lineup_players")
        .delete()
        .eq("lineup_id", lineup.id)
        .eq("player_id", oldPlayerId);

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    } else {
      return NextResponse.json(
        { error: "Invalid action. Use add, replace, or remove." },
        { status: 400 }
      );
    }

    await recomputeCorrectedSlateResults(slateId, sport);

    return NextResponse.json({
      success: true,
      slateId,
      teamId,
      action,
      oldPlayerId,
      newPlayerId,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Unexpected server error while correcting lineup." },
      { status: 500 }
    );
  }
}
