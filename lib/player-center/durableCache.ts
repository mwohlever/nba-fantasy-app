import type { PresentableHistory } from "./presentation";
import type { CenterGame, CenterPlayer, CenterHistory } from "./types";
import { professionalSeason } from "./types";

type Row = Record<string, unknown>;
const object = (value: unknown): value is Row => !!value && typeof value === "object" && !Array.isArray(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === "string");
const count = (value: unknown, max = 110) => value === null || typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= max;
const timestamp = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));
const text = (value: unknown) => value === null || typeof value === "string";
const requireValue = (valid: unknown, message: string) => { if (!valid) throw new Error(`Invalid durable Player Center cache: ${message}`); };

export function cacheIsStale(history: CenterHistory, now: number) {
  const cache = history.coverage.cache;
  if (!cache) return true;
  const current = history.season >= professionalSeason(history.player.sport, new Date(now));
  const maxAge = current ? 86400000 : 7 * 86400000, cutoff = Date.parse(cache.asOf);
  return now - Date.parse(cache.checkedAt) > maxAge || current && now - cutoff > maxAge ||
    history.games.some(game => Date.parse(game.gameAt) <= now && (Date.parse(game.gameAt) > cutoff || game.status !== "final"));
}

/** Validate owner-published raw facts again at the application boundary. No Group scores are cached. */
export function decodeSeasonCache(row: Row, player: CenterPlayer, season: number, now: number): PresentableHistory {
  const sport = player.sport, max = sport === "nba" ? 110 : 25;
  requireValue(player.identity === "resolved" && row.provider === "espn" && row.sport === sport && row.phase === "regular" &&
    row.season === season && row.provider_player_id === player.providerPlayerId &&
    row[sport === "nba" ? "nba_local_player_id" : "nfl_local_player_id"] === player.playerId &&
    row[sport === "nba" ? "nfl_local_player_id" : "nba_local_player_id"] === null, "identity/season");
  requireValue(timestamp(row.as_of) && timestamp(row.checked_at) && Date.parse(row.as_of) <= Date.parse(row.checked_at) && Date.parse(row.checked_at) <= now, "source times");
  requireValue(count(row.expected_games, max) && count(row.observed_games, max) && row.observed_games !== null &&
    typeof row.complete === "boolean" && strings(row.issues) && typeof row.rollout_batch_id === "string" && row.rollout_batch_id.length > 0 &&
    typeof row.content_hash === "string" && /^[a-f0-9]{64}$/.test(row.content_hash), "coverage metadata");
  requireValue(Array.isArray(row.games) && row.games.length <= max && JSON.stringify(row.games).length <= 524288, "game payload size");
  const games: CenterGame[] = [], seen = new Set<string>();
  const lower = Date.parse(`${sport === "nba" ? season - 1 : season}-${sport === "nba" ? "09" : "07"}-01T00:00:00Z`);
  const upper = Date.parse(`${sport === "nba" ? season : season + 1}-${sport === "nba" ? "09" : "07"}-01T00:00:00Z`);
  for (const raw of row.games as unknown[]) {
    requireValue(object(raw), "game object"); const game = raw as Row;
    requireValue(game.provider === "espn" && game.providerPlayerId === player.providerPlayerId && game.season === season && game.phase === "regular" &&
      typeof game.eventId === "string" && /^[1-9]\d*$/.test(game.eventId) && !seen.has(game.eventId), "game identity/duplicate");
    requireValue(timestamp(game.gameAt) && Date.parse(game.gameAt) >= lower && Date.parse(game.gameAt) < upper &&
      timestamp(game.fetchedAt) && Date.parse(game.fetchedAt) <= Date.parse(row.checked_at as string) &&
      (game.status !== "final" || Date.parse(game.gameAt as string) <= Date.parse(row.checked_at as string)) &&
      ["final", "live", "scheduled", "unknown"].includes(String(game.status)) && ["played", "dnp", "unknown"].includes(String(game.participation)), "game state/times");
    requireValue([null, "home", "away"].includes(game.homeAway as string | null) && count(game.week, 18) &&
      ["teamId", "team", "opponentId", "opponent"].every(key => text(game[key])) && strings(game.issues) && strings(game.sources), "game context");
    requireValue(object(game.stats) && Object.entries(game.stats).every(([key, value]) => !/fantasy|projection/i.test(key) && (value === null || typeof value === "number" && Number.isFinite(value))), "raw statistics");
    seen.add(game.eventId as string); games.push(structuredClone(game) as CenterGame);
  }
  const cutoff = Date.parse(row.as_of as string);
  const observed = games.filter(game => Date.parse(game.gameAt) <= cutoff && game.status === "final" && game.participation === "played").length;
  requireValue(observed === row.observed_games && (!row.complete || row.expected_games === observed), "observation counts");
  let seasonStats: PresentableHistory["seasonStats"] = null, byeWeeks: number[] | null = null;
  if (row.season_stats !== null) {
    const stats = row.season_stats;
    requireValue(object(stats) && JSON.stringify(stats).length <= 524288 && stats.season === season && stats.phase === "regular" && count(stats.expectedGames, max) && strings(stats.issues) && Array.isArray(stats.categories), "season statistics");
    const s = stats as Row;
    requireValue((s.categories as unknown[]).every(category => object(category) && typeof category.name === "string" && text(category.teamId) && Array.isArray(category.fields) && category.fields.every(field => object(field) && typeof field.label === "string" && text(field.value))), "season fields");
    requireValue(s.expectedGames === null || row.expected_games === null || s.expectedGames === row.expected_games, "independent GP conflict");
    seasonStats = structuredClone(stats) as PresentableHistory["seasonStats"];
    if (s.byeWeeks !== undefined && s.byeWeeks !== null) {
      requireValue(sport === "nfl" && player.position === "D/ST" && Array.isArray(s.byeWeeks) && s.byeWeeks.every(week => Number.isInteger(week) && Number(week) >= 1 && Number(week) <= 18), "bye metadata");
      byeWeeks = [...s.byeWeeks as number[]];
    }
  }
  const current = season >= professionalSeason(sport, new Date(now)), maxAge = current ? 86400000 : 7 * 86400000;
  const stale = now - Date.parse(row.checked_at as string) > maxAge || current && now - cutoff > maxAge ||
    games.some(game => Date.parse(game.gameAt) <= now && (Date.parse(game.gameAt) > cutoff || game.status !== "final"));
  const issues = [...row.issues as string[], ...(!row.complete ? ["durable_cache_coverage_incomplete"] : []), ...(stale ? ["durable_cache_refresh_required"] : [])];
  return { player, season, phase: "regular", source: "stored", games, seasonStats, byeWeeks, providerRequests: 0,
    coverage: { kind: "season_cache", expectedGames: row.expected_games as number | null, fetchedAt: row.checked_at as string,
      freshness: stale ? "stale" : "fresh", issues,
      cache: { asOf: new Date(row.as_of as string).toISOString(), checkedAt: new Date(row.checked_at as string).toISOString(), complete: row.complete as boolean,
        batchId: row.rollout_batch_id as string, contentHash: row.content_hash as string } } };
}
