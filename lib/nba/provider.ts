import {
  fetchNbaSkinsSeasonRecords, fetchNbaSkinsSeasonProjections, normalizeTeamCode,
} from "@/lib/providers/nbaSkinsRecords.mjs";
import type { NbaGame, NbaBox, NbaStandings, NbaProjections, NbaPlayerStats } from "./types";

type Raw = Record<string, unknown>;
const NBA = "https://cdn.nba.com/static/json/";
export const NBA_SCHEDULE_URL = `${NBA}staticData/scheduleLeagueV2.json`;
export const NBA_SCOREBOARD_URL = `${NBA}liveData/scoreboard/todaysScoreboard_00.json`;
const headers = { Accept: "application/json,text/plain,*/*", "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36", Referer: "https://www.nba.com/", Origin: "https://www.nba.com" };
function object(value: unknown): Raw {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("provider:invalid_object");
  return value as Raw;
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("provider:incomplete_array");
  return value;
}
function number(value: unknown) {
  if (typeof value !== "number" && typeof value !== "string" || typeof value === "string" && !value.trim()
    || !Number.isFinite(Number(value))) throw new Error("provider:invalid_stat");
  return Number(value);
}
function status(value: unknown): 1 | 2 | 3 {
  const result = number(value);
  if (result !== 1 && result !== 2 && result !== 3) throw new Error("provider:invalid_status");
  return result;
}
function team(value: unknown) {
  const result = normalizeTeamCode(object(value).teamTricode);
  if (!result || !/^[A-Z]{3}$/.test(result)) throw new Error("provider:invalid_team");
  return result;
}
export function normalizeNbaScheduleGame(value: unknown): NbaGame {
  const raw = object(value), gameId = String(raw.gameId ?? ""), gameCode = String(raw.gameCode ?? "");
  if (!/^\d{10}$/.test(gameId) || !/^\d{8}\/[A-Z]{6}$/.test(gameCode)) throw new Error("provider:invalid_game_identity");
  const date = `${gameCode.slice(0, 4)}-${gameCode.slice(4, 6)}-${gameCode.slice(6, 8)}`;
  const startAt = typeof raw.gameDateTimeUTC === "string" && Number.isFinite(Date.parse(raw.gameDateTimeUTC)) ? raw.gameDateTimeUTC
    : typeof raw.gameTimeUTC === "string" && Number.isFinite(Date.parse(raw.gameTimeUTC)) ? raw.gameTimeUTC : null;
  const home = team(raw.homeTeam), away = team(raw.awayTeam);
  if (home === away) throw new Error("provider:ambiguous_teams");
  return Object.freeze({ provider: "nba.com", gameId, gameCode, date, startAt, status: status(raw.gameStatus), statusText: String(raw.gameStatusText ?? ""), home, away });
}
export function normalizeNbaBox(value: unknown, expected: NbaGame): NbaBox {
  const raw = object(object(value).game), gameId = String(raw.gameId ?? "");
  if (gameId !== expected.gameId) throw new Error("provider:boxscore_identity_mismatch");
  const gameStatus = status(raw.gameStatus), home = team(raw.homeTeam), away = team(raw.awayTeam);
  if (gameStatus === 3 && /POSTPON|SUSPEND|CANCEL|UNNECESSARY/i.test(String(raw.gameStatusText ?? ""))) throw new Error("provider:unresolved_final_status");
  if (home !== expected.home || away !== expected.away) throw new Error("provider:boxscore_team_mismatch");
  const ids = new Set<number>();
  const players = [raw.homeTeam, raw.awayTeam].flatMap(side => {
    const sideRaw = object(side), code = team(side), rows = array(sideRaw.players);
    if (gameStatus !== 1 && rows.length < 5) throw new Error("provider:incomplete_boxscore_roster");
    return rows.map(value => {
      const player = object(value), personId = number(player.personId), stats = object(player.statistics);
      if (!Number.isSafeInteger(personId) || personId <= 0 || ids.has(personId)) throw new Error("provider:duplicate_or_invalid_player");
      ids.add(personId);
      const normalized: NbaPlayerStats = {
        points: number(stats.points), rebounds: number(stats.reboundsTotal), assists: number(stats.assists),
        steals: number(stats.steals), blocks: number(stats.blocks), turnovers: number(stats.turnovers),
      };
      if (Object.values(normalized).some(value => !Number.isSafeInteger(value) || value < 0)) throw new Error("provider:invalid_player_statistics");
      return Object.freeze({ personId, team: code, stats: Object.freeze(normalized) });
    });
  });
  if (expected.status === 3 && gameStatus !== 3) throw new Error("provider:final_status_regression");
  return Object.freeze({ provider: "nba.com", gameId, status: gameStatus, statusText: String(raw.gameStatusText ?? expected.statusText),
    period: raw.period == null ? null : number(raw.period), clock: typeof raw.gameClock === "string" ? raw.gameClock : null,
    home, away, players: Object.freeze(players) });
}

/** Invocation-local, promise-deduplicated immutable inputs. Rejections are cached too. No scoring/storage here. */
export class NbaProvider {
  private cache = new Map<string, Promise<unknown>>();
  requests = 0;
  readonly counts: Record<string, number> = {};
  readonly failures: Record<string, number> = {};
  constructor(private deadline = Date.now() + 45_000, private maxRequests = 80) {}
  private memo<T>(key: string, acquire: () => Promise<T>): Promise<T> {
    if (!this.cache.has(key)) this.cache.set(key, acquire().catch(error => {
      const kind = key.split(":")[0];
      this.failures[kind] = (this.failures[kind] ?? 0) + 1;
      throw error;
    }));
    return this.cache.get(key)! as Promise<T>;
  }
  private request: typeof fetch = async (url, options) => {
    if (Date.now() >= this.deadline || this.requests >= this.maxRequests) throw new Error("provider:invocation_budget_exhausted");
    const key = String(url).includes("boxscore_") ? "nba_boxscore" : String(url).includes("scheduleLeague") ? "nba_schedule"
      : String(url).includes("scoreboard") ? "nba_scoreboard" : String(url).includes("/bpi/") ? "espn_bpi" : "espn_standings";
    const nbaRequest = key.startsWith("nba_");
    const used = Object.entries(this.counts).filter(([kind]) => kind.startsWith("nba_") === nbaRequest).reduce((sum, [, count]) => sum + count, 0);
    // Reserve eight of the default 80 requests for Skins; neither game can spend the other's request allocation.
    const limit = nbaRequest ? this.maxRequests > 8 ? this.maxRequests - 8 : this.maxRequests : Math.min(8, this.maxRequests);
    if (used >= limit) throw new Error(`provider:${nbaRequest ? "nba" : "skins"}:request_budget_exhausted`);
    this.requests++;
    this.counts[key] = (this.counts[key] ?? 0) + 1;
    try {
      return await fetch(url, { ...options, cache: "no-store", signal: AbortSignal.timeout(Math.max(1, Math.min(5000, this.deadline - Date.now()))) });
    } catch { throw new Error(`provider:${key}:request_failed`); }
  };
  private async json(url: string) {
    const response = await this.request(url, { headers });
    if (!response.ok) throw new Error(`provider:nba:http_${response.status}`);
    try { return await response.json() as unknown; } catch { throw new Error("provider:nba:invalid_json"); }
  }
  schedule(): Promise<readonly NbaGame[]> {
    return this.memo("schedule", async () => {
      const raw = object(object(await this.json(NBA_SCHEDULE_URL)).leagueSchedule);
      const games = array(raw.gameDates).flatMap(day => array(object(day).games))
        .filter(game => object(game).gameStatusText !== "UNNECESSARY").map(normalizeNbaScheduleGame);
      if (!games.length || games.length > 2500 || new Set(games.map(game => game.gameId)).size !== games.length) throw new Error("provider:incomplete_or_duplicate_schedule");
      return Object.freeze(games);
    });
  }
  scoreboard(): Promise<readonly NbaGame[]> {
    return this.memo("scoreboard", async () => {
      const raw = object(object(await this.json(NBA_SCOREBOARD_URL)).scoreboard);
      const games = array(raw.games).map(normalizeNbaScheduleGame);
      if (new Set(games.map(game => game.gameId)).size !== games.length) throw new Error("provider:duplicate_scoreboard_game");
      return Object.freeze(games);
    });
  }
  box(game: NbaGame): Promise<NbaBox> {
    return this.memo(`box:${game.gameId}`, async () => normalizeNbaBox(await this.json(`${NBA}liveData/boxscore/boxscore_${game.gameId}.json`), game));
  }
  standings(season: number): Promise<NbaStandings> {
    return this.memo(`standings:${season}`, async () => {
      const result = await fetchNbaSkinsSeasonRecords(season, this.request);
      if (result.skinsSeason !== season || result.espnSeason !== season + 1 || result.records.length !== 30
        || new Set(result.records.map(row => row.abbreviation)).size !== 30
        || result.records.some(row => !Number.isInteger(row.wins) || !Number.isInteger(row.losses) || row.wins < 0 || row.losses < 0
          || row.gamesPlayed !== row.wins + row.losses || row.gamesPlayed > 82)) throw new Error("provider:invalid_standings");
      return Object.freeze({ ...result, provider: "espn", records: Object.freeze(result.records.map(row => Object.freeze({ ...row }))) });
    });
  }
  projections(season: number): Promise<NbaProjections> {
    return this.memo(`projections:${season}`, async () => {
      const result = await fetchNbaSkinsSeasonProjections(season, this.request);
      if (result.skinsSeason !== season || result.espnSeason !== season + 1 || result.projections.length !== 30
        || new Set(result.projections.map(row => row.abbreviation)).size !== 30
        || result.projections.some(row => !Number.isFinite(row.projectedWins) || !Number.isFinite(row.projectedLosses)
          || row.projectedWins < 0 || row.projectedLosses < 0 || Math.abs(row.projectedWins + row.projectedLosses - 82) > 0.05)) throw new Error("provider:invalid_projections");
      return Object.freeze({ ...result, provider: "espn-bpi", projections: Object.freeze(result.projections.map(row => Object.freeze({ ...row }))) });
    });
  }
}
