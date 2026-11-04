/** Build-time launch gate shared by browser entry points and authenticated APIs. */
export function playerCenterEnabled() {
  if (process.env.NEXT_PUBLIC_PLAYER_CENTER_ENABLED === "false") return false;
  return process.env.NODE_ENV === "development" || process.env.NEXT_PUBLIC_PLAYER_CENTER_ENABLED === "true";
}

/** Opt-in local review against real read paths, with database mutations blocked at transport. */
export function playerCenterReadOnlyLocal() {
  return process.env.NODE_ENV === "development" && process.env.NEXT_PUBLIC_PLAYER_CENTER_READ_ONLY_LOCAL === "true";
}
