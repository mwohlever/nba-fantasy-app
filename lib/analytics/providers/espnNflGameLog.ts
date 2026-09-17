type Obj = Record<string, unknown>;
const obj = (value: unknown): Obj => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Obj : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const text = (value: unknown): string | null => typeof value === "string" && value.trim() ? value.trim() : null;
const id = (value: unknown): string | null => typeof value === "string" && /^\d+$/.test(value) ? value : null;
const nflPositions = new Set(["QB", "RB", "WR", "TE"]);

function numeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  if (typeof value !== "string" || !/^\d+(?:\.\d+)?$/.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function timestamp(value: unknown): string | null {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

export type NflResearchPosition = "QB" | "RB" | "WR" | "TE";
export type NflGameLogObservation = {
  sport: "nfl"; provider: "espn"; providerPlayerId: string; playerName: string | null; position: NflResearchPosition;
  season: number; phase: "regular"; week: number; eventId: string; gameAt: string;
  team: { providerId: string; abbreviation: string | null }; opponent: { providerId: string; abbreviation: string | null };
  homeAway: "home" | "away" | null;
  stats: { completions: number | null; passingAttempts: number | null; passingYards: number | null; passingTouchdowns: number | null;
    interceptions: number | null; rushingAttempts: number | null; rushingYards: number | null; rushingTouchdowns: number | null;
    receivingTargets: number | null; receptions: number | null; receivingYards: number | null; receivingTouchdowns: number | null; fumblesLost: number | null };
  provenance: { source: string; fetchedAt: string; knownAt: null };
};

export function espnNflGameLogUrl(espnPlayerId: string, season: number) {
  if (!/^\d+$/.test(espnPlayerId) || !Number.isInteger(season) || season < 1920 || season > 2100) throw new Error("Invalid NFL athlete/season request");
  return `https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/athletes/${espnPlayerId}/gamelog?season=${season}`;
}

/** Production acquisition wrapper; the frozen normalizer remains the source of truth. */
export async function fetchEspnNflGameLog(request: { espnPlayerId: string; playerName?: string; season: number; position: NflResearchPosition }, fetcher: typeof fetch = fetch) {
  const source = espnNflGameLogUrl(request.espnPlayerId, request.season);
  const response = await fetcher(source, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`ESPN NFL game log HTTP ${response.status}: ${request.espnPlayerId}`);
  const fetchedAt = new Date().toISOString();
  return normalizeEspnNflGameLog(await response.json(), { ...request, fetchedAt });
}

/** Strict historical regular-season parser. It never substitutes unknown fields with zero. */
export function normalizeEspnNflGameLog(payload: unknown, request: { espnPlayerId: string; playerName?: string; season: number; position: NflResearchPosition; fetchedAt: string }) {
  const source = espnNflGameLogUrl(request.espnPlayerId, request.season);
  if (!timestamp(request.fetchedAt)) throw new Error("Invalid provenance timestamp");
  if (!nflPositions.has(request.position)) throw new Error("NFL V2 research supports QB/RB/WR/TE only");
  const p = obj(payload);
  const filters = array(p.filters).map(obj);
  if (String(filters.find(filter => filter.name === "season")?.value) !== String(request.season)) throw new Error("ESPN returned a different NFL season");
  if (filters.find(filter => filter.name === "league")?.value !== "nfl") throw new Error("ESPN did not identify NFL league");
  // ESPN returns only validated filters, with no names/events, for a season in
  // which the athlete has no NFL game-log history. That is factual absence,
  // not a malformed log and must remain distinguishable from a parser error.
  if (Object.keys(p).every(key => key === "filters")) return { observations: [] as NflGameLogObservation[], conflicts: [] as string[] };
  if (!Array.isArray(p.names) || !(p.names as unknown[]).every(value => typeof value === "string") || !Array.isArray(p.seasonTypes) || !p.events || Array.isArray(p.events) || typeof p.events !== "object") throw new Error("Unrecognized ESPN NFL game-log shape");
  const names = p.names as string[];
  if (new Set(names).size !== names.length) throw new Error("Duplicate ESPN NFL stat names");
  const events = obj(p.events), rows = new Map<string, NflGameLogObservation>(), conflicts = new Set<string>();
  for (const rawSeasonType of p.seasonTypes as unknown[]) {
    const seasonType = obj(rawSeasonType);
    // ESPN's splitType 2 is the authoritative regular-season discriminator.
    for (const rawCategory of array(seasonType.categories)) {
      const category = obj(rawCategory);
      if (category.splitType !== "2") continue;
      // ESPN emits this exact metadata-only category for an active athlete with
      // no regular-season appearance yet: { displayName, type: "event",
      // splitType: "2" }. It is factual absence, not malformed provider data.
      if (!Object.hasOwn(category, "events")) {
        if (category.displayName === "Regular Season Stats" && category.type === "event") continue;
        throw new Error("Regular-season category missing event rows");
      }
      if (!Array.isArray(category.events)) throw new Error("Regular-season category has invalid event rows");
      for (const rawRow of category.events) {
        const row = obj(rawRow), eventId = id(row.eventId);
        if (!eventId) throw new Error("Regular-season row missing provider event ID");
        const event = obj(events[eventId]);
        if (String(event.id ?? eventId) !== eventId) throw new Error(`Event ID mismatch: ${eventId}`);
        const values = array(row.stats);
        if (values.length !== names.length) throw new Error(`Stat array length mismatch: ${eventId}`);
        const required = (name: string) => {
          const index = names.indexOf(name);
          if (index < 0) throw new Error(`Required ESPN NFL stat missing: ${name}`);
          return numeric(values[index]);
        };
        const optional = (name: string) => {
          const index = names.indexOf(name);
          return index < 0 ? null : numeric(values[index]);
        };
        const team = obj(event.team), opponent = obj(event.opponent);
        const teamId = id(team.id), opponentId = id(opponent.id), gameAt = timestamp(event.gameDate), week = Number(event.week);
        if (!teamId || !opponentId || !gameAt || !Number.isInteger(week) || week < 1 || week > 18) throw new Error(`Incomplete event context: ${eventId}`);
        const common = { rushingAttempts: optional("rushingAttempts"), rushingYards: optional("rushingYards"), rushingTouchdowns: optional("rushingTouchdowns") };
        let stats: NflGameLogObservation["stats"];
        if (request.position === "QB") {
          stats = { completions: required("completions"), passingAttempts: required("passingAttempts"), passingYards: required("passingYards"), passingTouchdowns: required("passingTouchdowns"), interceptions: required("interceptions"), ...common,
            receivingTargets: null, receptions: null, receivingYards: null, receivingTouchdowns: null, fumblesLost: optional("fumblesLost") };
        } else {
          stats = { completions: null, passingAttempts: null, passingYards: null, passingTouchdowns: null, interceptions: null, ...common,
            receivingTargets: required("receivingTargets"), receptions: required("receptions"), receivingYards: required("receivingYards"), receivingTouchdowns: required("receivingTouchdowns"), fumblesLost: required("fumblesLost") };
        }
        const observation: NflGameLogObservation = { sport: "nfl", provider: "espn", providerPlayerId: request.espnPlayerId, playerName: text(p.displayName) ?? text(request.playerName), position: request.position,
          season: request.season, phase: "regular", week, eventId, gameAt, team: { providerId: teamId, abbreviation: text(team.abbreviation) }, opponent: { providerId: opponentId, abbreviation: text(opponent.abbreviation) },
          homeAway: teamId === id(event.homeTeamId) ? "home" : teamId === id(event.awayTeamId) ? "away" : null, stats,
          provenance: { source, fetchedAt: new Date(request.fetchedAt).toISOString(), knownAt: null } };
        const key = `${request.espnPlayerId}:${eventId}`, previous = rows.get(key);
        if (previous && JSON.stringify(previous) !== JSON.stringify(observation)) conflicts.add(key);
        rows.set(key, observation);
      }
    }
  }
  for (const key of conflicts) rows.delete(key);
  return { observations: [...rows.values()].sort((left, right) => left.gameAt.localeCompare(right.gameAt) || left.eventId.localeCompare(right.eventId)), conflicts: [...conflicts].sort() };
}
