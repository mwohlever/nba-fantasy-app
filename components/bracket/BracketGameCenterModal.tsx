"use client";

import GameCenterModal from "@/components/live-scores/GameCenterModal";
import type { LiveScoreGame } from "@/components/live-scores/LiveScoreCard";

export default function BracketGameCenterModal({
  contestId,
  game,
  developmentHarness = false,
  onClose,
}: {
  contestId: string;
  game: LiveScoreGame;
  developmentHarness?: boolean;
  onClose: () => void;
}) {
  return (
    <GameCenterModal
      key={`${contestId}:${game.espnEventId}`}
      game={game}
      onClose={onClose}
      apiBase={`/api/bracket-challenge/contests/${encodeURIComponent(contestId)}`}
      detailQuery={developmentHarness ? "devGameCenter=1" : undefined}
    />
  );
}
