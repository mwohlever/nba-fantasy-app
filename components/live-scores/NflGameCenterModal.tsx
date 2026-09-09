"use client";
import { useGroupContext } from "@/components/providers/GroupProvider";
import GameCenterModal from "./GameCenterModal";
import type { LiveScoreGame } from "./LiveScoreCard";

export default function NflGameCenterModal(props: { game: LiveScoreGame; onClose: () => void }) {
  const { groupContext, isSwitchingGroup } = useGroupContext();
  const league = groupContext?.leagues.find(item => item.sportKey === "nfl" && item.gameMode === "standard" && item.isEnabled);
  const scope = !isSwitchingGroup && groupContext && league ? { groupId: groupContext.group.id, leagueId: league.id } : null;
  // Remount removes annotations synchronously, including A -> B -> A requests.
  return <GameCenterModal key={`${scope?.groupId ?? "switching"}:${scope?.leagueId ?? ""}:${props.game.espnEventId}`}
    {...props} apiBase="/api/live-scores/nfl" fantasyScope={scope} />;
}
