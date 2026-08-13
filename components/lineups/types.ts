export type GolfHoleStat = {
  hole_number: number;
  par?: number | null;
  yards?: number | null;
  strokes: number | null;
  relative_to_par: number | null;
  score_display: string | null;
};

export type GolfRoundStat = {
  round_number: number;
  score_to_par: number | null;
  score_display: string | null;
  strokes: number | null;
  holes_completed: number;
  tee_time?: string | null;
  tee_time_raw?: string | null;
  status: string;
  holes: GolfHoleStat[];
};

export type Player = {
  id: number;
  name: string;
  position_group: string;
  is_active: boolean;
  is_playing_today?: boolean | null;
  nba_player_id?: number | null;
  nfl_player_id?: number | null;
  espn_player_id?: string | null;
  country?: string | null;
  country_flag_url?: string | null;
  headshot_url?: string | null;
  owgr_player_id?: string | null;
  owgr_rank?: number | null;
  owgr_points?: number | null;
  owgr_updated_at?: string | null;
};

export type RosterSlotConfig = {
  sport: string;
  position: string;
  slot_count: number;
  display_order: number | null;
};

export type TargetDraftSlot = {
  teamId: number;
  teamName: string;
  positionGroup: string;
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
  sport?: string;
  has_cut?: boolean;
};

export type SavedLineup = {
  team_id: number;
  player_ids: number[];
  pregame_projected_points?: number | null;
};

export type PlayerStat = {
  player_id: number;

  points?: number | null;
  rebounds?: number | null;
  assists?: number | null;
  steals?: number | null;
  blocks?: number | null;
  turnovers?: number | null;

  passing_yards?: number | null;
  passing_tds?: number | null;
  passing_ints?: number | null;
  rushing_yards?: number | null;
  rushing_tds?: number | null;
  receiving_yards?: number | null;
  receiving_tds?: number | null;
  receptions?: number | null;
  fumbles_lost?: number | null;

  fantasy_points: number | null;

  game_status?: number | null;
  game_status_text?: string | null;
  period?: number | null;
  game_clock?: string | null;

  leaderboard_order?: number | null;
  official_score_to_par?: number | null;
  official_score_display?: string | null;
  penalty_strokes?: number | null;
  rounds_completed?: number | null;
  holes_completed?: number | null;
  current_round?: number | null;
  last_hole?: number | null;
  status?: string | null;
  tee_time?: string | null;
  tee_time_raw?: string | null;
  rounds?: GolfRoundStat[];
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
  rosterSlots?: RosterSlotConfig[];
  defaultViewMode?: ViewMode;
  sport?: string;
};

export type PositionFilter = string;
export type ViewMode = "draft" | "scoring";

export type OrderedTeam = Team & {
  is_participating?: boolean;
  draft_order?: number;
};
