import { createHash } from "node:crypto";
import sharp from "sharp";

export const SPORTS_HEADSHOT_BUCKET = "sports-headshots";
export const SPORTS_HEADSHOT_SIZE = 128;
export const SPORTS_HEADSHOT_CONCURRENCY = 3;
export const NFL_DST_PLAYER_ID_BASE = 100_000_000;

export const SPORTS_HEADSHOT_CONFIG = {
  nba: {
    table: "players",
    idColumn: "nba_player_id",
    providerUrl: (id) => `https://cdn.nba.com/headshots/nba/latest/1040x760/${id}.png`,
  },
  nfl: {
    table: "players_nfl",
    idColumn: "nfl_player_id",
    providerUrl: (id) => `https://a.espncdn.com/i/headshots/nfl/players/full/${id}.png`,
  },
};

export function isCachedSportsHeadshot(url) {
  return String(url ?? "").includes(`/storage/v1/object/public/${SPORTS_HEADSHOT_BUCKET}/`);
}

export function getSupportedProviderPlayerId(sport, value) {
  const id = String(value ?? "");
  if (!/^\d+$/.test(id)) return null;
  if (sport === "nfl" && Number(id) >= NFL_DST_PLAYER_ID_BASE) return null;
  return id;
}

async function fetchProviderHeadshot(url, fetchImpl = fetch) {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`Provider returned ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function optimizeSportsHeadshot(source) {
  return sharp(source, { failOn: "none", limitInputPixels: 16_000_000 })
    .rotate()
    .resize(SPORTS_HEADSHOT_SIZE, SPORTS_HEADSHOT_SIZE, {
      fit: "cover",
      position: "centre",
      withoutEnlargement: true,
    })
    .webp({ quality: 82, effort: 4 })
    .toBuffer();
}

/**
 * Persists one provider headshot. This intentionally has no caller-side
 * assumptions: callers may use it from a CLI repair tool or post-sync work,
 * but never from a page render or scoring request.
 */
export async function cacheSportsHeadshot({
  client,
  sport,
  player,
  fetchImpl = fetch,
  optimizeImage = optimizeSportsHeadshot,
}) {
  const config = SPORTS_HEADSHOT_CONFIG[sport];
  if (!config) throw new Error(`Unsupported sport: ${sport}`);

  const providerId = getSupportedProviderPlayerId(sport, player[config.idColumn]);
  if (!providerId) throw new Error("Missing or unsupported provider player ID");

  const source = await fetchProviderHeadshot(config.providerUrl(providerId), fetchImpl);
  const optimized = await optimizeImage(source);
  const hash = createHash("sha256").update(optimized).digest("hex");
  const storagePath = `${sport}/${providerId}.webp`;
  const storage = client.storage.from(SPORTS_HEADSHOT_BUCKET);
  const { error: uploadError } = await storage.upload(storagePath, optimized, {
    contentType: "image/webp",
    cacheControl: "31536000",
    upsert: true,
  });
  if (uploadError) throw new Error(`Storage upload: ${uploadError.message}`);

  const { data } = storage.getPublicUrl(storagePath);
  const { error: updateError } = await client
    .from(config.table)
    .update({ headshot_url: `${data.publicUrl}?v=${hash.slice(0, 12)}` })
    .eq("id", player.id);
  if (updateError) throw new Error(`Player update: ${updateError.message}`);
}

/**
 * Runs a bounded best-effort pass. Failures are reported to the caller but do
 * not throw, so player discovery is always independent of image availability.
 */
export async function cacheSportsHeadshots({
  client,
  sport,
  players,
  force = false,
  concurrency = SPORTS_HEADSHOT_CONCURRENCY,
  cacheOne = cacheSportsHeadshot,
  onCached = undefined,
  onFailed = undefined,
}) {
  const config = SPORTS_HEADSHOT_CONFIG[sport];
  if (!config) throw new Error(`Unsupported sport: ${sport}`);

  const counts = { cached: 0, skipped: 0, failed: 0 };
  const pending = players.filter((player) => {
    if (!getSupportedProviderPlayerId(sport, player[config.idColumn])) {
      counts.skipped += 1;
      return false;
    }
    if (!force && isCachedSportsHeadshot(player.headshot_url)) {
      counts.skipped += 1;
      return false;
    }
    return true;
  });

  for (let index = 0; index < pending.length; index += concurrency) {
    await Promise.all(pending.slice(index, index + concurrency).map(async (player) => {
      try {
        await cacheOne({ client, sport, player });
        counts.cached += 1;
        onCached?.(player);
      } catch (error) {
        counts.failed += 1;
        onFailed?.(player, error);
      }
    }));
  }

  return counts;
}
