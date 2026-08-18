import {
  getFantasyTeamProfile,
} from "@/lib/profile/fantasyTeamProfile";


export function getNflTeamProfile(
  req: Request,
) {
  return getFantasyTeamProfile(
    req,
    "nfl",
  );
}
