type Obj = Record<string, unknown>;
const obj = (value: unknown): Obj => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Obj : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const id = (value: unknown): string | null => typeof value === "string" && /^\d+$/.test(value) ? value : null;
function integer(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  if (typeof value !== "string" || !/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value); return Number.isSafeInteger(parsed) ? parsed : null;
}

export const NFL_EVENT_FUMBLES_NORMALIZATION_VERSION = "espn_nfl_event_summary_fumbles_v1";

export function espnNflEventSummaryUrl(eventId: string) {
  if (!/^\d+$/.test(eventId)) throw new Error("Invalid NFL event ID");
  return `https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${eventId}`;
}

/** Production acquisition wrapper; strict FUM/LOST validation remains below. */
export async function fetchEspnNflEventFumbles(eventId: string, fetcher: typeof fetch = fetch) {
  const source = espnNflEventSummaryUrl(eventId);
  const response = await fetcher(source, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`ESPN NFL event summary HTTP ${response.status}: ${eventId}`);
  return normalizeEspnNflEventFumbles(await response.json(), { eventId, fetchedAt: new Date().toISOString() });
}

/** Strictly normalize only the factual FUM/LOST evidence used by offline NFL research. */
export function normalizeEspnNflEventFumbles(payload: unknown, request: { eventId: string; fetchedAt: string }) {
  const source = espnNflEventSummaryUrl(request.eventId);
  if (!Number.isFinite(Date.parse(request.fetchedAt))) throw new Error("Invalid fumble-summary provenance timestamp");
  const p = obj(payload), header = obj(p.header), competition = array(header.competitions)[0];
  if (String(header.id ?? "") !== request.eventId || String(obj(competition).id ?? "") !== request.eventId) throw new Error("ESPN summary event identity mismatch");
  const teams = array(obj(p.boxscore).players);
  if (!teams.length) throw new Error("ESPN summary missing boxscore players");
  const rows = new Map<string, { providerPlayerId: string; totalFumbles: number; fumblesLost: number; recoveries: number | null }>();
  let groups = 0;
  for (const rawTeam of teams) {
    const statistics = obj(rawTeam).statistics;
    if (!Array.isArray(statistics)) throw new Error("ESPN summary team missing statistics");
    for (const rawGroup of statistics) {
      const group = obj(rawGroup);
      if (group.name !== "fumbles") continue;
      groups++;
      if (!Array.isArray(group.labels) || !(group.labels as unknown[]).every(label => typeof label === "string") || !Array.isArray(group.athletes)) throw new Error("ESPN fumbles group malformed");
      const labels = group.labels as string[], lostIndex = labels.indexOf("LOST"), totalIndex = labels.indexOf("FUM"), recoveriesIndex = labels.indexOf("REC");
      if (lostIndex < 0 || totalIndex < 0) throw new Error("ESPN fumbles group missing FUM or LOST label");
      for (const rawAthlete of group.athletes) {
        const athleteRow = obj(rawAthlete), athleteId = id(obj(athleteRow.athlete).id), stats = array(athleteRow.stats);
        if (!athleteId) throw new Error("ESPN fumbles row missing athlete ID");
        if (stats.length !== labels.length) throw new Error(`ESPN fumbles stat-array length mismatch: ${athleteId}`);
        const totalFumbles = integer(stats[totalIndex]), fumblesLost = integer(stats[lostIndex]), recoveries = recoveriesIndex < 0 ? null : integer(stats[recoveriesIndex]);
        if (totalFumbles === null || fumblesLost === null || (recoveriesIndex >= 0 && recoveries === null)) throw new Error(`ESPN fumbles values invalid: ${athleteId}`);
        if (rows.has(athleteId)) throw new Error(`Duplicate ESPN fumbles athlete row: ${athleteId}`);
        rows.set(athleteId, { providerPlayerId: athleteId, totalFumbles, fumblesLost, recoveries });
      }
    }
  }
  if (!groups) throw new Error("ESPN summary missing fumbles statistics group");
  return { eventId: request.eventId, source, fetchedAt: new Date(request.fetchedAt).toISOString(), normalizationVersion: NFL_EVENT_FUMBLES_NORMALIZATION_VERSION,
    athletes: [...rows.values()].sort((left, right) => Number(left.providerPlayerId) - Number(right.providerPlayerId)) };
}
