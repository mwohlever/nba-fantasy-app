import { NextRequest, NextResponse } from "next/server";

import {
  calculateCorrectionFantasyPoints,
  type CorrectionSport,
} from "@/lib/corrections/correctionPolicy";
import { recomputeCorrectedSlateResults } from "@/lib/corrections/recomputeSlateResults";
import { resolveLeagueRules } from "@/lib/rules/leagueRules";
import { authorizeSlateResource } from "@/lib/security/resourceAuthorization";
import { getStatColumns } from "@/lib/statColumns";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const slateId = Number(body.slateId);
    const playerId = Number(body.playerId);

    if (!Number.isInteger(slateId) || !Number.isInteger(playerId)) {
      return NextResponse.json(
        { error: "Valid slateId and playerId required" },
        { status: 400 },
      );
    }

    const authorization = await authorizeSlateResource(request, slateId, {
      requireCommissioner: true,
    });
    if (!authorization.ok) return authorization.response;

    const sport = authorization.target.sportKey as CorrectionSport;
    if (sport !== "nba" && sport !== "nfl") {
      return NextResponse.json(
        { error: "Manual stat corrections are supported for NBA and NFL slates." },
        { status: 400 },
      );
    }

    const [{ data: slate, error: slateError }, { data: player, error: playerError }] =
      await Promise.all([
        supabaseAdmin
          .from("slates")
          .select("rules_snapshot")
          .eq("id", slateId)
          .eq("league_id", authorization.target.leagueId)
          .maybeSingle(),
        supabaseAdmin
          .from(sport === "nfl" ? "players_nfl" : "players")
          .select(sport === "nfl" ? "id, position" : "id")
          .eq("id", playerId)
          .maybeSingle(),
      ]);

    if (slateError || !slate) {
      return NextResponse.json({ error: "Slate not found." }, { status: 404 });
    }
    if (playerError) {
      return NextResponse.json({ error: playerError.message }, { status: 500 });
    }
    if (!player) {
      return NextResponse.json({ error: "Player not found for this sport." }, { status: 404 });
    }
    if (sport === "nfl" && "position" in player && player.position === "D/ST") {
      return NextResponse.json(
        { error: "D/ST component stats are not stored for manual correction." },
        { status: 400 },
      );
    }

    const statValues = Object.fromEntries(
      getStatColumns(sport).map(({ key }) => [key, Number(body.stats?.[key] ?? body[key] ?? 0)]),
    );
    const scoring = resolveLeagueRules({ sport, settings: slate.rules_snapshot }).scoring;
    const fantasyPoints = Number(
      calculateCorrectionFantasyPoints({ sport, stats: statValues, scoring }).toFixed(1),
    );
    const statsTable = sport === "nfl" ? "player_nfl_slate_stats" : "player_slate_stats";
    const { error: upsertError } = await supabaseAdmin.from(statsTable).upsert(
      {
        slate_id: slateId,
        player_id: playerId,
        ...statValues,
        fantasy_points: fantasyPoints,
      },
      { onConflict: "slate_id,player_id" },
    );

    if (upsertError) {
      return NextResponse.json({ error: upsertError.message }, { status: 500 });
    }

    await recomputeCorrectedSlateResults(slateId, sport);

    return NextResponse.json({ success: true, slateId, playerId, fantasyPoints });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Unexpected server error" }, { status: 500 });
  }
}
