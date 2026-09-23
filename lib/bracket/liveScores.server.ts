import "server-only";

import type { AppUser } from "@/lib/auth";
import {
  getBracketChallengeDetail,
  type BracketChallengeDetail,
  type BracketChallengeGame,
  type BracketChallengeTeam,
} from "@/lib/bracket/challenge.server";
import { bracketTopologyFromRows } from "@/lib/bracket/persistence";
import { bracketResultsFromOfficialGames } from "@/lib/bracket/scoring";
import { resolveBracketGame } from "@/lib/bracket/topology";
import {
  fetchBracketPostseasonEvents,
  type NcaaEspnGame,
} from "@/lib/providers/ncaa";

export type BracketLiveScoresMappingState =
  | "unmapped"
  | "provider_unavailable"
  | "not_found"
  | "identity_mismatch"
  | "bound_unresolved"
  | "partially_valid"
  | "valid";

export type BracketLiveScoresParticipant = {
  status: "resolved" | "unresolved";
  team?: BracketChallengeTeam;
  sourceLabel?: string;
};

export type BracketLiveScoresGame = {
  bracketGameId: number;
  gameKey: string;
  roundKey: string;
  roundOrder: number;
  gameOrder: number;
  regionKey: string | null;
  scheduledAt: string | null;
  officialStatus: string;
  providerEventId: string | null;
  participants: {
    a: BracketLiveScoresParticipant;
    b: BracketLiveScoresParticipant;
  };
  provider: {
    mappingState: BracketLiveScoresMappingState;
    game?: NcaaEspnGame;
  };
};

export type BracketLiveScoresModel = {
  group: BracketChallengeDetail["group"];
  contest: Pick<BracketChallengeDetail["contest"], "id" | "status" | "lockAt">;
  competition: BracketChallengeDetail["competition"];
  provider: {
    availability: "available" | "unavailable";
  };
  rounds: Array<{
    key: string;
    label: string;
    order: number;
  }>;
  games: BracketLiveScoresGame[];
};

function roundLabel(roundKey: string) {
  return roundKey
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function sourceLabel(sourceGame: BracketChallengeGame) {
  return `Winner of ${roundLabel(sourceGame.roundKey)} ${sourceGame.gameOrder}`;
}

function participant(
  teamId: string | null,
  sourceGame: BracketChallengeGame | undefined,
  teamByProviderId: Map<string, BracketChallengeTeam>,
): BracketLiveScoresParticipant {
  if (teamId) {
    const team = teamByProviderId.get(teamId);

    if (!team) {
      throw new Error(
        `Bracket game resolves unknown competition team ${teamId}.`,
      );
    }

    return { status: "resolved", team };
  }

  if (!sourceGame) {
    throw new Error("Bracket game has an unresolved source without a source game.");
  }

  return {
    status: "unresolved",
    sourceLabel: sourceLabel(sourceGame),
  };
}

function mappingState(input: {
  providerAvailable: boolean;
  providerEventId: string | null;
  providerGame: NcaaEspnGame | undefined;
  expectedTeamIds: Array<string | null>;
}): BracketLiveScoresMappingState {
  if (!input.providerEventId) return "unmapped";
  if (!input.providerAvailable) return "provider_unavailable";
  if (!input.providerGame) return "not_found";

  const expected = input.expectedTeamIds.filter(
    (teamId): teamId is string => Boolean(teamId),
  );

  if (!expected.length) return "bound_unresolved";

  const providerTeamIds = new Set([
    input.providerGame.awayTeam.id,
    input.providerGame.homeTeam.id,
  ]);

  if (expected.length === 1) {
    return providerTeamIds.has(expected[0])
      ? "partially_valid"
      : "identity_mismatch";
  }

  const expectedTeamIds = new Set(expected);
  const isExactPair =
    expectedTeamIds.size === 2 &&
    providerTeamIds.size === 2 &&
    expectedTeamIds.size === providerTeamIds.size &&
    [...expectedTeamIds].every((teamId) => providerTeamIds.has(teamId));

  return isExactPair
    ? "valid"
    : "identity_mismatch";
}

/**
 * Converts the official bracket graph and an ESPN postseason snapshot into a
 * UI-ready read model. It never mutates the graph and never resolves a source
 * from entrants' picks: dependency sources use persisted official finals only.
 */
export function buildBracketLiveScoresModel(input: {
  detail: BracketChallengeDetail;
  providerGames: NcaaEspnGame[];
  providerAvailable: boolean;
}): BracketLiveScoresModel {
  const { detail } = input;
  const topology = bracketTopologyFromRows(
    detail.games.map((game) => ({
      id: game.id,
      game_key: game.gameKey,
      round_key: game.roundKey,
      round_order: game.roundOrder,
      game_order: game.gameOrder,
      source_a_team_id: game.sourceATeamId,
      source_a_game_id: game.sourceAGameId,
      source_b_team_id: game.sourceBTeamId,
      source_b_game_id: game.sourceBGameId,
    })),
  );
  const officialResults = bracketResultsFromOfficialGames(
    detail.games.map((game) => ({
      gameId: game.gameKey,
      status: game.status,
      winnerTeamId: game.winnerTeamId,
    })),
  );
  const teamByProviderId = new Map(
    detail.teams.map((team) => [team.providerTeamId, team]),
  );
  const gameById = new Map(detail.games.map((game) => [game.id, game]));
  const providerByEventId = new Map(
    input.providerGames.map((game) => [game.espnEventId, game]),
  );

  const games = detail.games.map((game) => {
    const resolved = resolveBracketGame(
      topology,
      game.gameKey,
      officialResults,
    );
    const sourceAGame = game.sourceAGameId === null
      ? undefined
      : gameById.get(game.sourceAGameId);
    const sourceBGame = game.sourceBGameId === null
      ? undefined
      : gameById.get(game.sourceBGameId);
    const providerGame = game.providerEventId
      ? providerByEventId.get(game.providerEventId)
      : undefined;
    const state = mappingState({
      providerAvailable: input.providerAvailable,
      providerEventId: game.providerEventId,
      providerGame,
      expectedTeamIds: resolved.teamIds,
    });

    return {
      bracketGameId: game.id,
      gameKey: game.gameKey,
      roundKey: game.roundKey,
      roundOrder: game.roundOrder,
      gameOrder: game.gameOrder,
      regionKey: game.regionKey,
      scheduledAt: game.scheduledAt,
      officialStatus: game.status,
      providerEventId: game.providerEventId,
      participants: {
        a: participant(resolved.teamIds[0], sourceAGame, teamByProviderId),
        b: participant(resolved.teamIds[1], sourceBGame, teamByProviderId),
      },
      provider: {
        mappingState: state,
        ...(state === "valid" ||
        state === "partially_valid" ||
        state === "bound_unresolved"
          ? { game: providerGame }
          : {}),
      },
    } satisfies BracketLiveScoresGame;
  });

  const rounds = games
    .map((game) => ({
      key: game.roundKey,
      label: roundLabel(game.roundKey),
      order: game.roundOrder,
    }))
    .filter(
      (round, index, all) =>
        all.findIndex((candidate) => candidate.key === round.key) === index,
    );

  return {
    group: detail.group,
    contest: {
      id: detail.contest.id,
      status: detail.contest.status,
      lockAt: detail.contest.lockAt,
    },
    competition: detail.competition,
    provider: {
      availability: input.providerAvailable ? "available" : "unavailable",
    },
    rounds,
    games,
  };
}

/**
 * Contest-authorized Bracket Challenge live-score read boundary. ESPN failure
 * intentionally degrades to the official graph so unmapped/future nodes still
 * render; authorization and database failures continue to throw.
 */
export async function getBracketContestLiveScores(
  user: AppUser,
  contestId: string,
): Promise<BracketLiveScoresModel | null> {
  const detail = await getBracketChallengeDetail(user, contestId);

  if (!detail) return null;

  try {
    const providerGames = await fetchBracketPostseasonEvents(detail.competition);

    return buildBracketLiveScoresModel({
      detail,
      providerGames,
      providerAvailable: true,
    });
  } catch (error) {
    console.warn("Unable to load NCAA postseason provider data", error);

    return buildBracketLiveScoresModel({
      detail,
      providerGames: [],
      providerAvailable: false,
    });
  }
}
