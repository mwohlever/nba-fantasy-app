import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getBracketContestLeaderboard } from "@/lib/bracket/leaderboard.server";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ contestId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  try {
    const { contestId } = await context.params;
    const leaderboard = await getBracketContestLeaderboard(user, contestId);
    if (!leaderboard) return NextResponse.json({ success: false, error: "Bracket Challenge not found for the active Group." }, { status: 404 });
    return NextResponse.json({ success: true, ...leaderboard }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Failed to load bracket leaderboard", error);
    return NextResponse.json({ success: false, error: "Unable to load Bracket Challenge leaderboard." }, { status: 500 });
  }
}
