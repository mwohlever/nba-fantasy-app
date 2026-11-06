import { BoundedReadCache, ReadBudget, type CachedRead } from "./cache";
import { professionalSeason, type CenterPhase, type CenterSport, type CenterStats, type SeasonFacts } from "./types";

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Obj : {};
const list = (v: unknown): unknown[] => Array.isArray(v) ? v : [];
const phases = { preseason: 1, regular: 2, postseason: 3 } as const;
const path = (sport: CenterSport) => sport === "nba" ? "basketball/nba" : "football/nfl";
// Category-qualified names matter: defensive interceptions and rushing-only fumble
// losses are not the offensive scoring inputs. Never use display strings/rounded means.
export const seasonFields = {
  nba: { points: ["offensive", "points"], rebounds: ["general", "rebounds"], assists: ["offensive", "assists"],
    steals: ["defensive", "steals"], blocks: ["defensive", "blocks"], turnovers: ["offensive", "turnovers"], minutes: ["general", "minutes"] },
  nfl: { passing_yards: ["passing", "passingYards"], passing_tds: ["passing", "passingTouchdowns"], passing_ints: ["passing", "interceptions"],
    rushing_yards: ["rushing", "rushingYards"], rushing_tds: ["rushing", "rushingTouchdowns"], receiving_yards: ["receiving", "receivingYards"],
    receiving_tds: ["receiving", "receivingTouchdowns"], receptions: ["receiving", "receptions"], fumbles_lost: ["general", "fumblesLost"],
    receiving_targets: ["receiving", "receivingTargets"], rushing_attempts: ["rushing", "rushingAttempts"],
    field_goals_made: ["kicking", "fieldGoalsMade"], field_goals_attempted: ["kicking", "fieldGoalAttempts"],
    extra_points_made: ["kicking", "extraPointsMade"], extra_points_attempted: ["kicking", "extraPointAttempts"] },
} as const;
const numeric = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;
function requestValid(sport: CenterSport, season: number, phase: CenterPhase, id?: string) {
  if (!["nba", "nfl"].includes(sport) || !Number.isInteger(season) || season < 2000 || season > 2100 || !Object.hasOwn(phases, phase) || id !== undefined && !/^[1-9]\d*$/.test(id)) throw new Error("Invalid season facts request");
}
function facts(sport: CenterSport, season: number, phase: CenterPhase, providerPlayerId: string, source: string, fetchedAt: string, read: (category: string, field: string) => number | null): SeasonFacts {
  if (!Number.isFinite(Date.parse(fetchedAt))) throw new Error("Invalid season facts timestamp");
  const rawGp = read("general", "gamesPlayed");
  const gamesPlayed = rawGp !== null && Number.isInteger(rawGp) && rawGp >= 0 && rawGp <= (sport === "nba" ? 110 : 25) ? rawGp : null;
  const stats: CenterStats = Object.fromEntries(Object.entries(seasonFields[sport]).map(([field, [cat, name]]) => {
    const n = read(cat, name);
    return [field, n !== null && (field.endsWith("yards") || n >= 0) ? n : null];
  }));
  return { sport, providerPlayerId, season, phase, gamesPlayed, stats, source, fetchedAt, freshness: "fresh", issues: gamesPlayed === null ? ["season_gp_unavailable"] : [] };
}
export function normalizeCoreSeasonFacts(payload: unknown, sport: CenterSport, providerPlayerId: string, season: number, phase: CenterPhase, fetchedAt: string): SeasonFacts {
  requestValid(sport, season, phase, providerPlayerId);
  const p = obj(payload), prefix = `/v2/sports/${sport === "nba" ? "basketball" : "football"}/leagues/${sport}/seasons/${season}`;
  const refPath = (v: unknown) => { try { const u = new URL(String(obj(v).$ref)); return ["sports.core.api.espn.com"].includes(u.hostname) ? u.pathname.replace(/\/$/, "") : ""; } catch { return ""; } };
  if (refPath(p.season) !== prefix || refPath(p.athlete) !== `${prefix}/athletes/${providerPlayerId}` ||
    refPath(p.seasonType) !== `${prefix}/types/${phases[phase]}` || obj(p.splits).type !== "total" || String(obj(p.splits).id) !== "0" || !Array.isArray(obj(p.splits).categories)) throw new Error("Season facts identity/phase mismatch");
  const values = new Map<string, number | null>();
  for (const raw of list(obj(p.splits).categories)) {
    const c = obj(raw);
    if (typeof c.name !== "string" || !Array.isArray(c.stats)) throw new Error("Invalid season category");
    for (const rawStat of c.stats) {
      const s = obj(rawStat), key = `${c.name}:${s.name}`;
      if (typeof s.name !== "string" || values.has(key)) throw new Error("Duplicate season statistic");
      values.set(key, numeric(s.value));
    }
  }
  return facts(sport, season, phase, providerPlayerId, coreSeasonUrl(sport, providerPlayerId, season, phase), fetchedAt, (cat, field) => values.get(`${cat}:${field}`) ?? null);
}
export function coreSeasonUrl(sport: CenterSport, id: string, season: number, phase: CenterPhase) {
  requestValid(sport, season, phase, id);
  return `https://sports.core.api.espn.com/v2/sports/${sport === "nba" ? "basketball" : "football"}/leagues/${sport}/seasons/${season}/types/${phases[phase]}/athletes/${id}/statistics`;
}
export const BULK_PAGE_SIZE = 100;
export function bulkSeasonUrl(sport: CenterSport, season: number, phase: CenterPhase, page: number) {
  requestValid(sport, season, phase);
  return `https://site.web.api.espn.com/apis/common/v3/sports/${path(sport)}/statistics/byathlete?season=${season}&seasontype=${phases[phase]}&isqualified=false&sort=${sport === "nba" ? "general.gamesPlayed" : "passing.passingYards"}:desc&limit=${BULK_PAGE_SIZE}&page=${page}`;
}
export function normalizeBulkSeasonPage(payload: unknown, sport: CenterSport, season: number, phase: CenterPhase, page: number, fetchedAt: string) {
  const p = obj(payload), pagination = obj(p.pagination), requested = obj(p.requestedSeason);
  const count = numeric(pagination.count), pages = numeric(pagination.pages);
  if (obj(p.league).slug !== sport || Number(requested.year) !== season || Number(obj(requested.type).type) !== phases[phase] ||
    pagination.page !== page || pagination.limit !== BULK_PAGE_SIZE || count === null || !Number.isInteger(count) || count < 0 || count > 4000 ||
    pages === null || !Number.isInteger(pages) || pages < 1 || pages > 40 || pages !== Math.max(1, Math.ceil(count / BULK_PAGE_SIZE)) ||
    !Array.isArray(p.athletes) || p.athletes.length !== Math.min(BULK_PAGE_SIZE, Math.max(0, count - (page - 1) * BULK_PAGE_SIZE)) || !Array.isArray(p.categories)) throw new Error("Invalid bulk season coverage");
  const schema = new Map<string, string[]>();
  for (const raw of p.categories) {
    const c = obj(raw);
    if (typeof c.name !== "string" || schema.has(c.name) || !Array.isArray(c.names) || !c.names.every(n => typeof n === "string") || new Set(c.names).size !== c.names.length) throw new Error("Invalid bulk stat schema");
    schema.set(c.name, c.names as string[]);
  }
  const rows: SeasonFacts[] = [], ids = new Set<string>();
  for (const raw of p.athletes) {
    const a = obj(raw), id = String(obj(a.athlete).id);
    if (!/^[1-9]\d*$/.test(id) || ids.has(id) || !Array.isArray(a.categories)) throw new Error("Duplicate/invalid bulk athlete");
    ids.add(id);
    const categories = new Map<string, unknown[]>();
    for (const rawCategory of a.categories) {
      const c = obj(rawCategory), names = schema.get(String(c.name));
      if (!names || categories.has(String(c.name)) || !Array.isArray(c.values) || c.values.length !== names.length || c.splitId !== undefined && String(c.splitId) !== "0") throw new Error("Invalid bulk athlete statistics");
      categories.set(String(c.name), c.values);
    }
    rows.push(facts(sport, season, phase, id, bulkSeasonUrl(sport, season, phase, page), fetchedAt,
      (cat, name) => numeric(categories.get(cat)?.[schema.get(cat)?.indexOf(name) ?? -1])));
  }
  return { rows, count, pages, schema: JSON.stringify([...schema]) };
}

/** Read-only public facts. Bulk batches publish atomically and never contain Group scores. */
export class SeasonFactsReader {
  private individual: BoundedReadCache<SeasonFacts>;
  private batches: BoundedReadCache<SeasonFacts[]>;
  constructor(private readonly fetcher: typeof fetch = fetch, private readonly now: () => number = Date.now) {
    this.individual = new BoundedReadCache(128, now);
    this.batches = new BoundedReadCache(8, now, 2, 4);
  }
  private ttl(sport: CenterSport, season: number) { return season < professionalSeason(sport, new Date(this.now())) ? 86_400_000 : 900_000; }
  private async json(url: string, deadline: number) {
    const remaining = Math.min(5000, deadline - this.now());
    if (remaining <= 0) throw new Error("Season facts deadline");
    const response = await this.fetcher(url, { cache: "no-store", headers: { Accept: "application/json" }, signal: AbortSignal.timeout(remaining) });
    if (!response.ok || !response.body) throw new Error("Season facts unavailable");
    const reader = response.body.getReader(), chunks: Uint8Array[] = [];
    let size = 0;
    try { for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.length;
      if (size > 3_000_000) { await reader.cancel(); throw new Error("Season facts response limit"); } chunks.push(value); }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  }
  profile(sport: CenterSport, id: string, season: number, phase: CenterPhase, budget = new ReadBudget()) {
    requestValid(sport, season, phase, id);
    return this.individual.read(`${sport}:${id}:${season}:${phase}`, async () => normalizeCoreSeasonFacts(await this.json(coreSeasonUrl(sport, id, season, phase), budget.deadline), sport, id, season, phase, new Date(this.now()).toISOString()), this.ttl(sport, season), budget);
  }
  bulk(sport: CenterSport, season: number, phase: CenterPhase = "regular"): Promise<CachedRead<SeasonFacts[]>> {
    requestValid(sport, season, phase);
    const deadline = this.now() + 15_000;
    return this.batches.read(`${sport}:${season}:${phase}`, async () => {
      const rows: SeasonFacts[] = [], ids = new Set<string>();
      const fetchedAt = new Date(this.now()).toISOString();
      const pageRead = async (page: number) => normalizeBulkSeasonPage(await this.json(bulkSeasonUrl(sport, season, phase, page), deadline), sport, season, phase, page, fetchedAt);
      const first = await pageRead(1);
      const append = (next: typeof first) => {
        if (first.count !== next.count || first.pages !== next.pages || first.schema !== next.schema) throw new Error("Bulk coverage changed during pagination");
        for (const row of next.rows) { if (ids.has(row.providerPlayerId)) throw new Error("Bulk identity repeated across pages"); ids.add(row.providerPlayerId); rows.push(row); }
      };
      append(first);
      // First prove pagination, then fetch at most three bounded pages together.
      for (let page = 2; page <= first.pages; page += 3) {
        const pages = Array.from({ length: Math.min(3, first.pages - page + 1) }, (_, i) => page + i);
        const results = await Promise.all(pages.map(pageRead));
        results.forEach(append);
      }
      if (rows.length !== first.count) throw new Error("Incomplete bulk batch");
      return rows;
    }, this.ttl(sport, season), new ReadBudget(1, deadline));
  }
}
export function seasonReadFacts(read: CachedRead<SeasonFacts>): SeasonFacts | null {
  return read.value ? { ...structuredClone(read.value), freshness: read.freshness, issues: [...read.value.issues, ...(read.error ? [read.error] : [])] } : null;
}
