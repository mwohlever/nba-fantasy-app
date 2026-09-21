import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { isValidBracketGameCenterEvent } from "@/lib/bracket/gameCenter.server";
import { getBracketContestLiveScores } from "@/lib/bracket/liveScores.server";
import { createFootballGameDetailHandler } from "@/lib/live-scores/game-detail";

export const dynamic = "force-dynamic";

function requestedEventId(request: NextRequest) {
  const eventId = new URL(request.url).searchParams.get("eventId");
  return eventId && /^\d+$/.test(eventId) ? eventId : null;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ contestId: string }> },
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { error: "Login required." },
        { status: 401, headers: { "Cache-Control": "no-store" } },
      );
    }

    const eventId = requestedEventId(request);
    if (!eventId) {
      return NextResponse.json(
        { error: "A valid ESPN event ID is required." },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }

    const { contestId } = await context.params;
    const liveScores = await getBracketContestLiveScores(user, contestId);
    if (!liveScores) {
      return NextResponse.json(
        { error: "Bracket Challenge not found for the active Group." },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }

    const developmentHarness =
      process.env.NODE_ENV !== "production" &&
      new URL(request.url).searchParams.get("devGameCenter") === "1";
    const productionEvent = isValidBracketGameCenterEvent(liveScores, eventId);

    if (!developmentHarness && !productionEvent) {
      return NextResponse.json(
        { error: "This game is not available for the Bracket Challenge." },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }

    // The shared handler owns the ESPN summary request and all Game Center
    // normalization. Authorization and event validation have completed above.
    const handler = createFootballGameDetailHandler(
      "college-football",
      async () => ({ contestId }),
    );

    const response = await handler(request);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    console.error("Failed to load Bracket Challenge game detail", error);
    return NextResponse.json(
      { error: "Unable to load Bracket Challenge game detail." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
