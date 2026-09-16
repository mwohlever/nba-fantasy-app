import { resolveEspnNbaIdentity, type NbaCrosswalkEntry } from "../nba/identity";
import { NBA_STATS, instant, observationKey, type NbaObservation, type SeasonPhase } from "../nba/types";

type Obj = Record<string, unknown>;
const obj = (value: unknown): Obj => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Obj : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const text = (value: unknown): string | null => typeof value === "string" && value.trim() ? value.trim() : null;
const id = (value: unknown): string | null => typeof value === "string" && /^\d+$/.test(value) ? value : null;
function number(value: unknown): number | null {
  if (typeof value !== "number" && !(typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value.trim()))) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
export function parseNbaMinutes(value: unknown): number | null {
  if (typeof value === "string") {
    const colon = value.trim().match(/^(\d+):([0-5]\d)$/);
    if (colon) return Number(colon[1]) + Number(colon[2]) / 60;
    const iso = value.trim().match(/^PT(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/);
    if (iso && (iso[1] || iso[2]) && Number(iso[2] ?? 0) < 60) return Number(iso[1] ?? 0) + Number(iso[2] ?? 0) / 60;
  }
  return number(value);
}
function timestamp(value: unknown): string | null {
  const n = instant(value);
  return n === null ? null : new Date(n).toISOString();
}
function phase(value: unknown): SeasonPhase {
  const name = String(value ?? "").toLowerCase();
  if (name.includes("postseason")) return "postseason";
  if (name.includes("regular season")) return "regular";
  if (name.includes("preseason")) return "preseason";
  return "unknown";
}
export type EspnNbaLogRequest = {
  espnPlayerId: string;
  season: number;
  fetchedAt: string;
  /** Set to fetchedAt for a newly recorded snapshot; leave null for retrospective historical imports. */
  knownAt: string | null;
  crosswalk?: readonly NbaCrosswalkEntry[];
};
export function espnNbaGameLogUrl(espnPlayerId: string, season: number): string {
  if (!/^\d+$/.test(espnPlayerId) || !Number.isInteger(season) || season < 1947 || season > 2100) {
    throw new Error("Invalid NBA athlete/season request");
  }
  return `https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/${espnPlayerId}/gamelog?season=${season}`;
}

/** No inferred identity or missing-to-zero conversion. Conflicting duplicates are quarantined. */
export function normalizeEspnNbaGameLog(payload: unknown, request: EspnNbaLogRequest): {
  observations: NbaObservation[]; issues: string[];
} {
  const source = espnNbaGameLogUrl(request.espnPlayerId, request.season);
  const fetched = instant(request.fetchedAt), known = instant(request.knownAt);
  if (fetched === null || (request.knownAt !== null && (known === null || known > fetched))) throw new Error("Invalid provenance timestamps");
  const p = obj(payload);
  if (!Array.isArray(p.names) || !p.names.every(n => typeof n === "string")
    || !Array.isArray(p.seasonTypes) || !p.events || Array.isArray(p.events) || typeof p.events !== "object") {
    throw new Error("Unrecognized ESPN NBA game-log shape");
  }
  const names = p.names as string[];
  if (new Set(names).size !== names.length) throw new Error("Duplicate ESPN stat names");
  const issues: string[] = [];
  const filters = array(p.filters).map(obj);
  const returnedSeason = filters.find(f => f.name === "season")?.value;
  if (returnedSeason === undefined) throw new Error("ESPN did not identify requested season");
  if (String(returnedSeason) !== String(request.season)) throw new Error("ESPN returned a different season");
  const league = filters.find(f => f.name === "league")?.value;
  if (league !== "nba") throw new Error("ESPN did not identify NBA league");
  if (obj(p.athlete).id !== undefined && String(obj(p.athlete).id) !== request.espnPlayerId) throw new Error("ESPN athlete mismatch");
  const identity = resolveEspnNbaIdentity(request.espnPlayerId, request.crosswalk ?? []);
  const events = obj(p.events);
  const rows = new Map<string, NbaObservation>();
  const conflicts = new Set<string>();
  for (const rawType of p.seasonTypes) {
    const seasonType = obj(rawType);
    if (!Array.isArray(seasonType.categories)) { issues.push("Season type missing categories"); continue; }
    for (const rawCategory of seasonType.categories) {
      const category = obj(rawCategory);
      if (category.type === "total") continue; // Never ingest final season/month summary totals.
      if (!Array.isArray(category.events)) { issues.push("Category missing event rows"); continue; }
      for (const rawRow of category.events) {
        const r = obj(rawRow), eventId = id(r.eventId);
        if (!eventId) { issues.push("Row missing event ID"); continue; }
        const event = obj(events[eventId]);
        if (event.id !== undefined && String(event.id) !== eventId) { issues.push(`Event ID mismatch: ${eventId}`); continue; }
        const missing: string[] = [];
        const values = array(r.stats);
        if (values.length !== names.length) missing.push("stat-array-length");
        const field = (name: string) => values[names.indexOf(name)];
        const get = (name: string) => values.length === names.length ? number(field(name)) : null;
        const minutes = values.length === names.length ? parseNbaMinutes(field("minutes")) : null;
        const stats = { points: get("points"), rebounds: get("totalRebounds"), assists: get("assists"),
          steals: get("steals"), blocks: get("blocks"), turnovers: get("turnovers") };
        const status = obj(obj(event.status).type);
        let gameStatus: NbaObservation["gameStatus"] = "unknown";
        let finalEvidence: NbaObservation["finalEvidence"] = null;
        if (status.state === "in") gameStatus = "in_progress";
        else if (status.state === "pre") gameStatus = "scheduled";
        else if (status.completed === true || status.state === "post") { gameStatus = "final"; finalEvidence = "explicit"; }
        else if (Object.keys(status).length === 0 && /^(W|L)$/.test(String(event.gameResult ?? ""))) {
          gameStatus = "final"; finalEvidence = "result";
        }
        const dnp = r.didNotPlay === true || /^DNP(?:\b|$)/i.test(String(field("minutes") ?? ""));
        const participation = dnp ? "dnp" : minutes !== null && minutes > 0 ? "played" : "unknown";
        if (dnp && (minutes !== null && minutes > 0 || NBA_STATS.some(k => (stats[k] ?? 0) > 0))) missing.push("contradictory-dnp");
        const gameAt = timestamp(event.gameDate);
        if (!gameAt) missing.push("gameAt");
        if (minutes === null) missing.push("minutes");
        for (const key of NBA_STATS) if (stats[key] === null) missing.push(key);
        if (gameStatus !== "final") missing.push("final-status");
        const seasonPhase = obj(event.team).isAllStar === true || obj(event.opponent).isAllStar === true
          ? "unknown" : phase(seasonType.displayName);
        if (seasonPhase === "unknown") missing.push("season-phase");
        const pair = (name: string): [number | null, number | null] => {
          const match = String(field(name) ?? "").match(/^(\d+)-(\d+)$/);
          return values.length === names.length && match && Number(match[1]) <= Number(match[2])
            ? [Number(match[1]), Number(match[2])] : [null, null];
        };
        const [fieldGoalsMade, fieldGoalsAttempted] = pair("fieldGoalsMade-fieldGoalsAttempted");
        const [freeThrowsMade, freeThrowsAttempted] = pair("freeThrowsMade-freeThrowsAttempted");
        const [threePointersMade, threePointersAttempted] = pair("threePointFieldGoalsMade-threePointFieldGoalsAttempted");
        const team = obj(event.team), opponent = obj(event.opponent);
        const teamId = id(team.id), opponentId = id(opponent.id);
        if (!teamId) missing.push("team");
        if (!opponentId) missing.push("opponent");
        if (participation === "unknown") missing.push("participation");
        const row: NbaObservation = {
          sport: "nba", identity, provider: "espn", providerPlayerId: request.espnPlayerId, eventId,
          season: request.season, phase: seasonPhase, gameAt, completedAt: null,
          team: { providerId: teamId, abbreviation: text(team.abbreviation) },
          opponent: { providerId: opponentId, abbreviation: text(opponent.abbreviation) },
          homeAway: teamId && teamId === id(event.homeTeamId) ? "home" : teamId && teamId === id(event.awayTeamId) ? "away" : null,
          gameStatus, finalEvidence, participation, minutes,
          starter: typeof r.starter === "boolean" ? r.starter : null,
          stats, shooting: { fieldGoalsMade, fieldGoalsAttempted, freeThrowsMade, freeThrowsAttempted, threePointersMade, threePointersAttempted },
          provenance: { source, fetchedAt: new Date(fetched).toISOString(), knownAt: known === null ? null : new Date(known).toISOString() },
          missing,
        };
        const key = observationKey(row), previous = rows.get(key);
        if (previous && JSON.stringify(previous) !== JSON.stringify(row)) conflicts.add(key);
        rows.set(key, row);
      }
    }
  }
  for (const key of conflicts) { rows.delete(key); issues.push(`Conflicting duplicate quarantined: ${key}`); }
  return { observations: [...rows.values()].sort((a, b) => (a.gameAt ?? "").localeCompare(b.gameAt ?? "") || a.eventId.localeCompare(b.eventId)),
    issues: [...new Set(issues)].sort() };
}

/** Explicit offline/analysis fetch only. No persistence, polling, route imports, or database access. */
export async function fetchEspnNbaGameLog(
  request: Omit<EspnNbaLogRequest, "fetchedAt" | "knownAt">,
  dependencies: { fetcher?: typeof fetch; now?: () => Date } = {},
) {
  const url = espnNbaGameLogUrl(request.espnPlayerId, request.season);
  const response = await (dependencies.fetcher ?? fetch)(url, {
    method: "GET", headers: { Accept: "application/json" }, signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`ESPN NBA game log HTTP ${response.status}`);
  const payload: unknown = await response.json();
  const fetchedAt = (dependencies.now ?? (() => new Date()))().toISOString();
  return normalizeEspnNbaGameLog(payload, { ...request, fetchedAt, knownAt: fetchedAt });
}
