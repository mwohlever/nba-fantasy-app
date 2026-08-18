import {
  getFantasyTeamProfile,
} from "@/lib/profile/fantasyTeamProfile";


export function getNbaTeamProfile(
  req: Request,
) {
  return getFantasyTeamProfile(
    req,
    "nba",
  );
}
