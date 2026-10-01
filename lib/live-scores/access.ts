import type { AppUser } from "@/lib/auth";
import { getActiveLeagueForSport } from "@/lib/groups/context";
import type { NbaLiveContext } from "./nbaContext";

export function getNbaLiveAccess(user: AppUser, context: NbaLiveContext = "nba") {
  return getActiveLeagueForSport(user, context === "nba-skins" ? "nba_skins" : "nba");
}

export function getNflLiveAccess(user: AppUser) {
  return getActiveLeagueForSport(user, "nfl");
}
