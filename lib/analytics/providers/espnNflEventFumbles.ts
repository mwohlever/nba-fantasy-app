import { reconcileNflFumbleEvidence } from "./nflFumbleEvidence";

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
  const zeroEligibleTeams: string[] = [], issues: string[] = [];
  const conflictedPlayerIds: string[] = [];
  const athleteTeams: Record<string, string> = {};
  const state = obj(obj(competition).status).type;
  const final = obj(state).completed === true && obj(state).state === "post" &&
    !/POSTPON|SUSPEND|CANCEL|UNNECESSARY/i.test(`${obj(state).name ?? ""} ${obj(state).description ?? ""}`);
  const season = Number(obj(header.season).year), phase = Number(obj(header.season).type);
  const competitors = array(obj(competition).competitors).map(c => id(obj(obj(c).team).id));
  if (competitors.length && (competitors.length !== 2 || competitors.some(c => !c) || new Set(competitors).size !== 2)) throw new Error("Invalid ESPN fumbles event teams");
  const seenTeams = new Set<string>();
  for (const rawTeam of teams) {
    const teamId = id(obj(obj(rawTeam).team).id);
    if (competitors.length && (!teamId || !competitors.includes(teamId))) throw new Error("ESPN fumbles team/event mismatch");
    if (teamId && seenTeams.has(teamId)) throw new Error("Duplicate ESPN fumbles team");
    if (teamId) seenTeams.add(teamId);
    const statistics = obj(rawTeam).statistics;
    if (!Array.isArray(statistics)) throw new Error("ESPN summary team missing statistics");
    let teamGroups = 0;
    for (const rawGroup of statistics) {
      const group = obj(rawGroup);
      if (group.name !== "fumbles") continue;
      groups++;
      if (++teamGroups > 1) throw new Error("Duplicate ESPN fumbles statistics group");
      if (!Array.isArray(group.labels) || !(group.labels as unknown[]).every(label => typeof label === "string") || !Array.isArray(group.athletes)) throw new Error("ESPN fumbles group malformed");
      const labels = group.labels as string[], lostIndex = labels.indexOf("LOST"), totalIndex = labels.indexOf("FUM"), recoveriesIndex = labels.indexOf("REC");
      if (new Set(labels).size !== labels.length) throw new Error("Duplicate ESPN fumbles labels");
      if (lostIndex < 0 || totalIndex < 0) throw new Error("ESPN fumbles group missing FUM or LOST label");
      for (const rawAthlete of group.athletes) {
        const athleteRow = obj(rawAthlete), athleteId = id(obj(athleteRow.athlete).id), stats = array(athleteRow.stats);
        if (!athleteId) throw new Error("ESPN fumbles row missing athlete ID");
        if (stats.length !== labels.length) throw new Error(`ESPN fumbles stat-array length mismatch: ${athleteId}`);
        const totalFumbles = integer(stats[totalIndex]), fumblesLost = integer(stats[lostIndex]), recoveries = recoveriesIndex < 0 ? null : integer(stats[recoveriesIndex]);
        if (totalFumbles === null || fumblesLost === null || (recoveriesIndex >= 0 && recoveries === null)) throw new Error(`ESPN fumbles values invalid: ${athleteId}`);
        if (fumblesLost > totalFumbles) throw new Error("ESPN LOST exceeds FUM");
        if (rows.has(athleteId)) throw new Error(`Duplicate ESPN fumbles athlete row: ${athleteId}`);
        rows.set(athleteId, { providerPlayerId: athleteId, totalFumbles, fumblesLost, recoveries });
        if (teamId) athleteTeams[athleteId] = teamId;
      }
      // Keep validation above for explicit athlete cells; shared evidence below
      // handles absence and independent team totals identically to Player Center.
    }
    if (!teamGroups) issues.push(`missing_fumbles_group:${teamId ?? "unknown_team"}`);
    const evidence = reconcileNflFumbleEvidence({
      group: statistics.find(g => obj(g).name === "fumbles"), final,
      teamTotals: array(obj(p.boxscore).teams).filter(t => id(obj(obj(t).team).id) === teamId),
    });
    if (teamId && evidence.absenceEvidence) zeroEligibleTeams.push(teamId);
    issues.push(...evidence.issues.map(issue => `${teamId ?? "unknown_team"}:${issue}`));
    for (const athleteId of evidence.conflicts) { rows.delete(athleteId); conflictedPlayerIds.push(athleteId); }
  }
  if (!groups) issues.push("fumbles_evidence_unavailable");
  return { eventId: request.eventId, source, fetchedAt: new Date(request.fetchedAt).toISOString(), normalizationVersion: NFL_EVENT_FUMBLES_NORMALIZATION_VERSION,
    zeroEligibleTeams, conflictedPlayerIds, athleteTeams, issues,
    season: Number.isInteger(season) ? season : null, phase: Number.isInteger(phase) ? phase : null, final,
    athletes: [...rows.values()].sort((left, right) => Number(left.providerPlayerId) - Number(right.providerPlayerId)) };
}
