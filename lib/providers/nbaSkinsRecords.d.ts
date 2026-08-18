export type NbaSkinsSeasonRecord = {
  abbreviation: string;
  displayName: string;
  espnTeamId: string | null;
  wins: number;
  losses: number;
  gamesPlayed: number;
};

export type NbaSkinsSeasonProjection = {
  abbreviation: string;
  displayName: string;
  espnTeamId: string | null;
  projectedWins: number;
  projectedLosses: number;
};

export function normalizeTeamCode(
  value: unknown,
): string | null;

export function espnSeasonForSkinsSeason(
  skinsSeason: number,
): number;

export function fetchNbaSkinsSeasonRecords(
  skinsSeason: number,
): Promise<{
  skinsSeason: number;
  espnSeason: number;
  records: NbaSkinsSeasonRecord[];
}>;

export function fetchNbaSkinsSeasonProjections(
  skinsSeason: number,
): Promise<{
  skinsSeason: number;
  espnSeason: number;
  source: string;
  projections: NbaSkinsSeasonProjection[];
}>;
