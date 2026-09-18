export const GOLF_HEADSHOT_BUCKET = "golf-headshots";

export function getGolfProviderHeadshotUrl(
  espnPlayerId: string | null | undefined,
) {
  const playerId = String(espnPlayerId ?? "").trim();

  if (!/^\d+$/.test(playerId)) return null;

  return `https://a.espncdn.com/i/headshots/golf/players/full/${playerId}.png`;
}

export function isOptimizedGolfHeadshotUrl(
  url: string | null | undefined,
) {
  return String(url ?? "").includes(
    `/storage/v1/object/public/${GOLF_HEADSHOT_BUCKET}/`,
  );
}
