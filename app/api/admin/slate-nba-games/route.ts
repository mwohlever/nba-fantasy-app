import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function isoDateFromGameCode(gameCode: string | null | undefined) {
  const raw = String(gameCode ?? "").slice(0, 8);
  if (!/^\d{8}$/.test(raw)) return null;
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
}

export async function GET(request: NextRequest) {
  const slateId = Number(request.nextUrl.searchParams.get("slateId") ?? "");

  const { data: slates } = await supabaseAdmin
    .from("slates")
    .select("id,start_date,end_date")
    .order("start_date", { ascending: false })
    .limit(20);

  let savedGames: any[] = [];

  if (slateId) {
    const { data } = await supabaseAdmin
      .from("slate_nba_games")
      .select("*")
      .eq("slate_id", slateId)
      .order("game_date");

    savedGames = data ?? [];
  }

  return NextResponse.json({
    success: true,
    slates,
    savedGames,
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const slateId = Number(body.slateId);

  if (!slateId) {
    return NextResponse.json({ error: "slateId required" }, { status: 400 });
  }

  // Pull today's games
  if (body.action === "pullToday") {
    const r = await fetch(
      "https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json",
      { cache: "no-store" }
    );

    const j = await r.json();
    const games = j?.scoreboard?.games ?? [];

    const rows = games.map((g: any) => ({
      slate_id: slateId,
      game_id: String(g.gameId),
      game_code: g.gameCode ?? null,
      game_date: isoDateFromGameCode(g.gameCode),
      note: `${g.awayTeam?.teamTricode} at ${g.homeTeam?.teamTricode}`,
    }));

    const { data } = await supabaseAdmin
      .from("slate_nba_games")
      .upsert(rows, { onConflict: "slate_id,game_id" })
      .select();

    return NextResponse.json({ success: true, savedGames: data });
  }

  // Manual add
  if (body.action === "manual") {
    const { gameId, gameCode, note } = body;

    const row = {
      slate_id: slateId,
      game_id: gameId,
      game_code: gameCode,
      game_date: isoDateFromGameCode(gameCode),
      note: note ?? null,
    };

    const { data } = await supabaseAdmin
      .from("slate_nba_games")
      .upsert(row, { onConflict: "slate_id,game_id" })
      .select();

    return NextResponse.json({ success: true, savedGames: data });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
