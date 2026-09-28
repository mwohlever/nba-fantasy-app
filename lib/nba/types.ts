import type { NbaSkinsSeasonRecord, NbaSkinsSeasonProjection } from "@/lib/providers/nbaSkinsRecords";

export type NbaTask = "fantasy" | "skins";
export type NbaWork = { task: NbaTask; target_id: number; league_id: string; group_id: string };
export type NbaGame = Readonly<{
  provider: "nba.com"; gameId: string; gameCode: string; date: string;
  startAt: string | null; status: 1 | 2 | 3; statusText: string;
  home: string; away: string;
}>;
export type NbaPlayerStats = { points: number; rebounds: number; assists: number; steals: number; blocks: number; turnovers: number };
export type NbaBox = Readonly<{
  provider: "nba.com"; gameId: string; status: 1 | 2 | 3; statusText: string;
  period: number | null; clock: string | null;
  home: string; away: string;
  players: ReadonlyArray<Readonly<{ personId: number; team: string; stats: Readonly<NbaPlayerStats> }>>;
}>;
export type NbaStandings = Readonly<{
  provider: "espn"; skinsSeason: number; espnSeason: number;
  records: ReadonlyArray<Readonly<NbaSkinsSeasonRecord>>;
}>;
export type NbaProjections = Readonly<{
  provider: "espn-bpi"; skinsSeason: number; espnSeason: number; source: string;
  projections: ReadonlyArray<Readonly<NbaSkinsSeasonProjection>>;
}>;
export type FantasySlate = {
  id: number; league_id: string; sport: string; date: string; start_date: string; end_date: string;
  is_locked: boolean; archived_at: string | null; first_game_start_time: string | null;
  nba_team_abbreviations: string[] | null; rules_snapshot: Record<string, unknown> | null;
};
export type NbaLineup = { id: number; team_id: number; lineup_players: { player_id: number }[] };
export type NbaPlayer = { id: number; name: string; nba_player_id: number | null; team_abbreviation: string | null };
export type NbaStatRow = NbaPlayerStats & {
  slate_id: number; player_id: number; fantasy_points: number;
  games_completed: number; games_in_progress: number; games_remaining: number;
  game_status: number | null; game_status_text: string | null; period: number | null; game_clock: string | null;
};
export type NbaTeamRow = {
  slate_id: number; team_id: number; fantasy_points: number; finish_position: number | null;
  games_completed: number; games_in_progress: number; games_remaining: number;
};
export type FantasyContext = {
  slate: FantasySlate; lineups: NbaLineup[]; players: NbaPlayer[];
  pins: { game_id: string; game_code: string | null; game_date: string }[];
  previous: NbaStatRow[];
};
export type FantasyNotifications = {
  slate: FantasySlate & { sport: "nba" }; players: NbaPlayer[]; lineups: NbaLineup[];
  previousStatuses: { playerId: number; gameStatus: number | null }[];
  currentStats: NbaStatRow[]; teamResults: NbaTeamRow[]; completed: boolean;
};
export type NbaConsumerResult = { summary: Record<string, unknown>; delaySeconds: number };
