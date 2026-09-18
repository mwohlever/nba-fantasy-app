export const SPORTS_HEADSHOT_BUCKET = "sports-headshots";

function numericProviderId(value: number | string | null | undefined) {
  const id = String(value ?? "").trim();
  return /^\d+$/.test(id) ? id : null;
}

export function getNbaProviderHeadshotUrl(
  nbaPlayerId: number | string | null | undefined,
) {
  const playerId = numericProviderId(nbaPlayerId);
  return playerId
    ? `https://cdn.nba.com/headshots/nba/latest/1040x760/${playerId}.png`
    : null;
}

export function getNflProviderHeadshotUrl(
  nflPlayerId: number | string | null | undefined,
) {
  const playerId = numericProviderId(nflPlayerId);
  return playerId
    ? `https://a.espncdn.com/i/headshots/nfl/players/full/${playerId}.png`
    : null;
}

export function isOptimizedSportsHeadshotUrl(
  url: string | null | undefined,
) {
  return String(url ?? "").includes(
    `/storage/v1/object/public/${SPORTS_HEADSHOT_BUCKET}/`,
  );
}
