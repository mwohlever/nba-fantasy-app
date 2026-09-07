/** Betting lines freeze at the weekly lock or either known game kickoff. */
export function canRefreshNcaaOdds(
  week: { status: string; lock_at: string | null } | null,
  game: { status: string; kickoffAt: string },
  stored?: { status: string; kickoff_at: string } | null,
  now = Date.now(),
) {
  return (!week || (week.status === "open" && (!week.lock_at || now < new Date(week.lock_at).getTime()))) &&
    game.status === "pre" && now < new Date(game.kickoffAt).getTime() &&
    (!stored || (stored.status === "pre" && now < new Date(stored.kickoff_at).getTime()));
}
