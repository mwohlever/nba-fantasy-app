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
  possiblePoints: number;
  awardedPoints: number;
  correct: boolean | null;
};

export type BracketScore = {
  points: number;
  possibleSettledPoints: number;
  correctPicks: number;
  incorrectPicks: number;
  unsettledPicks: number;
  unmadePicks: number;
  breakdown: BracketScoreBreakdown[];
};
