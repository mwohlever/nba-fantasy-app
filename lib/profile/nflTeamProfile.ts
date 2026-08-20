import {
  getFantasyTeamProfile,
} from "@/lib/profile/fantasyTeamProfile";

import type {
  ProfileScope,
} from "@/lib/profile/profileScope";


export function getNflTeamProfile(
  req: Request,
  scope: ProfileScope,
) {
  return getFantasyTeamProfile(
    req,
    "nfl",
    scope,
  );
}
