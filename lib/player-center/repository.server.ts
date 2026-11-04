import "server-only";
import { supabaseAdmin } from "../supabaseAdmin";
import { resolveStoredNbaProviderIdentity, type NbaProviderIdentity } from "../analytics/nba/projectionInfrastructure";
import { finiteStat, professionalSeason, type CenterGame, type CenterHistory, type CenterPlayer, type CenterSport } from "./types";
import { decodeSeasonCache } from "./durableCache";
import type { PresentableHistory } from "./presentation";
import { applyNbaRefreshStatus } from "./nbaRefresh";

type Row = Record<string, unknown>;
const numericId = (value: unknown) => /^\d+$/.test(String(value ?? "")) && Number(value) > 0 ? String(value) : null;
const nullableText = (value: unknown) => typeof value === "string" && value.trim() ? value : null;

export type CenterCatalog = { players: CenterPlayer[]; readAt: string };
export interface CenterRepository {
  catalog(sport: CenterSport): Promise<CenterCatalog>;
  histories(sport: CenterSport, season: number, catalog: CenterCatalog, asOf: string): Promise<CenterHistory[]>;
  profileSnapshot?(player: CenterPlayer, season: number): Promise<PresentableHistory | null>;
}

/** Only SELECT queries. No ingest/refresh routines or mutation-capable repository methods. */
export class SupabaseCenterRepository implements CenterRepository {
  constructor(private readonly db = supabaseAdmin, private readonly now: () => number = Date.now) {}
  private async catalogRows(table: string, columns: string, order: string, season?: number | string) {
    const rows: Row[] = [];
    for (let offset = 0; offset < 3000; offset += 1000) {
      let query = this.db.from(table).select(columns);
      if (season !== undefined) query = query.eq("season", season);
      const result = await query.order(order).range(offset, offset + 999);
      if (result.error) throw new Error(`Player Center catalog read failed: ${result.error.message}`);
      const page = result.data as unknown as Row[];
      rows.push(...page);
      if (page.length < 1000) return rows;
    }
    throw new Error("Player Center catalog row limit exceeded");
  }
  async catalog(sport: CenterSport): Promise<CenterCatalog> {
    const [local, stored] = await Promise.all([
      this.catalogRows(sport === "nba" ? "players" : "players_nfl",
        sport === "nba" ? "id,name,nba_player_id,position_group,is_active" : "id,name,nfl_player_id,position,is_active", "id"),
      sport === "nba" ? this.catalogRows("nba_player_provider_identities", "provider,provider_player_id,player_id,provider_name,resolution_status,resolution_method,evidence,is_locked", "provider_player_id") : Promise.resolve([]),
    ]);
    const identities: NbaProviderIdentity[] = stored.map(row => ({ provider: "espn", providerPlayerId: String(row.provider_player_id),
      playerId: row.player_id == null ? null : Number(row.player_id), providerName: nullableText(row.provider_name),
      status: row.resolution_status as NbaProviderIdentity["status"], method: row.resolution_method as NbaProviderIdentity["method"],
      evidence: String(row.evidence ?? ""), locked: row.is_locked === true }));
    const players: CenterPlayer[] = local.map(row => {
      const nativePlayerId = numericId(sport === "nba" ? row.nba_player_id : row.nfl_player_id);
      let providerPlayerId: string | null = sport === "nfl" ? nativePlayerId : null;
      const mapped = identities.filter(identity => identity.playerId === Number(row.id) && identity.status === "resolved");
      let identity: CenterPlayer["identity"] = providerPlayerId ? "resolved" : "unresolved";
      if (sport === "nba" && mapped.length) {
        const resolved = resolveStoredNbaProviderIdentity(mapped[0].providerPlayerId, identities);
        if (mapped.length === 1 && resolved.status === "resolved" && resolved.playerId === Number(row.id) && nativePlayerId && mapped[0].evidence.trim()) {
          providerPlayerId = mapped[0].providerPlayerId;
          identity = "resolved";
        } else identity = "conflict";
      }
      if (nativePlayerId && local.filter(other => numericId(sport === "nba" ? other.nba_player_id : other.nfl_player_id) === nativePlayerId).length > 1) identity = "conflict";
      return { sport, playerId: Number(row.id), name: String(row.name), position: String(sport === "nba" ? row.position_group : row.position), active: row.is_active === true,
        nativePlayerId, providerPlayerId: identity === "resolved" ? providerPlayerId : null, identity };
    });
    // Historical inactive players are still addressable by a specific profile. The batch caller can choose the pool.
    return { players, readAt: new Date(this.now()).toISOString() };
  }
  private async seasonSnapshots(sport: CenterSport, season: number, catalog: CenterCatalog, playerId?: number) {
    const snapshots = new Map<number, PresentableHistory>();
    const rejected = new Set<number>();
    try {
      for (let offset = 0; offset < 3000; offset += 25) {
        let query = this.db.from("player_center_season_cache").select("*").eq("sport", sport).eq("provider", "espn").eq("season", season).eq("phase", "regular");
        if (playerId !== undefined) query = query.eq(sport === "nba" ? "nba_local_player_id" : "nfl_local_player_id", playerId);
        const result = await query.order("provider_player_id").range(offset, offset + 24);
        if (result.error) return { snapshots: new Map<number, PresentableHistory>(), issue: "durable_cache_unavailable" };
        const page = result.data as unknown as Row[];
        for (const row of page) {
          const id = Number(row[sport === "nba" ? "nba_local_player_id" : "nfl_local_player_id"]);
          const player = catalog.players.find(player => player.playerId === id);
          if (!player) continue;
          try {
            if (snapshots.has(id) || rejected.has(id)) throw new Error("Conflicting cache identity");
            snapshots.set(id, decodeSeasonCache(row, player, season, this.now()));
          } catch { snapshots.delete(id); rejected.add(id); }
        }
        if (page.length < 25) {
          if (sport === "nba" && snapshots.size) {
            try {
              const statuses = await this.catalogRows("player_center_nba_refresh_status", "*", "player_id", season);
              for (const [id, history] of snapshots) applyNbaRefreshStatus(history, statuses.find(row => Number(row.player_id) === id));
            } catch {
              for (const history of snapshots.values()) {
                history.coverage.comparisonEligible = false;
                history.coverage.freshness = "stale";
                history.coverage.issues.push("refresh_status_unavailable");
              }
            }
          }
          return { snapshots, issue: rejected.size ? "durable_cache_invalid_or_conflicting" : "durable_cache_missing" };
        }
      }
    } catch { /* A cache outage cannot authorize partial publication or break drafting. */ }
    return { snapshots: new Map<number, PresentableHistory>(), issue: "durable_cache_unavailable" };
  }
  async profileSnapshot(player: CenterPlayer, season: number) {
    const read = await this.seasonSnapshots(player.sport, season, { players: [player], readAt: new Date(this.now()).toISOString() }, player.playerId);
    return read.snapshots.get(player.playerId) ?? null;
  }
  async histories(sport: CenterSport, season: number, catalog: CenterCatalog, asOf: string): Promise<CenterHistory[]> {
    const read = await this.seasonSnapshots(sport, season, catalog);
    const absent = catalog.players.filter(player => !read.snapshots.has(player.playerId));
    let fallback: CenterHistory[] = [];
    if (absent.length) {
      try { fallback = await this.storedHistories(sport, season, { ...catalog, players: absent }, asOf); }
      catch { fallback = absent.map(player => ({ player, season, phase: "regular", source: "stored", games: [], coverage: {
        kind: "unavailable", expectedGames: null, fetchedAt: null, freshness: "unavailable", issues: ["stored_observations_unavailable"] } })); }
      for (const history of fallback) { history.coverage.comparisonEligible = false; history.coverage.issues.push(read.issue); }
    }
    return catalog.players.map(player => read.snapshots.get(player.playerId) ?? fallback.find(history => history.player.playerId === player.playerId)!);
  }
  private async storedHistories(sport: CenterSport, season: number, catalog: CenterCatalog, asOf: string): Promise<CenterHistory[]> {
    const table = sport === "nba" ? "nba_player_game_current_observations" : "nfl_player_game_observations";
    const fields: string = sport === "nba"
      ? "provider,provider_player_id,provider_event_id,local_player_id,season,phase,game_at,team_provider_id,team_abbreviation,opponent_provider_id,opponent_abbreviation,home_away,minutes,points,rebounds,assists,steals,blocks,turnovers,source_url,provider_fetched_at"
      : "provider,provider_player_id,provider_event_id,local_player_id,season,phase,game_at,week,team_provider_id,team_abbreviation,opponent_provider_id,opponent_abbreviation,home_away,completions,passing_attempts,passing_yards,passing_touchdowns,interceptions,rushing_attempts,rushing_yards,rushing_touchdowns,receiving_targets,receptions,receiving_yards,receiving_touchdowns,fumbles_lost,game_log_source_url,game_log_fetched_at,fumble_summary_source_url";
    const histories = new Map<number, CenterHistory>(catalog.players.map(player => [player.playerId, {
      player, season, phase: "regular", source: "stored", games: [],
      coverage: { kind: "stored_appearances", expectedGames: null, fetchedAt: null, freshness: "unavailable", issues: ["stored_appearance_coverage_unverified"] },
    }]));
    let finished = false;
    const seen = new Set<string>();
    for (let offset = 0; offset < 30_000; offset += 1000) {
      const result = await this.db.from(table).select(fields).eq("provider", "espn").eq("season", season).eq("phase", "regular")
        .lte("game_at", asOf).order("local_player_id").order("provider_event_id").range(offset, offset + 999);
      if (result.error) throw new Error(`Player Center observation read failed: ${result.error.message}`);
      const page = result.data as unknown as Row[];
      for (const row of page) {
        const history = histories.get(Number(row.local_player_id));
        if (!history || history.player.identity !== "resolved" || String(row.provider_player_id) !== history.player.providerPlayerId) continue;
        const eventId = numericId(row.provider_event_id), key = `${history.player.playerId}:${eventId}`;
        if (!eventId || seen.has(key) || !Number.isFinite(Date.parse(String(row.game_at)))) throw new Error("Ambiguous stored event history");
        seen.add(key);
        const statNames = sport === "nba" ? ["minutes", "points", "rebounds", "assists", "steals", "blocks", "turnovers"] :
          ["completions", "passing_attempts", "passing_yards", "rushing_attempts", "rushing_yards", "receiving_targets", "receptions", "receiving_yards", "fumbles_lost"];
        const stats = Object.fromEntries(statNames.map(name => [name, finiteStat(row[name])]));
        if (sport === "nfl") Object.assign(stats, { passing_tds: finiteStat(row.passing_touchdowns), passing_ints: finiteStat(row.interceptions),
          rushing_tds: finiteStat(row.rushing_touchdowns), receiving_tds: finiteStat(row.receiving_touchdowns) });
        const fetchedAt = String(sport === "nba" ? row.provider_fetched_at : row.game_log_fetched_at);
        const game: CenterGame = { provider: "espn", providerPlayerId: String(row.provider_player_id), eventId, season, phase: "regular",
          gameAt: new Date(String(row.game_at)).toISOString(), week: finiteStat(row.week), teamId: numericId(row.team_provider_id), team: nullableText(row.team_abbreviation),
          opponentId: numericId(row.opponent_provider_id), opponent: nullableText(row.opponent_abbreviation),
          homeAway: row.home_away === "home" || row.home_away === "away" ? row.home_away : null,
          status: "final", participation: "played", stats,
          sources: [nullableText(sport === "nba" ? row.source_url : row.game_log_source_url), nullableText(row.fumble_summary_source_url)].filter((s): s is string => s !== null),
          fetchedAt, issues: Number.isFinite(Date.parse(fetchedAt)) && Date.parse(fetchedAt) <= this.now() ? [] : ["invalid_source_timestamp"] };
        history.games.push(game);
        if (Number.isFinite(Date.parse(fetchedAt)) && (!history.coverage.fetchedAt || fetchedAt < history.coverage.fetchedAt)) history.coverage.fetchedAt = fetchedAt;
      }
      if (page.length < 1000) { finished = true; break; }
    }
    if (!finished) throw new Error("Player Center observation row limit exceeded");
    // Exact provider IDs and professional season only. These are independent appearance counts,
    // not a substitute for absent current-season observations or a last-successful-poll marker.
    const seasonCounts = await this.catalogRows(sport === "nba" ? "player_nba_season_averages" : "player_nfl_season_stats",
      sport === "nba" ? "season,nba_player_id,games_played" : "season,nfl_player_id,games_played", sport === "nba" ? "nba_player_id" : "nfl_player_id",
      sport === "nba" ? `${season - 1}-${String(season).slice(-2)}` : season).catch(() => [] as Row[]);
    for (const history of histories.values()) {
      const countRows = seasonCounts.filter(row => sport === "nba"
        ? row.season === `${season - 1}-${String(season).slice(-2)}` && numericId(row.nba_player_id) === history.player.nativePlayerId
        : Number(row.season) === season && numericId(row.nfl_player_id) === history.player.providerPlayerId);
      const count = countRows.length === 1 ? finiteStat(countRows[0].games_played) : null;
      if (count !== null && Number.isInteger(count) && count >= 0) history.coverage.expectedGames = count;
      history.games.sort((a, b) => b.gameAt.localeCompare(a.gameAt));
      if (!history.games.length) history.coverage.issues.push(history.player.identity === "resolved" ? "no_stored_games" : "unresolved_player_identity");
      if (history.player.position === "K" || history.player.position === "D/ST") history.coverage.issues.push("position_not_in_observation_store");
      const maxAge = season < professionalSeason(sport, new Date(this.now())) ? 7 * 86_400_000 : 36 * 3_600_000;
      history.coverage.freshness = !history.coverage.fetchedAt ? "unavailable" : this.now() - Date.parse(history.coverage.fetchedAt) <= maxAge && Date.parse(history.coverage.fetchedAt) <= this.now() ? "fresh" : "stale";
      if (history.coverage.freshness === "stale") history.coverage.issues.push("stored_source_timestamp_old");
    }
    return [...histories.values()];
  }
}
