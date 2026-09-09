/** A generation also invalidates A → B → A responses and completions after unmount. */
export function createRefreshScope(initialKey: string) {
  let key = initialKey;
  let generation = 0;
  return {
    update(nextKey: string) {
      if (key !== nextKey) { key = nextKey; generation += 1; }
    },
    invalidate() { generation += 1; },
    capture() {
      const captured = generation;
      return () => captured === generation;
    },
  };
}
