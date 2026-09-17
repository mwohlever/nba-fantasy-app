type Obj = Record<string, unknown>;
const obj = (value: unknown): Obj => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Obj : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const id = (value: unknown): string | null => typeof value === "string" && /^\d+$/.test(value) ? value : null;

export type EspnNflEventStatus = {
  providerEventId: string;
  season: number;
  phase: "regular";
  completed: boolean;
};

export function espnNflRegularSeasonScoreboardUrl(season: number) {
  if (!Number.isInteger(season) || season < 1920 || season > 2100) throw new Error("Invalid NFL scoreboard season");
  return `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${season}&seasontype=2&limit=1000`;
}

/** ESPN `dates=season` is a calendar-year range, so full NFL seasons must be enumerated by regular week. */
export function espnNflRegularSeasonScoreboardWeekUrl(season: number, week: number) {
  if (!Number.isInteger(season) || season < 1920 || season > 2100 || !Number.isInteger(week) || week < 1 || week > 18) throw new Error("Invalid NFL scoreboard season/week");
  return `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${season}&seasontype=2&week=${week}&limit=100`;
}

/**
 * The game-log endpoint supplies stats but no reliable final-status flag. This
 * separate schedule source is the sole completed-game gate for Phase B.
 */
export function normalizeEspnNflRegularSeasonScoreboard(payload: unknown, season: number, expectedWeek?: number) {
  if (expectedWeek !== undefined && (!Number.isInteger(expectedWeek) || expectedWeek < 1 || expectedWeek > 18)) throw new Error("Invalid expected NFL regular-season week");
  const p = obj(payload), seen = new Map<string, EspnNflEventStatus>();
  if (!Array.isArray(p.events)) throw new Error("Unrecognized ESPN NFL scoreboard shape");
  for (const rawEvent of p.events) {
    const event = obj(rawEvent), providerEventId = id(event.id), eventSeason = obj(event.season);
    const type = Number(eventSeason.type), year = Number(eventSeason.year);
    if (!providerEventId || !Number.isInteger(year) || !Number.isInteger(type)) throw new Error("ESPN scoreboard event missing identity or season");
    if (year !== season || type !== 2) continue;
    const week = Number(obj(event.week).number);
    if (expectedWeek !== undefined && week !== expectedWeek) throw new Error(`ESPN scoreboard event returned wrong week: ${providerEventId}`);
    const competition = obj(array(event.competitions)[0]);
    const status = obj(competition.status ?? event.status), statusType = obj(status.type);
    if (typeof statusType.completed !== "boolean" || typeof statusType.state !== "string") throw new Error(`ESPN scoreboard event missing final status: ${providerEventId}`);
    const completed = statusType.completed === true && statusType.state === "post";
    if (seen.has(providerEventId)) throw new Error(`Duplicate ESPN scoreboard event: ${providerEventId}`);
    seen.set(providerEventId, { providerEventId, season, phase: "regular", completed });
  }
  return [...seen.values()].sort((left, right) => Number(left.providerEventId) - Number(right.providerEventId));
}

/** Week requests are independently normalized, then safely deduped across provider responses. */
export function mergeEspnNflRegularSeasonScoreboards(groups: readonly (readonly EspnNflEventStatus[])[]) {
  const merged = new Map<string, EspnNflEventStatus>();
  for (const group of groups) for (const event of group) {
    const existing = merged.get(event.providerEventId);
    if (existing && (existing.season !== event.season || existing.phase !== event.phase || existing.completed !== event.completed)) throw new Error(`Conflicting ESPN scoreboard event: ${event.providerEventId}`);
    merged.set(event.providerEventId, event);
  }
  return [...merged.values()].sort((left, right) => Number(left.providerEventId) - Number(right.providerEventId));
}
