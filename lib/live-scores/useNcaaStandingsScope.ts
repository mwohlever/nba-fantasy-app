"use client";
import { useGroupContext } from "@/components/providers/GroupProvider";

export function useNcaaStandingsScope() {
  const { groupContext, isLoading, isSwitchingGroup } = useGroupContext();
  const league = groupContext?.leagues.find(item => item.sportKey === "ncaa_pickem" && item.gameMode === "standard" && item.isEnabled);
  // Scores is a client page. Membership is a stable request identity here;
  // server-side authorization still comes exclusively from the logged-in user.
  const scope = !isLoading && !isSwitchingGroup && groupContext?.membership.isActive && league
    ? { viewerId: groupContext.membership.id, groupId: groupContext.group.id, leagueId: league.id, context: "ncaa" as const, sport: "ncaa" as const } : null;
  return { scope, waitingForScope: isLoading || isSwitchingGroup };
}
