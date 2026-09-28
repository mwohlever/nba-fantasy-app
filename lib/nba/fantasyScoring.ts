import { getDefaultLeagueRules, type NbaScoringRules } from "@/lib/rules/leagueRules";
import type { FantasyContext, NbaGame, NbaBox, NbaStatRow, NbaTeamRow } from "./types";

/** Rebuild the whole slate from immutable per-game inputs. Never add this refresh to saved totals. */
export function scoreNbaFantasy(context: FantasyContext, games: readonly NbaGame[], boxes: ReadonlyMap<string, NbaBox>) {
  const defaults = getDefaultLeagueRules("nba").scoring as NbaScoringRules;
  const snapshot = context.slate.rules_snapshot?.scoring;
  const scoring = { ...defaults, ...Object.fromEntries(Object.entries(snapshot && typeof snapshot === "object" ? snapshot : {})
    .filter(([key, value]) => key in defaults && Number.isFinite(Number(value))).map(([key, value]) => [key, Number(value)])) } as NbaScoringRules;
  const rows: NbaStatRow[] = context.players.map(player => ({
    slate_id: context.slate.id, player_id: player.id, points: 0, rebounds: 0, assists: 0, steals: 0, blocks: 0, turnovers: 0,
    fantasy_points: 0, games_completed: 0, games_in_progress: 0, games_remaining: 0,
    game_status: null, game_status_text: null, period: null, game_clock: null,
  }));
  const byId = new Map(rows.map(row => [row.player_id, row]));
  for (const game of games) {
    const box = boxes.get(game.gameId);
    if (!box || box.status === 1) {
      if (!box && game.status !== 1) throw new Error("fantasy:missing_active_boxscore");
      for (const player of context.players) {
        if (![game.home, game.away].includes(String(player.team_abbreviation ?? "").toUpperCase())) continue;
        const row = byId.get(player.id)!;
        row.games_remaining++;
        row.game_status = 1; row.game_status_text = "Scheduled";
      }
      continue;
    }
    const boxById = new Map(box.players.map(player => [player.personId, player]));
    for (const player of context.players) {
      const incoming = player.nba_player_id ? boxById.get(player.nba_player_id) : null;
      if (!incoming) continue; // Preserve legacy DNP / absent-athlete behavior.
      const row = byId.get(player.id)!;
      for (const key of ["points", "rebounds", "assists", "steals", "blocks", "turnovers"] as const) row[key] += incoming.stats[key];
      if (box.status === 3) row.games_completed++;
      else if (box.status === 2) row.games_in_progress++;
      else row.games_remaining++;
      row.game_status = box.status; row.game_status_text = box.statusText; row.period = box.period; row.game_clock = box.clock;
    }
  }
  for (const row of rows) {
    row.fantasy_points = Math.round((row.points * scoring.points + row.rebounds * scoring.rebounds + row.assists * scoring.assists
      + row.steals * scoring.steals + row.blocks * scoring.blocks + row.turnovers * scoring.turnovers) * 10) / 10;
    if (!Number.isFinite(row.fantasy_points)) throw new Error("fantasy:nonfinite_score");
    const before = context.previous.find(old => old.player_id === row.player_id);
    if (before && (row.games_completed < Number(before.games_completed ?? 0)
      || Number(before.games_in_progress ?? 0) > 0 && row.games_in_progress === 0 && row.games_completed === Number(before.games_completed ?? 0))) {
      throw new Error("fantasy:accepted_game_status_regression");
    }
  }
  const teams: NbaTeamRow[] = context.lineups.map(lineup => {
    const stats = lineup.lineup_players.map(player => byId.get(player.player_id)).filter((row): row is NbaStatRow => Boolean(row));
    return { slate_id: context.slate.id, team_id: lineup.team_id,
      fantasy_points: Math.round(stats.reduce((sum, row) => sum + row.fantasy_points, 0) * 10) / 10, finish_position: null,
      games_completed: stats.reduce((sum, row) => sum + row.games_completed, 0),
      games_in_progress: stats.reduce((sum, row) => sum + row.games_in_progress, 0),
      games_remaining: stats.reduce((sum, row) => sum + row.games_remaining, 0),
    };
  }).sort((a, b) => b.fantasy_points - a.fantasy_points);
  teams.forEach((row, index) => { row.finish_position = index + 1; }); // Existing ordinal tie behavior.
  return { rows, teams, allFinal: games.length > 0 && games.every(game => boxes.get(game.gameId)?.status === 3) };
}
