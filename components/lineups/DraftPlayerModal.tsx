"use client";

import PlayerModal from "@/components/lineups/PlayerModal";
import type {
  OrderedTeam,
  Player,
  PlayerHistoryDetailRow,
} from "@/components/lineups/types";

type TeamStats = {
  totalPlayers: number;
  guards: number;
  fcPlayers: number;
};

type AssignmentStatus = {
  canAssign: boolean;
  reason: string;
};

type Props = {
  draftingPlayer: Player | null;
  setDraftingPlayer: React.Dispatch<
    React.SetStateAction<Player | null>
  >;
  playerAverageMap: Map<number, number>;
  playerProjections: Record<number, any>;
  availablePlayerIdSet: Set<number>;
  ownerTeamForDraftingPlayer: OrderedTeam | null;
  isAssigningPlayer: boolean;
  isSaving: boolean;
  handleRemovePlayerFromTeam: (
    player: Player
  ) => Promise<void>;
  draftingPlayerHistory: PlayerHistoryDetailRow[];
  isDraftingPlayerHistoryLoading: boolean;
  orderedTeamsForSlate: OrderedTeam[];
  getTeamStats: (teamId: number) => TeamStats;
  getTeamAssignmentStatus: (
    teamId: number,
    player: Player
  ) => AssignmentStatus;
  getOwnerTeamIdForPlayer: (
    playerId: number
  ) => number | null;
  handleAssignPlayerToTeam: (
    player: Player,
    teamId: number
  ) => Promise<void>;
  targetDraftSlot: {
    teamId: number;
    teamName: string;
    positionGroup: "G" | "F/C";
  } | null;
};

export default function DraftPlayerModal({
  draftingPlayer,
  setDraftingPlayer,
  playerAverageMap,
  playerProjections,
  availablePlayerIdSet,
  ownerTeamForDraftingPlayer,
  isAssigningPlayer,
  isSaving,
  handleRemovePlayerFromTeam,
  draftingPlayerHistory,
  isDraftingPlayerHistoryLoading,
  orderedTeamsForSlate,
  getTeamStats,
  getTeamAssignmentStatus,
  getOwnerTeamIdForPlayer,
  handleAssignPlayerToTeam,
  targetDraftSlot,
}: Props) {
  void draftingPlayerHistory;

  return (
    <PlayerModal
      mode="draft"
      player={draftingPlayer}
      onClose={() => setDraftingPlayer(null)}
      playerAverageMap={playerAverageMap}
      playerProjections={playerProjections}
      availablePlayerIdSet={
        availablePlayerIdSet
      }
      ownerTeam={
        ownerTeamForDraftingPlayer
      }
      isAssigningPlayer={
        isAssigningPlayer
      }
      isSaving={isSaving}
      isExternalLoading={
        isDraftingPlayerHistoryLoading
      }
      orderedTeamsForSlate={
        orderedTeamsForSlate
      }
      getTeamStats={getTeamStats}
      getTeamAssignmentStatus={
        getTeamAssignmentStatus
      }
      getOwnerTeamIdForPlayer={
        getOwnerTeamIdForPlayer
      }
      handleAssignPlayerToTeam={
        handleAssignPlayerToTeam
      }
      targetDraftSlot={targetDraftSlot}
      handleRemovePlayerFromTeam={
        handleRemovePlayerFromTeam
      }
    />
  );
}
