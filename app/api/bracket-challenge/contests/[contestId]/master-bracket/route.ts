import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { getBracketChallengeDetail } from "@/lib/bracket/challenge.server";
import {
  getOrCreateMasterBracket,
  saveMasterBracketPick,
} from "@/lib/bracket/masterBracket.server";

export const dynamic = "force-dynamic";

async function resolveContext(
  contestId: string,
) {
  const user = await getCurrentUser();

  if (!user) {
    return {
      error: NextResponse.json(
        {
          success: false,
          error: "Unauthorized",
        },
        { status: 401 },
      ),
    };
  }

  const challenge =
    await getBracketChallengeDetail(
      user,
      contestId,
    );

  if (!challenge) {
    return {
      error: NextResponse.json(
        {
          success: false,
          error:
            "Bracket Challenge not found for the active Group.",
        },
        { status: 404 },
      ),
    };
  }

  return {
    user,
    challenge,
  };
}

export async function GET(
  _request: Request,
  context: {
    params: Promise<{
      contestId: string;
    }>;
  },
) {
  try {
    const { contestId } =
      await context.params;

    const resolved =
      await resolveContext(contestId);

    if ("error" in resolved) {
      return resolved.error;
    }

    const masterBracket =
      await getOrCreateMasterBracket(
        resolved.user,
        resolved.challenge.competition
          .id,
        1,
      );

    return NextResponse.json(
      {
        success: true,
        masterBracket,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    console.error(
      "Failed to load master bracket",
      error,
    );

    return NextResponse.json(
      {
        success: false,
        error:
          "Unable to load your bracket.",
      },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: Request,
  context: {
    params: Promise<{
      contestId: string;
    }>;
  },
) {
  try {
    const { contestId } =
      await context.params;

    const resolved =
      await resolveContext(contestId);

    if ("error" in resolved) {
      return resolved.error;
    }

    const body = await request.json();

    const gameKey =
      typeof body?.gameKey ===
      "string"
        ? body.gameKey.trim()
        : "";

    const teamId =
      typeof body?.teamId ===
      "string"
        ? body.teamId.trim()
        : "";

    if (!gameKey || !teamId) {
      return NextResponse.json(
        {
          success: false,
          error:
            "gameKey and teamId are required.",
        },
        { status: 400 },
      );
    }

    const result =
      await saveMasterBracketPick(
        resolved.user,
        {
          competitionId:
            resolved.challenge
              .competition.id,
          bracketNumber: 1,
          gameKey,
          teamId,
        },
      );

    return NextResponse.json(
      {
        success: true,
        ...result,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    console.error(
      "Failed to save bracket pick",
      error,
    );

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to save bracket pick.",
      },
      { status: 400 },
    );
  }
}
