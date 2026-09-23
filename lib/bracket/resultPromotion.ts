import type { NcaaEspnGame } from "../providers/ncaa";
import type { BracketTopology, BracketResults } from "./types";
import { resolveBracketGame } from "./topology";

export type PromotionDecision =
  | { state: "promote"; winnerTeamId: string }
  | { state: "identical" | "conflict" | "unsafe"; reason: string };

export type ResultGame = {
  gameKey: string;
  providerEventId: string | null;
  status: string;
  winnerTeamId: string | null;
};

export function bracketProviderParticipantsMatch(
  topology: BracketTopology,
  gameKey: string,
  results: BracketResults,
  event: NcaaEspnGame,
) {
  const [a, b] = resolveBracketGame(topology, gameKey, results).teamIds;
  const providerIds = [event.awayTeam.id, event.homeTeam.id];
  return Boolean(a && b && a !== b && providerIds[0] !== providerIds[1] &&
    providerIds.includes(a) && providerIds.includes(b));
}

/** Only an explicitly bound, fully resolved ESPN final may become official. */
export function decideBracketResultPromotion(input: {
  game: ResultGame;
  event: NcaaEspnGame | undefined;
  topology: BracketTopology;
  results: BracketResults;
  competition: { sportKey: string; formatKey: string };
  boundEventCount: number;
}): PromotionDecision {
  const { game, event, topology, results, competition } = input;
  const supported = (competition.sportKey === "college_football" && competition.formatKey === "cfp") ||
    (competition.sportKey === "mens_college_basketball" && competition.formatKey === "ncaa_mens") ||
    (competition.sportKey === "womens_college_basketball" && competition.formatKey === "ncaa_womens");
  if (!supported)
    return { state: "unsafe", reason: "Unsupported provider competition." };
  if (!game.providerEventId || !event || event.espnEventId !== game.providerEventId || input.boundEventCount !== 1)
    return { state: "unsafe", reason: "Event is missing, mismatched, or bound more than once." };
  if (event.status !== "post" || !event.completed)
    return { state: "unsafe", reason: "Event is not final." };
  const away = event.awayTeam;
  const home = event.homeTeam;
  if (!bracketProviderParticipantsMatch(topology, game.gameKey, results, event))
    return { state: "unsafe", reason: "Both official participants must match canonical ESPN team IDs." };
  if (away.winner === home.winner ||
      event.winnerTeamId !== (away.winner ? away.id : home.id) ||
      (away.score != null && home.score != null &&
        (away.score === home.score || (away.winner ? away.score < home.score : home.score < away.score))))
    return { state: "unsafe", reason: "Provider winner is ambiguous or inconsistent." };
  if (game.status === "final" || game.winnerTeamId) {
    return game.status === "final" && game.winnerTeamId === event.winnerTeamId
      ? { state: "identical", reason: "Official result already persisted." }
      : { state: "conflict", reason: "Provider final conflicts with official result; admin correction required." };
  }
  return { state: "promote", winnerTeamId: event.winnerTeamId! };
}
