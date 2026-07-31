"use client";

import GolfPlayerModal from "@/components/lineups/GolfPlayerModal";
import PlayerModal from "@/components/lineups/PlayerModal";
import { useSelectedSport } from "@/components/providers/SportProvider";
import type {
  Player,
  PlayerStat,
} from "@/components/lineups/types";

type Props = {
  player: Player | null;
  setPlayer: (player: Player | null) => void;
  playerAverageMap: Map<number, number>;
  playerProjections: Record<number, any>;
  golfStat?: PlayerStat | null;
};

export default function ReadOnlyPlayerModal({
  player,
  setPlayer,
  playerAverageMap,
  playerProjections,
  golfStat = null,
}: Props) {
  const { selectedSport } = useSelectedSport();

  if (selectedSport === "golf" && player) {
    return (
      <GolfPlayerModal
        player={player}
        stat={golfStat}
        onClose={() => setPlayer(null)}
      />
    );
  }

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
