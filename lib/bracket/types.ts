export type BracketTeamId = string;
export type BracketGameId = string;
export type BracketRoundKey = string;

export type BracketSource =
  | {
      type: "team";
      teamId: BracketTeamId;
    }
  | {
      type: "winner";
      gameId: BracketGameId;
    };

export type BracketGame = {
  id: BracketGameId;
  roundKey: BracketRoundKey;
  roundOrder: number;
  gameOrder: number;
  sources: [BracketSource, BracketSource];
};

export type BracketTopology = {
  games: BracketGame[];
};

export type BracketPicks = Record<BracketGameId, BracketTeamId | null | undefined>;

export type BracketResults = Record<BracketGameId, BracketTeamId | null | undefined>;

export type BracketScoringRules = Record<BracketRoundKey, number>;

export type ResolvedBracketGame = BracketGame & {
  teamIds: [BracketTeamId | null, BracketTeamId | null];
};

export type BracketScoreBreakdown = {
  gameId: BracketGameId;
  roundKey: BracketRoundKey;
  pickedTeamId: BracketTeamId | null;
  winnerTeamId: BracketTeamId | null;
  /**
   * `eliminated` means the pick cannot be correct because its team lost an
   * earlier official game. It is deliberately distinct from `incorrect`,
   * which is reserved for a game with a final official winner.
   */
  status: BracketPickStatus;
  possiblePoints: number;
  awardedPoints: number;
  correct: boolean | null;
};

export type BracketPickStatus =
  | "unmade"
  | "pending"
  | "correct"
  | "incorrect"
  | "eliminated";

export type BracketRoundScore = {
  roundKey: BracketRoundKey;
  roundOrder: number;
  pointsEarned: number;
  pointsStillAvailable: number;
  maxPossibleScore: number;
  correctPicks: number;
  incorrectPicks: number;
  pendingPicks: number;
  eliminatedPicks: number;
  unmadePicks: number;
};

export type BracketScore = {
  /** Backward-compatible alias for pointsEarned. */
  points: number;
  pointsEarned: number;
  pointsStillAvailable: number;
  maxPossibleScore: number;
  totalPotentialAtLock: number;
  pointsLost: number;
  possibleSettledPoints: number;
  correctPicks: number;
  incorrectPicks: number;
  pendingPicks: number;
  eliminatedPicks: number;
  unsettledPicks: number;
  unmadePicks: number;
  breakdown: BracketScoreBreakdown[];
  rounds: BracketRoundScore[];
};
