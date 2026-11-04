import { BoundedReadCache, ReadBudget } from "./cache";
import { comparisonStats, compareHistories } from "./comparison";
import { presentProfile } from "./presentation";
import { CenterEspnReader } from "./espn";
import { cacheIsStale } from "./durableCache";
import type { CenterCatalog, CenterRepository } from "./repository.server";
import { type CenterHistory, type CenterPhase, type CenterScoringContext, type CenterSport, type CenterWindow } from "./types";

/** Read-only orchestration with injectable reads: provider profiles and stored-only draft comparisons. */
export class PlayerCenterService {
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
  async profile(input: { sport: CenterSport; playerId: number; season: number; phase: CenterPhase; scoring: CenterScoringContext }) {
    const catalog = await this.catalog(input.sport), player = catalog.players.find(row => row.playerId === input.playerId);
    if (!player) return null;
    const snapshot = input.phase === "regular" ? await this.repository.profileSnapshot?.(player, input.season) : null;
    if (snapshot?.coverage.freshness === "fresh") return presentProfile(snapshot, input.scoring, snapshot.coverage.cache!.asOf);
    const history = await this.espn.history(player, input.season, input.phase);
    if (snapshot && history.coverage.freshness !== "fresh") return presentProfile(snapshot, input.scoring, snapshot.coverage.cache!.asOf);
    const asOf = new Date(this.now()).toISOString();
    return presentProfile(history, input.scoring, asOf);
  }
  async comparisons(input: { sport: CenterSport; season: number; window: CenterWindow; metric: string; position?: string; ascending: boolean; scoring: CenterScoringContext }) {
    const allowed = input.sport === "nba" ? comparisonStats.nba : Object.entries(comparisonStats).filter(([key]) => key !== "nba").flatMap(([, stats]) => [...stats]);
    if (!(allowed as readonly string[]).includes(input.metric)) throw new Error("Unsupported comparison metric");
    const catalog = await this.catalog(input.sport), stored = await this.stored(input.sport, input.season, catalog);
    return compareHistories(input, stored.histories, stored.asOf, stored.readAt);
  }
}
