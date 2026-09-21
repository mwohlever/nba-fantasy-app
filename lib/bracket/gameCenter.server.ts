import "server-only";

import type { BracketLiveScoresModel } from "@/lib/bracket/liveScores.server";

/** Production Game Center access requires the same fully validated event that rendered a live-score card. */
export function isValidBracketGameCenterEvent(
  liveScores: BracketLiveScoresModel,
  eventId: string,
) {
  return liveScores.games.some(
    (game) =>
      game.providerEventId === eventId &&
      game.provider.mappingState === "valid" &&
      game.provider.game?.espnEventId === eventId,
  );
}
