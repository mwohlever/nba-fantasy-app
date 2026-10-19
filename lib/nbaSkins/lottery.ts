const UINT32_RANGE = 2 ** 32;

function browserRandomUint32() {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error("Secure randomization is unavailable. Open the app over HTTPS or localhost.");
  }
  return globalThis.crypto.getRandomValues(new Uint32Array(1))[0];
}

/** Rejection sampling avoids modulo bias. The injected source is for deterministic tests. */
export function secureRandomIndex(bound: number, drawUint32 = browserRandomUint32) {
  if (!Number.isInteger(bound) || bound < 1 || bound > UINT32_RANGE) {
    throw new Error("Invalid randomization range.");
  }
  const limit = UINT32_RANGE - (UINT32_RANGE % bound);
  let value: number;
  do {
    value = drawUint32();
    if (!Number.isInteger(value) || value < 0 || value >= UINT32_RANGE) {
      throw new Error("Invalid random source.");
    }
  } while (value >= limit);
  return value % bound;
}

/** Fisher–Yates: each permutation has equal probability for a uniform source. */
export function shuffleNbaSkinsOrder<T>(values: readonly T[], drawUint32 = browserRandomUint32) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = secureRandomIndex(index + 1, drawUint32);
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

export function nextLotteryPick(participantCount: number, revealedCount: number) {
  return revealedCount >= 0 && revealedCount < participantCount
    ? participantCount - revealedCount : null;
}
