import {
  NextResponse,
} from "next/server";

import {
  getCurrentUser,
} from "@/lib/auth";

import {
  getActiveLeagueForSport,
  teamBelongsToGroup,
  type LeagueSportKey,
} from "@/lib/groups/context";

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

import type {
  ProfileScope,
} from "@/lib/profile/profileScope";


type TeamProfileSport =
  | "nba"
  | "nfl"
  | "golf"
  | "ncaa";


function normalizeProfileSport(
  value: string | null,
): TeamProfileSport {
  if (value === "nfl") {
    return "nfl";
  }

  if (value === "golf") {
    return "golf";
  }

  if (
    value === "ncaa" ||
    value === "ncaa_pickem"
  ) {
    return "ncaa";
  }

  return "nba";
}


function getLeagueSportKey(
  sport: TeamProfileSport,
): LeagueSportKey {
  if (sport === "ncaa") {
    return "ncaa_pickem";
  }

  return sport;
}


export async function GET(
  req: Request,
) {
  try {
    const user =
      await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        {
          error:
            "Login required.",
        },
        {
          status: 401,
        },
      );
    }


    const {
      searchParams,
    } =
      new URL(
        req.url,
      );


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
      normalizeProfileSport(
        searchParams.get(
          "sport",
        ),
      );


    if (
      !Number.isInteger(
        teamId,
      ) ||
      teamId <= 0
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


    const activeLeague =
      await getActiveLeagueForSport(
        user,
        getLeagueSportKey(
          sport,
        ),
      );


    if (!activeLeague) {
      return NextResponse.json(
        {
          error:
            "This League is not enabled for the active Group.",
        },
        {
          status: 404,
        },
      );
    }


    const teamAllowed =
      await teamBelongsToGroup(
        teamId,
        activeLeague.context.group.id,
      );


    if (!teamAllowed) {
      return NextResponse.json(
        {
          error:
            "Team not found in the active Group.",
        },
        {
          status: 404,
        },
      );
    }


    const scope:
      ProfileScope = {
        groupId:
          activeLeague.context.group.id,

        leagueId:
          activeLeague.league.id,
      };


    if (
      sport === "golf"
    ) {
      return getGolfTeamProfile(
        teamId,
        seasonParam,
        scope,
      );
    }


    if (
      sport === "ncaa"
    ) {
      return getNcaaPickEmTeamProfile(
        teamId,
        seasonParam,
        scope,
      );
    }


    if (
      sport === "nfl"
    ) {
      return getNflTeamProfile(
        req,
        scope,
      );
    }


    return getNbaTeamProfile(
      req,
      scope,
    );
  } catch (
    error
  ) {
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
