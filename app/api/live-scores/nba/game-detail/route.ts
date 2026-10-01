import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getNbaLiveAccess } from "@/lib/live-scores/access";
import { nbaLiveContext } from "@/lib/live-scores/nbaContext";
import { fetchNbaGameDetail } from "@/lib/live-scores/nbaGameDetail";
import { loadNbaOwnership } from "@/lib/live-scores/nbaOwnership.server";

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    const context = nbaLiveContext(request.nextUrl.searchParams.get("context"));
    const access = user ? await getNbaLiveAccess(user, context) : null;
    if (!access) return NextResponse.json({ error: `${context === "nba-skins" ? "NBA Skins" : "NBA"} is not enabled for this Group.` }, { status: 403 });
    const requestedGroupId = request.nextUrl.searchParams.get("groupId");
    if (requestedGroupId && requestedGroupId !== access.context.group.id) return NextResponse.json({ error: "The selected Group changed. Refreshing NBA Game Center." }, { status: 409 });
    const eventId = request.nextUrl.searchParams.get("eventId") ?? "";
    const detail = await fetchNbaGameDetail(eventId);
    // Skins shares the provider payload but never reads daily or annual rosters.
    if (context === "nba-skins") return NextResponse.json(detail, { headers: { "Cache-Control": "private, no-store" } });
    const ownership = await loadNbaOwnership(access, detail.header?.competitions?.[0]?.date ?? "", detail.boxscore).catch(() => null);
    return NextResponse.json({ ...detail, ownership }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load NBA game detail." }, { status: 500 });
  }
}
