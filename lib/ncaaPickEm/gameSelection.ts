import type { NcaaEspnGame } from "@/lib/providers/ncaa";

export function isNcaaRankedVsRanked(game: NcaaEspnGame) {
  return game.awayTeam.rank !== null && game.homeTeam.rank !== null;
}

export function hasExactlyOneNcaaRankedTeam(game: NcaaEspnGame) {
  return (game.awayTeam.rank !== null) !== (game.homeTeam.rank !== null);
}

export function getNcaaIncludedEventIds(
  games: NcaaEspnGame[],
  commissionerSelectedEventIds: ReadonlySet<string>,
) {
  return new Set(
    games
      .filter(
        (game) =>
          isNcaaRankedVsRanked(game) ||
          commissionerSelectedEventIds.has(game.espnEventId),
      )
      .map((game) => game.espnEventId),
  );
}

export function getNcaaLockAt(
  games: NcaaEspnGame[],
  includedEventIds: ReadonlySet<string>,
) {
  const selected = games
    .filter((game) => includedEventIds.has(game.espnEventId))
    .sort(
      (a, b) =>
        new Date(a.kickoffAt).getTime() - new Date(b.kickoffAt).getTime(),
    );

  return selected[0]?.kickoffAt ?? null;
}

export function getNewlySelectedCompletedOptionalIds({
  games,
  requestedIncludedEventIds,
  previouslyCommissionerSelectedEventIds,
}: {
  games: NcaaEspnGame[];
  requestedIncludedEventIds: ReadonlySet<string>;
  previouslyCommissionerSelectedEventIds: ReadonlySet<string>;
}) {
  return games
    .filter(
      (game) =>
        requestedIncludedEventIds.has(game.espnEventId) &&
        !previouslyCommissionerSelectedEventIds.has(game.espnEventId) &&
        hasExactlyOneNcaaRankedTeam(game) &&
        game.completed,
    )
    .map((game) => game.espnEventId);
}

