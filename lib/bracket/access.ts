import type { AppUser } from "@/lib/auth";
import {
  getActiveLeagueForSport,
  type GroupContext,
  type GroupLeague,
} from "@/lib/groups/context";

export type BracketChallengeAccess = {
  context: GroupContext;
  league: GroupLeague;
};

export async function getBracketChallengeAccess(
  user: AppUser,
): Promise<BracketChallengeAccess | null> {
  return getActiveLeagueForSport(
    user,
    "bracket_challenge",
  );
}
