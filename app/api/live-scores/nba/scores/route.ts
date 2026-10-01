import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getNbaLiveAccess } from "@/lib/live-scores/access";
import { nbaLiveContext } from "@/lib/live-scores/nbaContext";
import { fetchNbaLiveScores } from "@/lib/providers/nbaLiveScores";

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    const context = nbaLiveContext(request.nextUrl.searchParams.get("context"));
    const access = user ? await getNbaLiveAccess(user, context) : null;
    if (!access) return NextResponse.json({ error: `${context === "nba-skins" ? "NBA Skins" : "NBA"} is not enabled for this Group.` }, { status: 403 });
    const requestedGroupId = request.nextUrl.searchParams.get("groupId");
    if (requestedGroupId && requestedGroupId !== access.context.group.id) return NextResponse.json({ error: "The selected Group changed. Refreshing NBA scores." }, { status: 409 });
    const date = request.nextUrl.searchParams.get("date") ?? new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date()).replaceAll("-", "");
    return NextResponse.json({ success: true, date, games: await fetchNbaLiveScores(date) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load NBA scores." }, { status: 500 });
  }
}
