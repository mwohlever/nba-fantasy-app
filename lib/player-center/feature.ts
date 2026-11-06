/** Player Center ships by default; retain a build-time emergency off switch. */
export function playerCenterEnabled() {
  return process.env.NEXT_PUBLIC_PLAYER_CENTER_ENABLED !== "false";
}

/** Opt-in local review against real read paths, with database mutations blocked at transport. */
export function playerCenterReadOnlyLocal() {
  return process.env.NODE_ENV === "development" && process.env.NEXT_PUBLIC_PLAYER_CENTER_READ_ONLY_LOCAL === "true";
}
