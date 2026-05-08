import { NextRequest, NextResponse } from "next/server";
import { getPlayerProjectionsForSeason } from "@/lib/playerProjections";

export async function GET(req: NextRequest) {
  try {
    const season = req.nextUrl.searchParams.get("season") || "2026";
    const result = await getPlayerProjectionsForSeason(season);

    return NextResponse.json({
      season: result.season,
      nbaSeason: result.nbaSeason,
      count: Object.keys(result.projections).length,
      projections: result.projections,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load player projections." },
      { status: 500 }
    );
  }
}
