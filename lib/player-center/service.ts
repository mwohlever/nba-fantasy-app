import { BoundedReadCache, ReadBudget } from "./cache";
import { comparisonStats, compareHistories, fantasyPointsFromStats } from "./comparison";
import { presentProfile, type PresentableHistory } from "./presentation";
import { seasonReadFacts } from "./seasonFacts";
import { CenterEspnReader } from "./espn";
import { cacheIsStale } from "./durableCache";
import type { CenterCatalog, CenterRepository } from "./repository.server";
import { type CenterHistory, type CenterPhase, type CenterScoringContext, type CenterSport, type CenterWindow } from "./types";

/** Read-only orchestration with injectable reads: provider profiles, bulk season comparisons and stored recent windows. */
export class PlayerCenterService {
  // Public raw facts only. Scores are always recalculated for the authorized Group/slate.
  private profileFacts = new Map<string, { history: PresentableHistory; at: number }>();
  private remember(history: PresentableHistory) {
    const key = `${history.player.sport}:${history.season}:${history.player.playerId}`;
    this.profileFacts.delete(key);
    this.profileFacts.set(key, { history: structuredClone(history), at: this.now() });
    if (this.profileFacts.size > 128) this.profileFacts.delete(this.profileFacts.keys().next().value!);
    return history;
  }
  private catalogCache: BoundedReadCache<CenterCatalog>;
  private historyCache: BoundedReadCache<CenterHistory[]>;
  constructor(private readonly repository: CenterRepository, private readonly espn = new CenterEspnReader(), private readonly now: () => number = Date.now) {
    this.catalogCache = new BoundedReadCache(2, now, 2, 120);
    this.historyCache = new BoundedReadCache(4, now, 2, 120);
  }
  private async catalog(sport: CenterSport) {
    const read = await this.catalogCache.read(sport, () => this.repository.catalog(sport), 60_000, new ReadBudget(2, this.now() + 18_000));
    // A stale identity mapping must not authorize a new provider lookup.
    if (!read.value || read.freshness !== "fresh") throw new Error("Player catalog unavailable");
    return read.value;
  }
  private async stored(sport: CenterSport, season: number, catalog: CenterCatalog) {
    const asOf = new Date(this.now()).toISOString();
    const read = await this.historyCache.read(`${sport}:${season}`, () => this.repository.histories(sport, season, catalog, asOf), 300_000, new ReadBudget(2, this.now() + 18_000));
    if (!read.value) throw new Error("Stored player history unavailable");
    const histories = structuredClone(read.value);
    for (const history of histories) {
      // Rebind cached public facts only if the freshly authorized catalog still agrees.
      const current = catalog.players.find(player => player.playerId === history.player.playerId);
      if (!current || current.identity !== "resolved" || current.providerPlayerId !== history.player.providerPlayerId || current.nativePlayerId !== history.player.nativePlayerId) {
        history.games = [];
        history.coverage = { kind: "unavailable", expectedGames: null, fetchedAt: null, freshness: "unavailable", issues: ["identity_changed_or_unresolved"] };
      }
      if (current) history.player = current;
      if (history.coverage.cache && cacheIsStale(history, this.now())) {
        history.coverage.freshness = "stale";
        history.coverage.issues.push("durable_cache_refresh_required");
      }
      if (read.freshness !== "fresh" && history.coverage.freshness === "fresh") {
        history.coverage.freshness = "stale";
        history.coverage.issues.push("cached_database_read_stale");
      }
    }
    return { histories, readAt: read.fetchedAt, asOf };
  }
  async profile(input: { sport: CenterSport; playerId: number; season: number; phase: CenterPhase; scoring: CenterScoringContext; eventIds?: string[] }) {
    if (input.eventIds && (input.sport !== "nfl" || input.eventIds.length > 5 || new Set(input.eventIds).size !== input.eventIds.length || input.eventIds.some(id => !/^[1-9]\d{0,19}$/.test(id)))) throw new Error("Invalid game request");
    const catalog = await this.catalog(input.sport), player = catalog.players.find(row => row.playerId === input.playerId);
    if (!player) return null;
    const snapshot = input.phase === "regular" ? await this.repository.profileSnapshot?.(player, input.season) : null;
    let snapshotProviderRequests = 0;
    if (snapshot?.coverage.freshness === "fresh" && !input.eventIds?.length) {
      const budget = new ReadBudget(1, this.now() + 5000);
      const read = player.identity === "resolved" && player.providerPlayerId && player.position !== "D/ST" ? await this.espn.season?.(input.sport, player.providerPlayerId, input.season, input.phase, budget) : null;
      snapshotProviderRequests = budget.used;
      snapshot.providerRequests = budget.used;
      if (read) snapshot.seasonFacts = seasonReadFacts(read);
      if (!snapshot.seasonFacts || snapshot.seasonFacts.gamesPlayed === snapshot.games.filter(g => g.status === "final" && g.participation === "played").length) return presentProfile(this.remember(snapshot), input.scoring, snapshot.seasonFacts ? new Date(this.now()).toISOString() : snapshot.coverage.cache!.asOf);
    }
    const [history, storedHistory] = await Promise.all([
      this.espn.history(player, input.season, input.phase, undefined, input.eventIds),
      input.phase === "regular" ? this.repository.profileHistory?.(player, input.season).catch(() => null) : null,
    ]);
    history.providerRequests += snapshotProviderRequests;
    // Retain historical facts; current provider facts take precedence for the same
    // event only when they are completed, otherwise keep the validated stored row.
    const older = storedHistory?.games.length ? storedHistory : snapshot ?? storedHistory;
    if (older && older.player.providerPlayerId === player.providerPlayerId) {
      const games = new Map([snapshot, storedHistory].flatMap(source => source && source.player.providerPlayerId === player.providerPlayerId ? source.games : [])
        .filter(game => game.providerPlayerId === player.providerPlayerId && game.season === input.season && game.phase === input.phase)
        .map(game => [game.eventId, game]));
      for (const game of history.games) {
        const previous = games.get(game.eventId);
        games.set(game.eventId, previous?.status === "final" && game.status === "unknown" && !game.issues.length ? previous : game);
      }
      history.games = [...games.values()];
      if (history.coverage.kind === "unavailable" && older.games.length) {
        history.source = "stored";
        history.coverage = { ...older.coverage, recentVerified: false,
          expectedGames: history.seasonFacts?.gamesPlayed ?? older.coverage.expectedGames,
          issues: [...new Set([...older.coverage.issues, ...history.coverage.issues])] };
      }
    }
    if (snapshot && history.coverage.freshness !== "fresh") {
      snapshot.seasonFacts = history.seasonFacts;
      snapshot.providerRequests = history.providerRequests;
      return presentProfile(this.remember(snapshot), input.scoring, new Date(this.now()).toISOString());
    }
    const asOf = new Date(this.now()).toISOString();
    if (input.phase === "regular" && history.coverage.freshness === "fresh") this.remember(history);
    return presentProfile(history, input.scoring, asOf);
  }
  /** Draft catalog: published bulk facts only, independent of opened profiles or stored game coverage. */
  async seasonCatalog(input: { sport: CenterSport; season: number; metric: string; position?: string; ascending: boolean; scoring: CenterScoringContext; eligiblePlayerIds?: number[] }) {
    const allowed = input.sport === "nba" ? comparisonStats.nba : Object.entries(comparisonStats).filter(([key]) => key !== "nba").flatMap(([, stats]) => [...stats]);
    if (!(allowed as readonly string[]).includes(input.metric)) throw new Error("Unsupported comparison metric");
    const catalog = await this.catalog(input.sport);
    const bulk = input.eligiblePlayerIds?.length === 0 ? null : await this.espn.bulkSeason(input.sport, input.season);
    const counts = new Map<string, number>();
    for (const player of catalog.players) if (player.providerPlayerId) counts.set(player.providerPlayerId, (counts.get(player.providerPlayerId) ?? 0) + 1);
    const byProvider = new Map(bulk?.value?.map(fact => [fact.providerPlayerId, fact]) ?? []);
    const eligible = input.eligiblePlayerIds ? new Set(input.eligiblePlayerIds) : null;
    const histories: CenterHistory[] = catalog.players.filter(player => eligible ? eligible.has(player.playerId) : player.active).map(player => {
      const unique = player.identity === "resolved" && player.providerPlayerId !== null && counts.get(player.providerPlayerId) === 1;
      const facts = unique ? byProvider.get(player.providerPlayerId!) : null;
      return { player: unique ? player : { ...player, identity: player.identity === "resolved" ? "conflict" : player.identity, providerPlayerId: null },
        season: input.season, phase: "regular", source: "provider", games: [],
        seasonFacts: facts && bulk ? { ...structuredClone(facts), freshness: bulk.freshness, issues: [...facts.issues, ...(bulk.error ? [bulk.error] : [])] } : null,
        coverage: { kind: "unavailable", expectedGames: null, fetchedAt: bulk?.fetchedAt ?? null, freshness: bulk?.freshness ?? "unavailable", issues: facts ? [] : ["bulk_season_facts_unavailable"] } };
    });
    const missingEligiblePlayers = input.eligiblePlayerIds?.filter(id => !catalog.players.some(player => player.playerId === id)).length ?? 0;
    const offensive = histories.filter(h => !["K", "D/ST"].includes(h.player.position) && (!input.position || h.player.position === input.position));
    const fantasySortAvailable = input.sport === "nba" || missingEligiblePlayers === 0 && offensive.length > 0 && offensive.every(h =>
      h.seasonFacts?.freshness === "fresh" && (h.seasonFacts.gamesPlayed === 0 || h.seasonFacts.gamesPlayed !== null && fantasyPointsFromStats(h.seasonFacts.stats, h.player.position, input.scoring) !== null));
    const result = compareHistories({ ...input, window: "season", eligibleIds: input.eligiblePlayerIds, catalog: true }, histories, new Date(this.now()).toISOString(), bulk?.fetchedAt ?? null);
    if (!fantasySortAvailable && input.metric === "fantasy_points") {
      for (const row of result.players) { row.observedAverage = null; row.rankableAverage = null; }
      result.players.sort((a, b) => a.player.name.localeCompare(b.player.name));
      result.coverage.canSort = false;
      result.coverage.rankablePlayers = 0;
    }
    result.coverage.canSort &&= missingEligiblePlayers === 0;
    return { ...result, source: "bulk_provider" as const, bulkFetchedAt: bulk?.fetchedAt ?? null, bulkFreshness: bulk?.freshness ?? "unavailable", fantasySortAvailable,
      coverage: { ...result.coverage, missingEligiblePlayers, reason: result.coverage.canSort ? null : input.sport === "nfl" && input.metric === "fantasy_points" && !fantasySortAvailable ? "NFL fantasy sorting requires total fumbles lost and all other scoring inputs for the eligible pool." : "Season facts are incomplete or stale for part of the eligible pool." } };
  }
  async comparisons(input: { sport: CenterSport; season: number; window: CenterWindow; metric: string; position?: string; ascending: boolean; scoring: CenterScoringContext; playerIds?: number[]; eligiblePlayerIds?: number[] }) {
    const allowed = input.sport === "nba" ? comparisonStats.nba : Object.entries(comparisonStats).filter(([key]) => key !== "nba").flatMap(([, stats]) => [...stats]);
    if (!(allowed as readonly string[]).includes(input.metric)) throw new Error("Unsupported comparison metric");
    const catalog = await this.catalog(input.sport);
    const [stored, bulk] = await Promise.all([
      this.stored(input.sport, input.season, catalog),
      input.window === "season" && input.eligiblePlayerIds?.length !== 0 ? this.espn.bulkSeason?.(input.sport, input.season) : null,
    ]);
    if (input.playerIds && (input.playerIds.length > 3 || input.playerIds.some(id => !Number.isSafeInteger(id) || id <= 0))) throw new Error("Invalid profile batch");
    // Explicit, bounded research reads; never fan out across the full catalog.
    let providerRequests = 0;
    await Promise.all((input.playerIds ?? []).map(async playerId => {
      try { const profile = await this.profile({ ...input, playerId, phase: "regular" }); providerRequests += profile?.providerRequests ?? 0; } catch { /* Existing stored facts remain available. */ }
    }));
    let profilesUsed = 0;
    const providerIds = new Map<string, number>();
    for (const player of catalog.players) if (player.providerPlayerId) providerIds.set(player.providerPlayerId, (providerIds.get(player.providerPlayerId) ?? 0) + 1);
    const seasonByProvider = new Map(bulk?.value?.map(facts => [facts.providerPlayerId, facts]) ?? []);
    const histories = stored.histories.filter(history => !input.eligiblePlayerIds || input.eligiblePlayerIds.includes(history.player.playerId)).map(original => {
      const history = structuredClone(original), providerId = history.player.providerPlayerId;
      if (providerId && providerIds.get(providerId)! > 1) {
        history.player = { ...history.player, identity: "conflict", providerPlayerId: null };
        history.games = []; history.seasonFacts = null;
        history.coverage.issues.push("conflicting_provider_identity");
        return history;
      }
      const season = providerId && providerIds.get(providerId) === 1 && history.player.identity === "resolved" ? seasonByProvider.get(providerId) : null;
      if (season && bulk) history.seasonFacts = { ...structuredClone(season), freshness: bulk.freshness, issues: [...season.issues, ...(bulk.error ? [bulk.error] : [])] };
      const facts = this.profileFacts.get(`${input.sport}:${input.season}:${history.player.playerId}`);
      if (!facts || this.now() - facts.at > 15 * 60_000 || facts.history.player.providerPlayerId !== history.player.providerPlayerId || facts.history.player.nativePlayerId !== history.player.nativePlayerId || history.player.identity !== "resolved") return history;
      profilesUsed++;
      return { ...structuredClone(facts.history), player: history.player, seasonFacts: facts.history.seasonFacts?.freshness === "fresh" ? facts.history.seasonFacts : history.seasonFacts ?? facts.history.seasonFacts };
    });
    const asOf = histories.some(history => history.seasonFacts) ? new Date(this.now()).toISOString() : stored.asOf;
    return { ...compareHistories(input, histories, asOf, stored.readAt), source: bulk?.value ? "bulk_provider" as const : profilesUsed ? "stored_and_provider" as const : "stored" as const,
      bulkFetchedAt: bulk?.fetchedAt ?? null, bulkFreshness: bulk?.freshness ?? null, providerRequests, profilesUsed };
  }
}
