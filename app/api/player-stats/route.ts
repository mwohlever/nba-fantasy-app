import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(request: NextRequest) {
  try {
    const slateIdParam = request.nextUrl.searchParams.get("slateId");

    if (!slateIdParam) {
      return NextResponse.json(
        { error: "slateId is required." },
        { status: 400 }
      );
    }

    const slateId = Number(slateIdParam);

    if (!Number.isFinite(slateId)) {
      return NextResponse.json(
        { error: "slateId must be a valid number." },
        { status: 400 }
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
        fantasy_points
      `
      )
      .eq("slate_id", slateId)
      .order("player_id", { ascending: true });

    if (error) {
      return NextResponse.json(
        { error: `Failed to load player stats: ${error.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      playerStats: data ?? [],
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Unexpected server error while loading player stats." },
      { status: 500 }
    );
  }
}
