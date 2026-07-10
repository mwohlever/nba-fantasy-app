import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdminApi } from "@/lib/requireAdminApi";

function isoDateFromGameCode(gameCode: string | null | undefined) {
  const raw = String(gameCode ?? "").slice(0, 8);
  if (!/^\d{8}$/.test(raw)) return null;
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
}

function dateInSlateRange(gameDate: string | null, startDate: string, endDate: string) {
  if (!gameDate) return false;
  return gameDate >= startDate && gameDate <= endDate;
}

export async function GET(request: NextRequest) {
  const authError = await requireAdminApi();
  if (authError) return authError;

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
  const authError = await requireAdminApi();
  if (authError) return authError;

  const body = await request.json();
  const slateId = Number(body.slateId);

  if (!slateId) {
    return NextResponse.json({ error: "slateId required" }, { status: 400 });
  }

  // Pull games for the selected slate date range.
  if (body.action === "pullToday") {
    const { data: slate, error: slateError } = await supabaseAdmin
      .from("slates")
      .select("id,start_date,end_date")
      .eq("id", slateId)
      .single();

    if (slateError || !slate) {
      return NextResponse.json({ error: "Slate not found." }, { status: 404 });
    }

    const r = await fetch(
      "https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json",
      { cache: "no-store" }
    );

    const j = await r.json();
    const games = j?.scoreboard?.games ?? [];

    const rows = games
      .map((g: any) => {
        const gameDate = isoDateFromGameCode(g.gameCode);

        return {
          slate_id: slateId,
          game_id: String(g.gameId),
          game_code: g.gameCode ?? null,
          game_date: gameDate,
          note: `${g.awayTeam?.teamTricode} at ${g.homeTeam?.teamTricode}`,
        };
      })
      .filter((row: any) => dateInSlateRange(row.game_date, slate.start_date, slate.end_date));

    if (rows.length === 0) {
      return NextResponse.json({
        success: true,
        message: `No NBA games from the live scoreboard matched slate ${slate.start_date}${slate.end_date !== slate.start_date ? ` to ${slate.end_date}` : ""}. The NBA feed may still be showing yesterday’s games.`,
        savedGames: [],
      });
    }

    const { data, error } = await supabaseAdmin
      .from("slate_nba_games")
      .upsert(rows, { onConflict: "slate_id,game_id" })
      .select();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: `Saved ${rows.length} game(s) for selected slate.`,
      savedGames: data,
    });
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
