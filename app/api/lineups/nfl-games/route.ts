import { NextRequest, NextResponse } from "next/server";
import { authorizeSlateResource } from "@/lib/security/resourceAuthorization";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { fetchScoreboardForRange } from "@/lib/providers/nfl";
import { normalizeNflGame } from "@/lib/providers/nflLiveScores";
import { nflSlateWindow, resolveNflFantasyGames } from "@/lib/live-scores/nflFantasyGames";

export async function GET(request: NextRequest) {
  const slateId = Number(request.nextUrl.searchParams.get("slateId"));
  if (!Number.isSafeInteger(slateId) || slateId <= 0) {
    return NextResponse.json({ error: "Valid slateId required." }, { status: 400 });
  }
  try {
    const authorization = await authorizeSlateResource(request, slateId);
    if (!authorization.ok) return authorization.response;
    const { data: slate, error } = await supabaseAdmin.from("slates")
      .select("id, sport, date, start_date, end_date")
      .eq("id", slateId).single();
    if (error || !slate || slate.sport !== "nfl") {
      return NextResponse.json({ error: "NFL slate not found." }, { status: 404 });
    }
    const window = nflSlateWindow(slate);
    if (!window) return NextResponse.json({ slateId, gamesByTeam: {} });
    const events = await fetchScoreboardForRange(window.start.replaceAll("-", ""), window.end.replaceAll("-", ""));
    const games = events.flatMap((event) => {
      // Do not inherit the Live Scores normalizer's default pregame state for missing status.
      const raw = event as Parameters<typeof normalizeNflGame>[0];
      const status = raw.competitions?.[0]?.status?.type ?? raw.status?.type;
      const game = normalizeNflGame(raw);
      const unavailable = /CANCELED|CANCELLED|POSTPONED|SUSPENDED/.test(status?.name ?? "");
      return game ? [{ ...game, status: unavailable ? "unknown" : status?.state ?? "unknown" }] : [];
    });
    const resolved = resolveNflFantasyGames(games, slate);
    return NextResponse.json({ slateId, gamesByTeam: Object.fromEntries(resolved) }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json({ error: "NFL slate games unavailable." }, { status: 502 });
  }
}
