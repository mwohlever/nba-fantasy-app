"use client";
import { useGroupContext } from "@/components/providers/GroupProvider";
import type { NbaLiveContext } from "./nbaContext";

export function useNbaLiveScope(context: NbaLiveContext, viewerId: string) {
  const { groupContext, isLoading, isSwitchingGroup } = useGroupContext();
  const league = groupContext?.leagues.find(item => item.sportKey === (context === "nba-skins" ? "nba_skins" : "nba") && item.gameMode === "standard" && item.isEnabled);
  return Boolean(viewerId) && !isLoading && !isSwitchingGroup && groupContext && league
    ? { viewerId, groupId: groupContext.group.id, leagueId: league.id, context, sport: "nba" as const } : null;
}
