import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getActiveLeagueForSport } from "@/lib/groups/context";
import { nbaLiveContext } from "./nbaContext";
import { fetchProStandings } from "@/lib/providers/proStandings";
import { fetchNcaaStandings } from "@/lib/providers/ncaaStandings";

export function createStandingsHandler(sport: "nba" | "nfl" | "ncaa") {
  return async function GET(request: NextRequest) {
    try {
      const user = await getCurrentUser();
      if (!user) return NextResponse.json({ error: "Login required." }, { status: 401 });
      const params = request.nextUrl.searchParams;
      const context = sport === "nba" ? nbaLiveContext(params.get("context")) : sport;
      const access = await getActiveLeagueForSport(user, context === "nba-skins" ? "nba_skins" : sport === "ncaa" ? "ncaa_pickem" : sport);
      if (!access) return NextResponse.json({ error: "This sport is not enabled for this Group." }, { status: 403 });
      if ((params.has("viewerId") && params.get("viewerId") !== user.id)
        || (params.has("groupId") && params.get("groupId") !== access.context.group.id)
        || (params.has("leagueId") && params.get("leagueId") !== access.league.id)) {
        return NextResponse.json({ error: "The selected Group changed. Please refresh standings." }, { status: 409 });
      }
      const data = sport === "ncaa" ? await fetchNcaaStandings() : await fetchProStandings(sport);
      return NextResponse.json(data, { headers: { "Cache-Control": "private, no-store" } });
    } catch {
      return NextResponse.json({ error: "Unable to load current standings. Please try again." }, { status: 502 });
    }
  };
}
