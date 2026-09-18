import {
  BracketGame,
  BracketGameId,
  BracketPicks,
  BracketSource,
  BracketTeamId,
  BracketTopology,
  ResolvedBracketGame,
} from "./types";

function gameMap(topology: BracketTopology): Map<BracketGameId, BracketGame> {
  return new Map(topology.games.map((game) => [game.id, game]));
}

function resolveSource(
  source: BracketSource,
  picks: BracketPicks,
): BracketTeamId | null {
  if (source.type === "team") {
    return source.teamId;
  }

  return picks[source.gameId] ?? null;
}

export function validateBracketTopology(topology: BracketTopology): void {
  const games = gameMap(topology);

  if (games.size !== topology.games.length) {
    throw new Error("Bracket topology contains duplicate game IDs.");
  }

  const ordered = [...topology.games].sort(
    (a, b) =>
      a.roundOrder - b.roundOrder ||
      a.gameOrder - b.gameOrder ||
      a.id.localeCompare(b.id),
  );

  for (const game of ordered) {
    if (!game.id.trim()) {
      throw new Error("Bracket game IDs must be non-empty.");
    }

    if (!game.roundKey.trim()) {
      throw new Error(`Bracket game ${game.id} has an empty round key.`);
    }

    if (!Number.isInteger(game.roundOrder) || game.roundOrder < 1) {
      throw new Error(`Bracket game ${game.id} has an invalid round order.`);
    }

    if (!Number.isInteger(game.gameOrder) || game.gameOrder < 1) {
      throw new Error(`Bracket game ${game.id} has an invalid game order.`);
    }

    for (const source of game.sources) {
      if (source.type === "team") {
        if (!source.teamId.trim()) {
          throw new Error(`Bracket game ${game.id} has an empty team source.`);
        }
        continue;
      }

      const sourceGame = games.get(source.gameId);

      if (!sourceGame) {
        throw new Error(
          `Bracket game ${game.id} references missing source game ${source.gameId}.`,
        );
      }

      if (sourceGame.roundOrder >= game.roundOrder) {
        throw new Error(
          `Bracket game ${game.id} must depend only on an earlier round.`,
        );
      }
    }
  }
}

export function orderedBracketGames(
  topology: BracketTopology,
): BracketGame[] {
  validateBracketTopology(topology);

  return [...topology.games].sort(
    (a, b) =>
      a.roundOrder - b.roundOrder ||
      a.gameOrder - b.gameOrder ||
      a.id.localeCompare(b.id),
  );
}

export function resolveBracketGame(
  topology: BracketTopology,
  gameId: BracketGameId,
  picks: BracketPicks,
): ResolvedBracketGame {
  validateBracketTopology(topology);

  const game = topology.games.find((candidate) => candidate.id === gameId);

  if (!game) {
    throw new Error(`Unknown bracket game ${gameId}.`);
  }

  return {
    ...game,
    teamIds: [
      resolveSource(game.sources[0], picks),
      resolveSource(game.sources[1], picks),
    ],
  };
}

export function isValidPickForGame(
  topology: BracketTopology,
  gameId: BracketGameId,
  teamId: BracketTeamId,
  picks: BracketPicks,
): boolean {
  const game = resolveBracketGame(topology, gameId, picks);

  return game.teamIds.includes(teamId);
}

export function validateBracketPicks(
  topology: BracketTopology,
  picks: BracketPicks,
): void {
  const games = gameMap(topology);
  validateBracketTopology(topology);

  for (const [gameId, teamId] of Object.entries(picks)) {
    if (teamId == null) {
      continue;
    }

    if (!games.has(gameId)) {
      throw new Error(`Pick references unknown bracket game ${gameId}.`);
    }
  }

  for (const game of orderedBracketGames(topology)) {
    const pickedTeamId = picks[game.id];

    if (pickedTeamId == null) {
      continue;
    }

    if (!isValidPickForGame(topology, game.id, pickedTeamId, picks)) {
      throw new Error(
        `Pick ${pickedTeamId} is not eligible for bracket game ${game.id}.`,
      );
    }
  }
}
