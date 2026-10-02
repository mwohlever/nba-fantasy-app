"use client";
import { useGroupContext } from "@/components/providers/GroupProvider";

export function useNflLiveScope(viewerId: string) {
  const { groupContext, isLoading, isSwitchingGroup } = useGroupContext();
  const league = groupContext?.leagues.find(item => item.sportKey === "nfl" && item.gameMode === "standard" && item.isEnabled);
  return viewerId && !isLoading && !isSwitchingGroup && groupContext && league
    ? { viewerId, groupId: groupContext.group.id, leagueId: league.id, context: "nfl" as const, sport: "nfl" as const } : null;
}
