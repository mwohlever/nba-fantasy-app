import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { getBracketChallengeAccess } from "@/lib/bracket/access";
import { loadBracketChallengeCompetitions } from "@/lib/bracket/competitions.server";

export async function GET() {
  try {
    const user =
      await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        {
          error:
            "Login required.",
        },
        { status: 401 },
      );
    }

    const access =
      await getBracketChallengeAccess(
        user,
      );

    if (!access) {
      return NextResponse.json(
        {
          error:
            "Bracket Challenge is not enabled for this Group.",
        },
        { status: 404 },
      );
    }

    const competitions =
      await loadBracketChallengeCompetitions(
        access.league.id,
      );

    return NextResponse.json(
      {
        success: true,

        group: {
          id:
            access.context.group.id,

          name:
            access.context.group.name,

          slug:
            access.context.group.slug,
        },

        league: {
          id:
            access.league.id,

          name:
            access.league.name,

          slug:
            access.league.slug,
        },

        canAdministerGroup:
          access.context.canAdministerGroup,

        competitions,
      },
      {
        headers: {
          "Cache-Control":
            "no-store",
        },
      },
    );
  } catch (error) {
    console.error(
      "Failed to load Bracket Challenge competitions",
      error,
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to load Bracket Challenge competitions.",
      },
      { status: 500 },
    );
  }
}
