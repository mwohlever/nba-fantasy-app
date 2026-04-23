export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(request: NextRequest) {
  try {
    const playerIdParam = request.nextUrl.searchParams.get("playerId");
    const seasonParam = request.nextUrl.searchParams.get("season") ?? "2026";
    const limitParam = request.nextUrl.searchParams.get("limit") ?? "10";

    if (!playerIdParam) {
      return NextResponse.json(
        { error: "playerId is required." },
        { status: 400, headers: { "Cache-Control": "no-store, max-age=0" } }
      );
    }

    const playerId = Number(playerIdParam);
    const limit = Number(limitParam);

    if (!Number.isFinite(playerId)) {
      return NextResponse.json(
        { error: "playerId must be a valid number." },
        { status: 400, headers: { "Cache-Control": "no-store, max-age=0" } }
      );
    }

    if (!Number.isFinite(limit) || limit <= 0) {
      return NextResponse.json(
        { error: "limit must be a positive number." },
        { status: 400, headers: { "Cache-Control": "no-store, max-age=0" } }
      );
    }

    const seasonStart = `${seasonParam}-01-01`;
    const seasonEnd = `${seasonParam}-12-31`;

    const { data, error } = await supabaseAdmin
      .from("player_slate_stats")
      .select(`
        slate_id,
        player_id,
        fantasy_points,
        points,
        rebounds,
        assists,
        steals,
        blocks,
        turnovers,
        slates!inner (
          id,
          date,
          start_date,
          end_date,
          is_locked
        )
      `)
      .eq("player_id", playerId)
      .gte("slates.date", seasonStart)
      .lte("slates.date", seasonEnd)
      .order("date", { foreignTable: "slates", ascending: false })
      .limit(limit);

    if (error) {
      return NextResponse.json(
        { error: `Failed to load player history detail: ${error.message}` },
        { status: 500, headers: { "Cache-Control": "no-store, max-age=0" } }
      );
    }

const history = (data ?? [])
  .map((row) => {
    const slate = Array.isArray(row.slates) ? row.slates[0] : row.slates;

    return {
      slateId: row.slate_id,
      playerId: row.player_id,
      date: slate?.date ?? null,
      fantasyPoints: Number(row.fantasy_points ?? 0),
      points: Number(row.points ?? 0),
      rebounds: Number(row.rebounds ?? 0),
      assists: Number(row.assists ?? 0),
      steals: Number(row.steals ?? 0),
      blocks: Number(row.blocks ?? 0),
      turnovers: Number(row.turnovers ?? 0),
      isLocked: !!slate?.is_locked,
    };
  })
  .sort((a, b) => {
    const aTime = a.date ? new Date(a.date).getTime() : 0;
    const bTime = b.date ? new Date(b.date).getTime() : 0;
    return bTime - aTime;
  });
    return NextResponse.json(
      { success: true, history },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Unexpected server error while loading player history detail." },
      { status: 500, headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  }
}
