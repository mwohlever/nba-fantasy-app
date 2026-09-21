import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { getBracketContestLiveScores } from "@/lib/bracket/liveScores.server";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: {
    params: Promise<{ contestId: string }>;
  },
) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401, headers: { "Cache-Control": "no-store" } },
      );
    }

    const { contestId } = await context.params;
    const liveScores = await getBracketContestLiveScores(user, contestId);

    if (!liveScores) {
      return NextResponse.json(
        {
          success: false,
          error: "Bracket Challenge not found for the active Group.",
        },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }

    return NextResponse.json(
      { success: true, ...liveScores },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Failed to load Bracket Challenge live scores", error);

    return NextResponse.json(
      { success: false, error: "Unable to load Bracket Challenge live scores." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
