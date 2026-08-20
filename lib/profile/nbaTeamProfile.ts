import {
  getFantasyTeamProfile,
} from "@/lib/profile/fantasyTeamProfile";

import type {
  ProfileScope,
} from "@/lib/profile/profileScope";


export function getNbaTeamProfile(
  req: Request,
  scope: ProfileScope,
) {
  return getFantasyTeamProfile(
    req,
    "nba",
    scope,
  );
}
