import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getNflLiveAccess } from "@/lib/live-scores/access";
import { fetchNflLiveScores } from "@/lib/providers/nflLiveScores";

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Login required." }, { status: 401 });
    const access = await getNflLiveAccess(user);
    if (!access) return NextResponse.json({ error: "NFL is not enabled for this Group." }, { status: 404 });
    const params = request.nextUrl.searchParams;
    if ((params.has("viewerId") && params.get("viewerId") !== user.id) ||
        (params.has("leagueId") && params.get("leagueId") !== access.league.id) ||
        (params.has("groupId") && params.get("groupId") !== access.context.group.id)) {
      return NextResponse.json({ error: "The NFL Live viewing context changed. Return to games and try again." }, { status: 409 });
    }
    const season = Number(params.get("season"));
    const seasonType = Number(params.get("seasonType"));
    const week = Number(params.get("week"));
    const specified = ["season", "seasonType", "week"].some((key) => params.has(key));
    if (specified && (!Number.isInteger(season) || season < 2000 || season > 2100 || ![1, 2, 3].includes(seasonType) || !Number.isInteger(week) || week < 1 || week > 18)) {
      return NextResponse.json({ error: "Valid season, season type, and week are required." }, { status: 400 });
    }
    return NextResponse.json({ success: true, ...await fetchNflLiveScores(specified ? { season, seasonType, week } : undefined) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("NFL Live Scores failed", error);
    return NextResponse.json({ error: "Unable to load NFL Live Scores. Please try again." }, { status: 502 });
  }
}
