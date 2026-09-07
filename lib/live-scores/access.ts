import type { AppUser } from "@/lib/auth";
import { getActiveLeagueForSport } from "@/lib/groups/context";
export function getNflLiveAccess(user: AppUser) {
  return getActiveLeagueForSport(user, "nfl");
}
