"use client";
import type { NbaLiveGame } from "@/lib/providers/nbaLiveScores";
import type { NbaLiveContext } from "@/lib/live-scores/nbaContext";
import NbaGameCenter from "./NbaGameCenter";

/** Compatibility shell for any consumer needing modal presentation. */
export default function NbaGameCenterModal({ game, onClose, context = "nba", viewerId }: {
  game: NbaLiveGame; onClose: () => void; context?: NbaLiveContext; viewerId: string;
}) {
  return <div className="fixed inset-0 z-[10000] bg-slate-950/55 sm:p-3" onClick={onClose}>
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col overflow-hidden bg-white shadow-xl sm:mt-4 sm:h-auto sm:max-h-[92vh] sm:rounded-2xl" onClick={event => event.stopPropagation()}>
      <NbaGameCenter key={`${viewerId}:${context}:${game.espnEventId}`} eventId={game.espnEventId} game={game} context={context} viewerId={viewerId} presentation="modal" onBack={onClose}/>
    </div>
  </div>;
}
