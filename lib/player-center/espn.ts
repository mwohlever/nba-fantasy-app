import { espnNbaGameLogUrl, normalizeEspnNbaGameLog } from "../analytics/providers/espnNbaGameLog";
import { espnNflGameLogUrl } from "../analytics/providers/espnNflGameLog";
import { espnNflEventSummaryUrl } from "../analytics/providers/espnNflEventFumbles";
import { instant } from "../analytics/nba/types";
import { aggregateEspnDstBoxscore } from "../aggregateEspnBoxscore";
import type { EspnGameSummary } from "../providers/nfl";
import { BoundedReadCache, ReadBudget } from "./cache";
import { finiteStat, professionalSeason, type CenterGame, type CenterHistory, type CenterPhase, type CenterPlayer, type CenterStats } from "./types";

type Obj = Record<string, unknown>;
const object = (value: unknown): Obj => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Obj : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const text = (value: unknown): string | null => typeof value === "string" && value.trim() ? value.trim() : null;
const id = (value: unknown): string | null => /^\d+$/.test(String(value ?? "")) ? String(value) : null;
const phaseNumber = { preseason: 1, regular: 2, postseason: 3 } as const;
function unresolvedStatus(status: Obj) { return /POSTPON|SUSPEND|CANCEL|UNNECESSARY/i.test(`${status.name ?? ""} ${status.description ?? ""}`); }
function eventStatus(status: Obj): CenterGame["status"] {
  if (unresolvedStatus(status)) return "unknown";
  return status.completed === true && status.state === "post" ? "final" : status.state === "in" ? "live" : status.state === "pre" ? "scheduled" : "unknown";
}
function verifyFilters(payload: Obj, sport: string, season?: number, phase?: CenterPhase) {
  const filters = array(payload.filters).map(object);
  if (filters.find(filter => filter.name === "league")?.value !== sport) throw new Error("Provider league mismatch");
  if (season !== undefined && String(filters.find(filter => filter.name === "season")?.value) !== String(season)) throw new Error("Provider season mismatch");
  if (phase !== undefined && String(filters.find(filter => filter.name === "seasontype")?.value) !== String(phaseNumber[phase])) throw new Error("Provider phase mismatch");
}
const nflNames = {
  completions: "completions", passingAttempts: "passing_attempts", passingYards: "passing_yards", passingTouchdowns: "passing_tds",
  interceptions: "passing_ints", rushingAttempts: "rushing_attempts", rushingYards: "rushing_yards", rushingTouchdowns: "rushing_tds",
  receivingTargets: "receiving_targets", receptions: "receptions", receivingYards: "receiving_yards", receivingTouchdowns: "receiving_tds", fumblesLost: "fumbles_lost",
  totalKickingPoints: "kicking_points", longFieldGoalMade: "long_field_goal",
} as const;
const kickingPairs = {
  "fieldGoalsMade-fieldGoalAttempts": ["field_goals_made", "field_goals_attempted"],
  "extraPointsMade-extraPointAttempts": ["extra_points_made", "extra_points_attempted"],
  "fieldGoalsMade1_19-fieldGoalAttempts1_19": ["fg_1_19_made", "fg_1_19_attempted"],
  "fieldGoalsMade20_29-fieldGoalAttempts20_29": ["fg_20_29_made", "fg_20_29_attempted"],
  "fieldGoalsMade30_39-fieldGoalAttempts30_39": ["fg_30_39_made", "fg_30_39_attempted"],
  "fieldGoalsMade40_49-fieldGoalAttempts40_49": ["fg_40_49_made", "fg_40_49_attempted"],
  "fieldGoalsMade50-fieldGoalAttempts50": ["fg_50_plus_made", "fg_50_plus_attempted"],
} as const;

export function normalizeCenterLog(payload: unknown, request: { sport: "nba" | "nfl"; providerPlayerId: string; season: number; phase: CenterPhase; fetchedAt: string }) {
  if (instant(request.fetchedAt) === null) throw new Error("Invalid fetched timestamp");
  const p = object(payload);
  verifyFilters(p, request.sport, request.season);
  if (Object.keys(p).every(key => key === "filters")) return { games: [] as CenterGame[], issues: [] as string[] };
  if (request.sport === "nba") {
    const normalized = normalizeEspnNbaGameLog(payload, { espnPlayerId: request.providerPlayerId, season: request.season, fetchedAt: request.fetchedAt, knownAt: null });
    const games: CenterGame[] = normalized.observations.filter(row => row.phase === request.phase && row.gameAt !== null).map(row => ({
      provider: "espn", providerPlayerId: row.providerPlayerId, eventId: row.eventId, season: row.season, phase: request.phase,
      gameAt: row.gameAt!, week: null, teamId: row.team.providerId, team: row.team.abbreviation, opponentId: row.opponent.providerId, opponent: row.opponent.abbreviation,
      homeAway: row.homeAway, status: unresolvedStatus(object(object(object(object(p.events)[row.eventId]).status).type)) ? "unknown"
        : row.gameStatus === "in_progress" ? "live" : row.gameStatus === "final" ? "final" : row.gameStatus === "scheduled" ? "scheduled" : "unknown",
      participation: row.participation, stats: { ...row.stats, minutes: row.minutes, ...row.shooting }, sources: [row.provenance.source], fetchedAt: request.fetchedAt,
      issues: row.missing.filter(issue => issue === "contradictory-dnp" || issue === "stat-array-length" || issue === "team" || issue === "opponent"),
    }));
    return { games, issues: normalized.issues };
  }
  espnNflGameLogUrl(request.providerPlayerId, request.season); // Validate ID/year with the existing provider helper.
  if (object(p.athlete).id !== undefined && String(object(p.athlete).id) !== request.providerPlayerId) throw new Error("Provider athlete mismatch");
  if (!Array.isArray(p.names) || !p.names.every(name => typeof name === "string") || new Set(p.names).size !== p.names.length || !Array.isArray(p.seasonTypes) || !p.events || Array.isArray(p.events)) throw new Error("Invalid NFL game log");
  const names = p.names as string[], events = object(p.events), rows = new Map<string, CenterGame>(), conflicts = new Set<string>();
  for (const rawType of p.seasonTypes) {
    const type = object(rawType);
    const display = String(type.displayName ?? "");
    const expected = request.phase === "regular" ? "Regular Season" : request.phase === "postseason" ? "Postseason" : "Preseason";
    if (!display.includes(expected) || !display.startsWith(String(request.season))) continue;
    for (const rawCategory of array(type.categories)) {
      const category = object(rawCategory);
      if (category.type !== "event") continue;
      if (request.phase === "regular" && category.splitType !== "2") continue;
      if (category.events === undefined && category.displayName === "Regular Season Stats") continue;
      if (!Array.isArray(category.events)) throw new Error("Invalid NFL event rows");
      for (const rawRow of category.events) {
        const row = object(rawRow), eventId = id(row.eventId), event = object(events[eventId ?? ""]);
        if (!eventId || String(event.id) !== eventId || instant(event.gameDate) === null) throw new Error("Invalid NFL event identity/date");
        const stats: CenterStats = {}, values = array(row.stats), issues: string[] = [];
        if (values.length !== names.length) issues.push("stat_array_length");
        const field = (name: string) => values.length === names.length ? values[names.indexOf(name)] : null;
        for (const [name, key] of Object.entries(nflNames)) {
          const value = finiteStat(field(name));
          stats[key] = value !== null && (key.endsWith("yards") || value >= 0) ? value : null;
        }
        for (const [name, [made, attempted]] of Object.entries(kickingPairs)) {
          const match = String(field(name) ?? "").match(/^(\d+)-(\d+)$/);
          const valid = match !== null && Number(match[1]) <= Number(match[2]);
          stats[made] = valid ? Number(match![1]) : null;
          stats[attempted] = valid ? Number(match![2]) : null;
        }
        const team = object(event.team), opponent = object(event.opponent), teamId = id(team.id), opponentId = id(opponent.id);
        if (!teamId || !opponentId || teamId === opponentId) issues.push("team_identity");
        const status = object(object(event.status).type);
        const dnp = row.didNotPlay === true || values.some(value => /^DNP(?:\b|$)/i.test(String(value)));
        const game: CenterGame = { provider: "espn", providerPlayerId: request.providerPlayerId, eventId,
          season: request.season, phase: request.phase, gameAt: new Date(String(event.gameDate)).toISOString(), week: finiteStat(event.week),
          teamId, team: text(team.abbreviation), opponentId, opponent: text(opponent.abbreviation),
          homeAway: teamId && teamId === id(event.homeTeamId) ? "home" : teamId && teamId === id(event.awayTeamId) ? "away" : null,
          // Game-result letters alone are not the NFL completed-game gate.
          status: eventStatus(status),
          participation: dnp ? "dnp" : Object.values(stats).some(value => value !== null) ? "played" : "unknown",
          stats, sources: [espnNflGameLogUrl(request.providerPlayerId, request.season)], fetchedAt: request.fetchedAt, issues };
        if (rows.has(eventId) && JSON.stringify(rows.get(eventId)) !== JSON.stringify(game)) conflicts.add(eventId);
        rows.set(eventId, game);
      }
    }
  }
  for (const key of conflicts) rows.delete(key);
  return { games: [...rows.values()].sort((a, b) => b.gameAt.localeCompare(a.gameAt)), issues: [...conflicts].map(key => `conflicting_event:${key}`) };
}

export type CenterSeasonStats = {
  season: number; phase: CenterPhase; expectedGames: number | null; issues: string[];
  categories: Array<{ name: string; teamId: string | null; fields: Array<{ label: string; value: string | null }> }>;
};
export function normalizeCenterSeasonStats(payload: unknown, sport: "nba" | "nfl", season: number, phase: CenterPhase, expectedPlayerId?: string): CenterSeasonStats {
  const p = object(payload);
  if (expectedPlayerId && object(p.athlete).id !== undefined && String(object(p.athlete).id) !== expectedPlayerId) throw new Error("Provider athlete mismatch");
  verifyFilters(p, sport, undefined, phase);
  if (!Array.isArray(p.categories)) throw new Error("Invalid season statistics");
  const categories: CenterSeasonStats["categories"] = [], games: number[] = [], issues: string[] = [];
  for (const rawCategory of p.categories) {
    const category = object(rawCategory), labels = array(category.labels);
    if (!labels.every(label => typeof label === "string")) throw new Error("Invalid season stat labels");
    const rows = array(category.statistics).map(object).filter(row => Number(object(row.season).year) === season);
    // Do not guess which multi-team row is a combined total or sum duplicated aggregates.
    if (rows.length > 1) issues.push(`multi_team_or_duplicate_category:${String(category.name)}`);
    for (const row of rows) {
      const values = array(row.stats);
      if (values.length !== labels.length) { issues.push("season_stat_array_length"); continue; }
      categories.push({ name: String(category.name), teamId: id(row.teamId), fields: labels.map((label, i) => {
        const value = text(values[i]);
        return { label: String(label), value: value && !/^(?:--?|N\/A)$/i.test(value) ? value : null };
      }) });
      const gp = finiteStat(values[labels.indexOf("GP")]);
      if (rows.length === 1 && gp !== null && Number.isInteger(gp) && gp >= 0) games.push(gp);
    }
  }
  if (sport === "nba" && new Set(games).size > 1) issues.push("conflicting_season_gp");
  return { season, phase, categories, expectedGames: issues.length || !games.length ? null : Math.max(...games), issues };
}

const summaryFields = {
  passing: { passing_yards: "YDS", passing_tds: "TD", passing_ints: "INT" },
  rushing: { rushing_yards: "YDS", rushing_tds: "TD", rushing_attempts: "CAR" },
  receiving: { receiving_yards: "YDS", receiving_tds: "TD", receptions: "REC", receiving_targets: "TGTS" },
  fumbles: { fumbles_lost: "LOST" },
} as const;
type SummaryGroup = { values: Record<string, CenterStats>; absentIsZero: boolean; absenceEvidence?: "reconciled_category" | "team_zero_fumbles_lost" };
export type CenterNflSummary = {
  eventId: string; season: number; phase: number; status: CenterGame["status"];
  teams: Record<string, Record<string, SummaryGroup>>;
  defenses: Record<string, CenterStats>;
};
export function normalizeCenterNflSummary(payload: unknown, eventId: string): CenterNflSummary {
  const p = object(payload), header = object(p.header), competition = object(array(header.competitions)[0]);
  if (String(header.id) !== eventId || String(competition.id) !== eventId) throw new Error("Summary identity mismatch");
  const season = Number(object(header.season).year), phase = Number(object(header.season).type);
  if (!Number.isInteger(season) || ![1, 2, 3].includes(phase)) throw new Error("Summary missing season/phase");
  const state = object(object(competition.status).type);
  const teams: CenterNflSummary["teams"] = {};
  const competitors = array(competition.competitors).map(row => id(object(object(row).team).id));
  if (competitors.length !== 2 || competitors.some(team => !team) || new Set(competitors).size !== 2) throw new Error("Summary team identity missing");
  for (const rawTeam of array(object(p.boxscore).players)) {
    const team = object(rawTeam), teamId = id(object(team.team).id);
    if (!teamId || !competitors.includes(teamId) || teams[teamId] || !Array.isArray(team.statistics)) throw new Error("Invalid summary team");
    const groups: Record<string, SummaryGroup> = {};
    teams[teamId] = groups;
    for (const rawGroup of team.statistics) {
      const group = object(rawGroup), name = String(group.name);
      if (!Object.hasOwn(summaryFields, name)) continue;
      if (groups[name] || !Array.isArray(group.labels) || !Array.isArray(group.athletes) || new Set(group.labels).size !== group.labels.length) throw new Error("Invalid summary category");
      const labels = group.labels as string[], fields = summaryFields[name as keyof typeof summaryFields];
      const read = (values: unknown[]): CenterStats => Object.fromEntries(Object.entries(fields).map(([field, label]) => {
        const n = finiteStat(values[labels.indexOf(label)]);
        return [field, n !== null && (field.endsWith("yards") || n >= 0) ? n : null];
      }));
      const values: SummaryGroup["values"] = {};
      let complete = true;
      for (const rawAthlete of group.athletes) {
        const row = object(rawAthlete), athleteId = id(object(row.athlete).id), stats = array(row.stats);
        if (!athleteId || values[athleteId] || stats.length !== labels.length) throw new Error("Invalid summary athlete");
        values[athleteId] = read(stats);
        if (Object.values(values[athleteId]).some(value => value === null)) complete = false;
      }
      const totals = array(group.totals);
      complete = complete && totals.length === labels.length && Object.values(read(totals)).every(value => value !== null);
      // Numeric totals alone do not prove the athlete list is complete. Reconcile
      // additive fields before treating an absent athlete as a factual zero.
      const totalStats = read(totals);
      for (const field of Object.keys(fields)) {
        const sum = Object.values(values).reduce((n, stats) => n + (stats[field] ?? 0), 0);
        if (name === "passing" && field === "passing_yards") {
          const sacks = String(totals[labels.indexOf("SACKS")] ?? "").match(/^(\d+)-(\d+)$/);
          if (sum !== totalStats[field] && (!sacks || sum - Number(sacks[2]) !== totalStats[field])) complete = false;
        } else if (sum !== totalStats[field]) complete = false;
      }
      groups[name] = { values, absentIsZero: complete, ...(complete ? { absenceEvidence: "reconciled_category" as const } : {}) };
    }
    // An empty athlete fumble category is NOT zero evidence. A final, exact-team
    // aggregate explicitly reporting LOST=0 is: every individual loss must be zero.
    // Do not extend this rule to nonzero totals or to other offensive fields.
    const teamRows = array(object(p.boxscore).teams).map(object).filter(row => id(object(row.team).id) === teamId);
    const lostCells = teamRows.length === 1 ? array(teamRows[0].statistics).map(object).filter(stat => stat.name === "fumblesLost") : [];
    const teamZero = eventStatus(state) === "final" && lostCells.length > 0 && lostCells.every(stat =>
      finiteStat(stat.displayValue) === 0 && (!Object.hasOwn(stat, "value") || finiteStat(stat.value) === 0));
    const rawFumbles = team.statistics.map(object).find(group => group.name === "fumbles");
    const lostIndex = rawFumbles ? array(rawFumbles.labels).indexOf("LOST") : -1;
    const categoryCells = rawFumbles ? [
      ...(array(rawFumbles.totals).length ? [array(rawFumbles.totals)[lostIndex]] : []),
      ...array(rawFumbles.athletes).map(row => array(object(row).stats)[lostIndex]),
    ] : [];
    if (teamZero && (!rawFumbles || lostIndex >= 0) && categoryCells.every(value => finiteStat(value) === 0)) {
      groups.fumbles = { values: groups.fumbles?.values ?? {}, absentIsZero: true, absenceEvidence: "team_zero_fumbles_lost" };
    }
  }
  if (Object.keys(teams).length !== 2) throw new Error("Incomplete summary boxscore");
  const defenses: Record<string, CenterStats> = {};
  const rawTeams = array(object(p.boxscore).teams).map(object);
  for (const teamId of competitors as string[]) {
    const opponentId = competitors.find(other => other !== teamId)!;
    const team = rawTeams.filter(row => id(object(row.team).id) === teamId);
    const opponent = rawTeams.filter(row => id(object(row.team).id) === opponentId);
    const read = (rows: Obj[], name: string, label?: string) => {
      if (rows.length !== 1) return null;
      const stats = array(rows[0].statistics).map(object).filter(stat => stat.name === name && (!label || stat.label === label));
      // ESPN can repeat identical team statistic cells. Conflicting values remain unknown.
      return stats.length > 0 && new Set(stats.map(stat => stat.displayValue)).size === 1 ? text(stats[0].displayValue) : null;
    };
    const numeric = (rows: Obj[], name: string, label?: string) => {
      const n = finiteStat(read(rows, name, label));
      return n !== null && n >= 0 ? n : null;
    };
    const sacks = read(opponent, "sacksYardsLost")?.match(/^(\d+)-(\d+)$/);
    const competitor = array(competition.competitors).map(object).find(c => id(object(c.team).id) === opponentId);
    const pointsAllowed = finiteStat(competitor?.score);
    defenses[teamId] = { sacks: sacks ? Number(sacks[1]) : null, interceptions: numeric(opponent, "interceptions", "Interceptions thrown"),
      fumbleRecoveries: numeric(opponent, "fumblesLost"), pointsAllowed: pointsAllowed !== null && pointsAllowed >= 0 ? pointsAllowed : null,
      yardsAllowed: numeric(opponent, "totalYards"), touchdowns: numeric(team, "defensiveTouchdowns"), safeties: null };
    if (Array.isArray(p.scoringPlays) && p.scoringPlays.every(play => id(object(object(play).type).id) && competitors.includes(id(object(object(play).team).id)))) {
      defenses[teamId].safeties = p.scoringPlays.filter(play => object(object(play).type).id === "20" && id(object(object(play).team).id) === teamId).length;
    }
    if (Object.values(defenses[teamId]).every(value => value !== null)) {
      // Reuse the production D/ST interpretation only after rejecting every missing-to-zero input.
      const existing = aggregateEspnDstBoxscore(payload as EspnGameSummary, teamId);
      if (existing) defenses[teamId] = { ...existing };
    }
  }
  return { eventId, season, phase, status: eventStatus(state), teams, defenses };
}

export function enrichNflGame(game: CenterGame, summary: CenterNflSummary, source: string): CenterGame {
  if (summary.eventId !== game.eventId || summary.season !== game.season || summary.phase !== phaseNumber[game.phase] || !game.teamId || !game.opponentId || !summary.teams[game.teamId] || !summary.teams[game.opponentId]) throw new Error("Summary/game context mismatch");
  const stats = { ...game.stats }, team = summary.teams[game.teamId], issues = [...game.issues];
  for (const [name, fields] of Object.entries(summaryFields)) {
    const group = team[name], row = group?.values[game.providerPlayerId];
    for (const field of Object.keys(fields)) {
      const fromSummary = row ? row[field] : group?.absentIsZero ? 0 : null;
      const fromLog = game.stats[field];
      if (fromSummary != null && fromLog != null && fromSummary !== fromLog) {
        stats[field] = null;
        issues.push(`conflicting_log_summary_stat:${field}`);
      } else {
        // Preserve explicit athlete-log facts when the summary omits a category/row.
        // Missing in both remains null; never substitute a default zero.
        stats[field] = fromSummary ?? fromLog ?? null;
      }
    }
  }
  return { ...game, stats, status: summary.status, sources: [...new Set([...game.sources, source])], issues: [...new Set(issues)] };
}

export function defenseTeamId(player: CenterPlayer) {
  if (player.sport !== "nfl" || player.position !== "D/ST" || !/^\d+$/.test(player.providerPlayerId ?? "")) return null;
  const teamId = Number(player.providerPlayerId) - 100_000_000;
  return Number.isInteger(teamId) && teamId > 0 && teamId < 100 ? String(teamId) : null;
}

export function normalizeCenterNflSchedule(payload: unknown, teamId: string, season: number, phase: CenterPhase, fetchedAt: string, source: string) {
  const p = object(payload), requested = object(p.requestedSeason);
  if (id(object(p.team).id) !== teamId || Number(requested.year) !== season || Number(requested.type) !== phaseNumber[phase] || !Array.isArray(p.events) || p.events.length > 25) throw new Error("Team schedule identity/season mismatch");
  const ids = new Set<string>();
  const games: CenterGame[] = p.events.map(raw => {
    const event = object(raw), eventId = id(event.id), competition = object(array(event.competitions)[0]);
    const competitors = array(competition.competitors).map(object), own = competitors.find(c => id(object(c.team).id) === teamId), opponent = competitors.find(c => id(object(c.team).id) !== teamId);
    if (!eventId || ids.has(eventId) || String(competition.id) !== eventId || Number(object(event.season).year) !== season || !Number.isFinite(Date.parse(String(event.date))) || competitors.length !== 2 || !own || !opponent || !id(object(opponent.team).id)) throw new Error("Invalid schedule game");
    ids.add(eventId);
    const status = object(object(competition.status).type);
    return { provider: "espn", providerPlayerId: String(100_000_000 + Number(teamId)), eventId, season, phase,
      gameAt: new Date(String(event.date)).toISOString(), week: finiteStat(object(event.week).number), teamId, team: text(object(own.team).abbreviation),
      opponentId: id(object(opponent.team).id), opponent: text(object(opponent.team).abbreviation), homeAway: own.homeAway === "home" || own.homeAway === "away" ? own.homeAway : null,
      status: eventStatus(status),
      participation: eventStatus(status) === "final" ? "played" : "unknown", stats: {}, sources: [source], fetchedAt, issues: [] };
  });
  const bye = finiteStat(p.byeWeek);
  return { games, issues: [] as string[], expectedGames: games.filter(game => game.status === "final").length,
    byeWeeks: bye !== null && Number.isInteger(bye) && bye >= 1 && bye <= 18 ? [bye] : null };
}

type ProviderValue = ReturnType<typeof normalizeCenterLog> | ReturnType<typeof normalizeCenterNflSchedule> | CenterSeasonStats | CenterNflSummary;
export class CenterEspnReader {
  private cache: BoundedReadCache<ProviderValue>;
  constructor(private readonly fetcher: typeof fetch = fetch, private readonly now: () => number = Date.now) {
    this.cache = new BoundedReadCache<ProviderValue>(128, now);
  }
  private async json(url: string) {
    const response = await this.fetcher(url, { cache: "no-store", headers: { Accept: "application/json" }, signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error("ESPN response unavailable");
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Empty provider response");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 3_000_000) { await reader.cancel(); throw new Error("Provider response size limit"); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const joined = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.length; }
    return JSON.parse(new TextDecoder().decode(joined)) as unknown;
  }
  async history(player: CenterPlayer, season: number, phase: CenterPhase, budget?: ReadBudget) {
    budget ??= new ReadBudget(8, this.now() + 18_000);
    const result: CenterHistory & { seasonStats: CenterSeasonStats | null; byeWeeks: number[] | null; providerRequests: number } = {
      player, season, phase, source: "provider", games: [], seasonStats: null, byeWeeks: null, providerRequests: 0,
      coverage: { kind: "unavailable", expectedGames: null, fetchedAt: null, freshness: "unavailable", issues: [] },
    };
    if (player.identity !== "resolved" || !player.providerPlayerId) { result.coverage.issues.push("unresolved_player_identity"); return result; }
    const dstTeam = defenseTeamId(player);
    if (player.position === "D/ST" && !dstTeam) { result.coverage.issues.push("invalid_defense_identity"); return result; }
    const ttl = season < professionalSeason(player.sport, new Date(this.now())) ? 86_400_000 : 900_000;
    const logUrl = dstTeam ? `https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${dstTeam}/schedule?season=${season}&seasontype=${phaseNumber[phase]}`
      : player.sport === "nba" ? espnNbaGameLogUrl(player.providerPlayerId, season) : espnNflGameLogUrl(player.providerPlayerId, season);
    const request = { sport: player.sport, providerPlayerId: player.providerPlayerId, season, phase, fetchedAt: new Date(this.now()).toISOString() };
    const log = await this.cache.read(`log:${player.sport}:${player.providerPlayerId}:${season}:${phase}`, async () => dstTeam
      ? normalizeCenterNflSchedule(await this.json(logUrl), dstTeam, season, phase, new Date(this.now()).toISOString(), logUrl)
      : normalizeCenterLog(await this.json(logUrl), { ...request, fetchedAt: new Date(this.now()).toISOString() }), ttl, budget);
    if (log.error) result.coverage.issues.push(log.error);
    result.coverage.fetchedAt = log.fetchedAt;
    result.coverage.freshness = log.freshness;
    if (!log.value || !("games" in log.value)) { result.providerRequests = budget.used; return result; }
    if (log.value.games.length > (player.sport === "nba" ? 110 : 25)) { result.coverage.issues.push("provider_game_count_limit"); result.providerRequests = budget.used; return result; }
    result.games = structuredClone(log.value.games);
    result.coverage.kind = dstTeam ? "team_schedule" : "appearance_log";
    result.coverage.issues.push(...log.value.issues);
    if ("byeWeeks" in log.value) { result.byeWeeks = log.value.byeWeeks ? [...log.value.byeWeeks] : null; result.coverage.expectedGames = log.value.expectedGames; }
    const statsUrl = `https://site.web.api.espn.com/apis/common/v3/sports/${player.sport === "nba" ? "basketball" : "football"}/${player.sport}/athletes/${player.providerPlayerId}/stats?season=${season}&seasontype=${phaseNumber[phase]}`;
    const seasonRead = dstTeam ? null : await this.cache.read(`season:${player.sport}:${player.providerPlayerId}:${season}:${phase}`, async () => normalizeCenterSeasonStats(await this.json(statsUrl), player.sport, season, phase), ttl, budget);
    if (seasonRead?.value && "categories" in seasonRead.value) {
      result.seasonStats = structuredClone(seasonRead.value);
      if (seasonRead.freshness === "fresh" && log.freshness === "fresh") result.coverage.expectedGames = seasonRead.value.expectedGames;
      result.coverage.issues.push(...seasonRead.value.issues);
    }
    if (seasonRead?.error) result.coverage.issues.push(seasonRead.error);
    if (player.sport === "nfl") {
      // Most recent first. At most six cold summaries after log + season stats.
      const candidates = [...result.games].filter(game => game.participation !== "dnp" && Date.parse(game.gameAt) <= this.now()).sort((a, b) => b.gameAt.localeCompare(a.gameAt));
      for (const [index, game] of candidates.entries()) {
        const source = espnNflEventSummaryUrl(game.eventId);
        const summary = await this.cache.read(`summary:${game.eventId}`, async () => normalizeCenterNflSummary(await this.json(source), game.eventId), ttl, budget);
        if (summary.value && "teams" in summary.value) {
          try {
            const enriched = enrichNflGame(game, summary.value, source);
            if (dstTeam) enriched.stats = { ...summary.value.defenses[dstTeam] };
            Object.assign(game, enriched);
          } catch { result.coverage.issues.push(`summary_context_mismatch:${game.eventId}`); }
        }
        if (summary.freshness !== "fresh") {
          result.coverage.issues.push(`${summary.error ?? "stale_summary"}:${game.eventId}`);
          if (summary.value) result.coverage.freshness = "stale";
        }
        // No loop over the remainder once both request/deadline budgets are spent.
        if ((budget.used >= budget.max || this.now() >= budget.deadline) && index + 1 < candidates.length) { result.coverage.issues.push("summary_coverage_budget_limited"); break; }
      }
    }
    result.coverage.issues = [...new Set(result.coverage.issues)];
    result.providerRequests = budget.used;
    return result;
  }
}
