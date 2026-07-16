"use client";

import PlayerModal from "@/components/lineups/PlayerModal";
import type { Player } from "@/components/lineups/types";

type Props = {
  player: Player | null;
  setPlayer: (player: Player | null) => void;
  playerAverageMap: Map<number, number>;
  playerProjections: Record<number, any>;
};

export default function ReadOnlyPlayerModal({
  player,
  setPlayer,
  playerAverageMap,
  playerProjections,
}: Props) {
  return (
    <PlayerModal
      mode="view"
      player={player}
      onClose={() => setPlayer(null)}
      playerAverageMap={playerAverageMap}
      playerProjections={playerProjections}
    />
  );
}
