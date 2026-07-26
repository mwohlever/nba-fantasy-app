export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(request: NextRequest) {
  try {
    const slateIdParam = request.nextUrl.searchParams.get("slateId");

    if (!slateIdParam) {
      return NextResponse.json(
        { error: "slateId is required." },
        { status: 400, headers: { "Cache-Control": "no-store, max-age=0" } }
      );
    }

    const slateId = Number(slateIdParam);

    if (!Number.isFinite(slateId)) {
      return NextResponse.json(
        { error: "slateId must be a valid number." },
        { status: 400, headers: { "Cache-Control": "no-store, max-age=0" } }
      );
    }

    const { data: slate, error: slateError } = await supabaseAdmin
      .from("slates")
      .select("sport")
      .eq("id", slateId)
      .maybeSingle();

    if (slateError) {
      return NextResponse.json(
        { error: `Failed to load slate: ${slateError.message}` },
        { status: 500, headers: { "Cache-Control": "no-store, max-age=0" } }
      );
    }

    const sport = slate?.sport === "nfl" ? "nfl" : "nba";

    if (sport === "nfl") {
      const { data, error } = await supabaseAdmin
        .from("player_nfl_slate_stats")
        .select(
          `
          player_id,
          passing_yards,
          passing_tds,
          passing_ints,
          rushing_yards,
          rushing_tds,
          receiving_yards,
          receiving_tds,
          receptions,
          fumbles_lost,
          fantasy_points,
          game_status,
          game_status_text
        `
        )
        .eq("slate_id", slateId)
        .order("player_id", { ascending: true });

      if (error) {
        return NextResponse.json(
          { error: `Failed to load player stats: ${error.message}` },
          { status: 500, headers: { "Cache-Control": "no-store, max-age=0" } }
        );
      }

      return NextResponse.json(
        { success: true, sport, playerStats: data ?? [] },
        { headers: { "Cache-Control": "no-store, max-age=0" } }
      );
    }

    const { data, error } = await supabaseAdmin
      .from("player_slate_stats")
      .select(
        `
        player_id,
        points,
        rebounds,
        assists,
        steals,
        blocks,
        turnovers,
        fantasy_points,
        game_status,
        game_status_text,
        period,
        game_clock
      `
      )
      .eq("slate_id", slateId)
      .order("player_id", { ascending: true });

    if (error) {
      return NextResponse.json(
        { error: `Failed to load player stats: ${error.message}` },
        { status: 500, headers: { "Cache-Control": "no-store, max-age=0" } }
      );
    }

    return NextResponse.json(
      { success: true, sport, playerStats: data ?? [] },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Unexpected server error while loading player stats." },
      { status: 500, headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  }
}
