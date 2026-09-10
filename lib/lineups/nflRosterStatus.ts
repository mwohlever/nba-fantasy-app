import { nflTeamCode } from "@/lib/live-scores/nflFantasyGames";

/** Every roster entry has one bucket. Unknown/bye/unresolved stays left, never final. */
export function nflRosterStatusCounts(
  players: { id: number; team_abbreviation?: string | null }[],
  games: Record<string, { status: string }>,
  getStat: (id: number) => { game_status?: number | null } | null,
) {
  const counts = { games_completed: 0, games_in_progress: 0, games_remaining: 0 };
  for (const player of players) {
    const game = games[nflTeamCode(player.team_abbreviation)];
    const status = game ? game.status : getStat(player.id)?.game_status;
    if (status === "post" || status === 3) counts.games_completed++;
    else if (status === "in" || status === 2) counts.games_in_progress++;
    else counts.games_remaining++;
  }
  return counts;
}
