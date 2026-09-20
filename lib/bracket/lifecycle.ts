export type BracketLockState = {
  contestStatus: string;
  contestLockAt: string | null;
};

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
