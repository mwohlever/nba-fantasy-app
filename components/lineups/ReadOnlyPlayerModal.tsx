"use client";

import GolfPlayerModal from "@/components/lineups/GolfPlayerModal";
import type { GolfScorecardFocus } from "@/components/lineups/GolfPlayerModal";
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
  golfSlateId?: number | null;
  golfFocus?: GolfScorecardFocus | null;
  golfStatsLoading?: boolean;
  golfStatsError?: string | null;
};

export default function ReadOnlyPlayerModal({
  player,
  setPlayer,
  playerAverageMap,
  playerProjections,
  golfStat = null,
  golfSlateId = null,
  golfFocus = null,
  golfStatsLoading = false,
  golfStatsError = null,
}: Props) {
  const { selectedSport } = useSelectedSport();

  if (selectedSport === "golf" && player) {
    return (
      <GolfPlayerModal
        player={player}
        stat={golfStat}
        slateId={golfSlateId}
        focus={golfFocus}
        isLoading={golfStatsLoading}
        loadError={golfStatsError}
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
