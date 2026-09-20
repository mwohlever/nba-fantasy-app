import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getActiveLeagueForSport } from "@/lib/groups/context";
import { fetchNbaLiveScores } from "@/lib/providers/nbaLiveScores";

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user || !await getActiveLeagueForSport(user, "nba")) return NextResponse.json({ error: "NBA is not enabled for this Group." }, { status: 403 });
    const date = request.nextUrl.searchParams.get("date") ?? new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date()).replaceAll("-", "");
    return NextResponse.json({ success: true, date, games: await fetchNbaLiveScores(date) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load NBA scores." }, { status: 500 });
  }
}
