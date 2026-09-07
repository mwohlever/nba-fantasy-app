"use client";
import GameCenterModal from "@/components/live-scores/GameCenterModal";
import type { NcaaScoreGame } from "./NcaaScoreCard";
export default function NcaaGameCenterModal({ game, onClose }: { game: NcaaScoreGame; onClose: () => void }) {
  return <GameCenterModal key={game.espnEventId} game={game} onClose={onClose} apiBase="/api/ncaa-pickem" />;
}
