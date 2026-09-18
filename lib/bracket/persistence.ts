import {
  BracketGame,
  BracketSource,
  BracketTopology,
} from "./types";
import { validateBracketTopology } from "./topology";

export type PersistedBracketGameRow = {
  id: string | number;
  game_key: string;
  round_key: string;
  round_order: number;
  game_order: number;
  source_a_team_id: string | null;
  source_a_game_id: string | number | null;
  source_b_team_id: string | null;
  source_b_game_id: string | number | null;
};

function sourceFromRow(
  teamId: string | null,
  sourceGameId: string | number | null,
  gameKeyByDatabaseId: Map<string, string>,
  gameKey: string,
  slot: "A" | "B",
): BracketSource {
  const hasTeam = Boolean(teamId?.trim());
  const hasGame = sourceGameId != null;

  if (hasTeam === hasGame) {
    throw new Error(
      `Bracket game ${gameKey} source ${slot} must have exactly one source.`,
    );
  }

  if (hasTeam) {
    return {
      type: "team",
      teamId: teamId!.trim(),
    };
  }

  const sourceGameKey = gameKeyByDatabaseId.get(String(sourceGameId));

  if (!sourceGameKey) {
    throw new Error(
      `Bracket game ${gameKey} source ${slot} references an unknown persisted game.`,
    );
  }

  return {
    type: "winner",
    gameId: sourceGameKey,
  };
}

export function bracketTopologyFromRows(
  rows: PersistedBracketGameRow[],
): BracketTopology {
  const gameKeyByDatabaseId = new Map<string, string>();

  for (const row of rows) {
    const databaseId = String(row.id);
    const gameKey = row.game_key.trim();

    if (!gameKey) {
      throw new Error("Persisted bracket game has an empty game key.");
    }

    if (gameKeyByDatabaseId.has(databaseId)) {
      throw new Error(
        `Persisted bracket games contain duplicate database ID ${databaseId}.`,
      );
    }

    gameKeyByDatabaseId.set(databaseId, gameKey);
  }

  const games: BracketGame[] = rows.map((row) => {
    const gameKey = row.game_key.trim();

    return {
      id: gameKey,
      roundKey: row.round_key,
      roundOrder: row.round_order,
      gameOrder: row.game_order,
      sources: [
        sourceFromRow(
          row.source_a_team_id,
          row.source_a_game_id,
          gameKeyByDatabaseId,
          gameKey,
          "A",
        ),
        sourceFromRow(
          row.source_b_team_id,
          row.source_b_game_id,
          gameKeyByDatabaseId,
          gameKey,
          "B",
        ),
      ],
    };
  });

  const topology = { games };

  validateBracketTopology(topology);

  return topology;
}
