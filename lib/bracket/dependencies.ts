import {
  BracketGameId,
  BracketPicks,
  BracketTeamId,
  BracketTopology,
} from "./types";
import {
  isValidPickForGame,
  orderedBracketGames,
  validateBracketPicks,
} from "./topology";

export type BracketPickChange = {
  picks: BracketPicks;
  clearedGameIds: BracketGameId[];
};

export function downstreamGameIds(
  topology: BracketTopology,
  sourceGameId: BracketGameId,
): BracketGameId[] {
  const games = orderedBracketGames(topology);

  if (!games.some((game) => game.id === sourceGameId)) {
    throw new Error(`Unknown bracket game ${sourceGameId}.`);
  }

  const downstream = new Set<BracketGameId>();
  let changed = true;

  while (changed) {
    changed = false;

    for (const game of games) {
      if (downstream.has(game.id) || game.id === sourceGameId) {
        continue;
      }

      const dependsOnSource = game.sources.some(
        (source) =>
          source.type === "winner" &&
          (source.gameId === sourceGameId || downstream.has(source.gameId)),
      );

      if (dependsOnSource) {
        downstream.add(game.id);
        changed = true;
      }
    }
  }

  return games
    .filter((game) => downstream.has(game.id))
    .map((game) => game.id);
}

export function applyBracketPick(
  topology: BracketTopology,
  currentPicks: BracketPicks,
  gameId: BracketGameId,
  teamId: BracketTeamId,
): BracketPickChange {
  validateBracketPicks(topology, currentPicks);

  if (!isValidPickForGame(topology, gameId, teamId, currentPicks)) {
    throw new Error(`Team ${teamId} is not eligible for bracket game ${gameId}.`);
  }

  const nextPicks: BracketPicks = {
    ...currentPicks,
    [gameId]: teamId,
  };

  const clearedGameIds: BracketGameId[] = [];

  for (const downstreamId of downstreamGameIds(topology, gameId)) {
    const downstreamPick = nextPicks[downstreamId];

    if (downstreamPick == null) {
      continue;
    }

    if (!isValidPickForGame(topology, downstreamId, downstreamPick, nextPicks)) {
      nextPicks[downstreamId] = null;
      clearedGameIds.push(downstreamId);
    }
  }

  validateBracketPicks(topology, nextPicks);

  return {
    picks: nextPicks,
    clearedGameIds,
  };
}
