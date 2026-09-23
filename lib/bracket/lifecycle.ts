export type BracketLockState = {
  contestStatus: string;
  contestLockAt: string | null;
};

/** The first scheduled game is the latest possible contest lock boundary. */
export function effectiveBracketLockAt(contestLockAt: string | null, games: Array<{ scheduledAt: string | null; status?: string }>) {
  if (games.some((game) => game.status === "in_progress" || game.status === "final"))
    return "1970-01-01T00:00:00.000Z";
  const times = [contestLockAt, ...games.map((game) => game.scheduledAt)]
    .filter((value): value is string => Boolean(value))
    .filter((value) => Number.isFinite(new Date(value).getTime()));
  return times.length ? times.sort((a, b) => new Date(a).getTime() - new Date(b).getTime())[0] : null;
}

/** A full entry snapshot is a contest concern; individual game locks remain competition concerns. */
export function shouldFreezeBracketEntry(
  lock: BracketLockState,
  now = new Date(),
) {
  if (["locked", "in_progress", "final"].includes(lock.contestStatus)) {
    return true;
  }

  return Boolean(
    lock.contestLockAt && new Date(lock.contestLockAt).getTime() <= now.getTime(),
  );
}

export function canEditBracketGame(input: {
  contest: BracketLockState;
  gameLockAt: string | null;
  gameStatus: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  if (shouldFreezeBracketEntry(input.contest, now)) return false;
  if (["in_progress", "final"].includes(input.gameStatus)) return false;
  return !input.gameLockAt || new Date(input.gameLockAt).getTime() > now.getTime();
}
