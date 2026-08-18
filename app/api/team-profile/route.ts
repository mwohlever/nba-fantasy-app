import {
  NextResponse,
} from "next/server";

import {
  getGolfTeamProfile,
} from "@/lib/profile/golfTeamProfile";

import {
  getNcaaPickEmTeamProfile,
} from "@/lib/profile/ncaaPickEmTeamProfile";

import {
  getNbaTeamProfile,
} from "@/lib/profile/nbaTeamProfile";

import {
  getNflTeamProfile,
} from "@/lib/profile/nflTeamProfile";


export async function GET(
  req: Request,
) {
  try {
    const {
      searchParams,
    } =
      new URL(req.url);

    const teamId =
      Number(
        searchParams.get(
          "teamId",
        ),
      );

    const seasonParam =
      searchParams.get(
        "season",
      );

    const sport =
      searchParams.get(
        "sport",
      ) ?? "nba";


    if (
      !teamId ||
      Number.isNaN(teamId)
    ) {
      return NextResponse.json(
        {
          error:
            "Missing or invalid teamId.",
        },
        {
          status: 400,
        },
      );
    }


    if (
      sport === "golf"
    ) {
      return getGolfTeamProfile(
        teamId,
        seasonParam,
      );
    }


    if (
      sport === "ncaa"
    ) {
      return getNcaaPickEmTeamProfile(
        teamId,
        seasonParam,
      );
    }


    if (
      sport === "nfl"
    ) {
      return getNflTeamProfile(
        req,
      );
    }


    return getNbaTeamProfile(
      req,
    );
  } catch (error) {
    console.error(
      "Team profile routing error:",
      error,
    );

    return NextResponse.json(
      {
        error:
          "Unexpected server error while routing team profile.",
      },
      {
        status: 500,
      },
    );
  }
}
