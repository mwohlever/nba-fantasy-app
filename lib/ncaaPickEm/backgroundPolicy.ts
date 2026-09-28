export type NcaaTask = "results" | "reminders";
export type NcaaWeek = {
  id: number; league_id: string; season: number; week_number: number;
  status: "open" | "locked" | "final"; lock_at: string | null;
};
export type NcaaGame = { kickoff_at: string; status: string; included: boolean };
const day = 86_400_000;

export function ncaaWeekEligibility(week: NcaaWeek, games: NcaaGame[], task: NcaaTask, now = new Date()) {
  if (!week.league_id || !Number.isInteger(week.season) || !Number.isInteger(week.week_number) || week.status === "final")
    return { eligible: false, reason: "inactive" };
  const lock = week.lock_at ? Date.parse(week.lock_at) : NaN;
  if (task === "reminders") return {
    eligible: week.status === "open" && Number.isFinite(lock) && lock > now.getTime() && lock <= now.getTime() + 7 * day,
    reason: "reminder_window",
  };
  // Locked weeks remain eligible, including postponed games. Never silently abandon an unresolved week.
  if (week.status === "locked" || Number.isFinite(lock) && lock <= now.getTime())
    return { eligible: true, reason: "locked_or_due" };
  if (!games.length) return { eligible: false, reason: "no_games" };
  const times = games.map(game => Date.parse(game.kickoff_at)).filter(Number.isFinite);
  return { eligible: times.some(time => time <= now.getTime() + 7 * day), reason: "schedule_window" };
}

/** A five-minute trigger serves live games; stored due times suppress idle ESPN polling. */
export function ncaaRefreshDelaySeconds(week: NcaaWeek, games: NcaaGame[], now = new Date()) {
  const relevant = games.filter(game => game.included);
  const times = (relevant.length ? relevant : games).map(game => Date.parse(game.kickoff_at)).filter(Number.isFinite);
  const lock = week.lock_at ? Date.parse(week.lock_at) : NaN;
  if (week.status === "open" && lock > now.getTime() && lock <= now.getTime() + 3_600_000) return 240;
  if (relevant.some(game => game.status === "in")) return 240;
  // Catch-up for unresolved old weeks stays enabled at six-hour intervals.
  if (times.length && Math.max(...times) < now.getTime() - 2 * day) return 21600;
  if (!times.length || Math.min(...times) > now.getTime() + day) return 21600;
  return Math.min(...times) > now.getTime() + 3_600_000 ? 3600 : 240;
}
