import { nflTeamCode } from "@/lib/live-scores/nflFantasyGames";

type RosterPlayer = { id: number; team_abbreviation?: string | null };
type Games = Record<string, { status: string }>;
type StoredStatus = { game_status?: number | null } | null;

/** The matched slate game overrides stale player stats, including absent box scores. */
export function nflRosterPlayerStatus(player: RosterPlayer, games: Games, stat: StoredStatus) {
  const game = games[nflTeamCode(player.team_abbreviation)];
  const status = game ? game.status : stat?.game_status;
  if (status === "post" || status === 3) return { label: "Final", tone: "final", detail: "Game complete" };
  if (status === "in" || status === 2) return { label: "Live", tone: "live", detail: "Live" };
  const exceptional = { postponed: "Postponed", canceled: "Canceled", suspended: "Suspended" };
  const label = typeof status === "string" && Object.hasOwn(exceptional, status)
    ? exceptional[status as keyof typeof exceptional] : "Upcoming";
  return { label, tone: "upcoming", detail: label === "Upcoming" ? "Not started or game unavailable" : label };
}

/** Every roster entry has one bucket. Unknown/bye/unresolved stays left, never final. */
export function nflRosterStatusCounts(
  players: RosterPlayer[],
  games: Games,
  getStat: (id: number) => StoredStatus,
) {
  const counts = { games_completed: 0, games_in_progress: 0, games_remaining: 0 };
  for (const player of players) {
    const status = nflRosterPlayerStatus(player, games, getStat(player.id));
    if (status.tone === "final") counts.games_completed++;
    else if (status.tone === "live") counts.games_in_progress++;
    else counts.games_remaining++;
  }
  return counts;
}
