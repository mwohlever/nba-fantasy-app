/** Compact replay is mobile-only and only supplements—not replaces—the visible full court. */
export function shouldShowCompactNbaReplay(isNarrowViewport: boolean, isNormalReplayVisible: boolean) {
  return isNarrowViewport && !isNormalReplayVisible;
}
