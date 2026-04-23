export type Player = {
  id: number;
  name: string;
  position_group: "G" | "F/C";
  is_active: boolean;
  is_playing_today?: boolean | null;
};

export type PlayerHistoryDetailRow = {
  slateId: number;
  playerId: number;
  date: string | null;
  fantasyPoints: number;
  points: number;
  rebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
  isLocked: boolean;
};

export type Team = {
  id: number;
  name: string;
};

export type Slate = {
  id: number;
  date: string;
  start_date?: string;
  end_date?: string;
  label?: string;
  is_locked: boolean;
};

export type SavedLineup = {
  team_id: number;
  player_ids: number[];
};

export type PlayerStat = {
  player_id: number;
  points: number | null;
  rebounds: number | null;
  assists: number | null;
  steals: number | null;
  blocks: number | null;
  turnovers: number | null;
  fantasy_points: number | null;
};

export type TeamResult = {
  team_id: number;
  fantasy_points: number | null;
  finish_position: number | null;
  games_completed: number | null;
  games_in_progress: number | null;
  games_remaining: number | null;
};

export type SlateTeamConfig = {
  slate_id: number;
  team_id: number;
  draft_order: number;
  is_participating: boolean;
};

export type PlayerAverage = {
  player_id: number;
  avg_fantasy_points: number;
};

export type Props = {
  players: Player[];
  teams: Team[];
  slates: Slate[];
  slateTeamConfigs: SlateTeamConfig[];
  playerAverages: PlayerAverage[];
  initialSelectedSlateId: number | null;
  savedLineupsForInitialSlate: SavedLineup[];
  playerStats: PlayerStat[];
  teamResults: TeamResult[];
  defaultViewMode?: ViewMode;
};

export type PositionFilter = "All" | "G" | "F/C";
export type ViewMode = "draft" | "scoring";

export type OrderedTeam = Team & {
  is_participating?: boolean;
  draft_order?: number;
};
