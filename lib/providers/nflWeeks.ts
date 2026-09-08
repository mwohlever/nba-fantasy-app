import { ESPN_BASE_URL } from "./nfl";

type Raw = Record<string, any>;
export type NflWeek = {
  season: number;
  week: number;
  name: string;
  startDate: string;
  endDate: string;
  gameCount: number;
};

export function nflRegularWeeks(payload: Raw) {
  return ((payload.leagues?.[0]?.calendar ?? []).find((part: Raw) => String(part.value) === "2")?.entries ?? [])
    .filter((entry: Raw) => Number(entry.value) >= 1 && Number(entry.value) <= 18) as Raw[];
}

export function defaultNflWeek(payload: Raw, now = Date.now()) {
  const entries = nflRegularWeeks(payload);
  const current = Number(payload.week?.number);
  if (Number(payload.season?.type) === 2 && entries.some(e => Number(e.value) === current)) return current;
  return Number((entries.find(e => Date.parse(e.endDate) >= now) ?? entries.at(-1))?.value);
}

export function resolveNflWeekPayload(payload: Raw, season: number, week: number): NflWeek {
  if (Number(payload.season?.year) !== season || Number(payload.season?.type) !== 2 || Number(payload.week?.number) !== week ||
      !nflRegularWeeks(payload).some(e => Number(e.value) === week)) {
    throw new Error("ESPN did not return the requested NFL regular-season week.");
  }
  const events: Raw[] = payload.events ?? [];
  if (!events.length || events.some(e => Number(e.season?.year) !== season || Number(e.season?.type) !== 2 || Number(e.week?.number) !== week || !Number.isFinite(Date.parse(e.date)))) {
    throw new Error("The selected NFL week does not have a complete dated schedule available.");
  }
  // Match the Game Center resolver's US calendar-day convention, including Monday night.
  const dates = events.map(e => new Date(e.date).toLocaleDateString("en-CA", { timeZone: "America/New_York" })).sort();
  return { season, week, name: `${season} Week ${week}`, startDate: dates[0], endDate: dates.at(-1)!, gameCount: events.length };
}

export function validateNflWeekDates(week: NflWeek, start?: string, end?: string) {
  return (!start || start === week.startDate) && (!end || end === week.endDate);
}

export function isDuplicateNflWeek(slate: { sport: string; league_id: string; display_name?: string | null; start_date?: string | null; end_date?: string | null; date: string }, leagueId: string, week: NflWeek) {
  return slate.sport === "nfl" && slate.league_id === leagueId &&
    (slate.display_name === week.name || ((slate.start_date ?? slate.date) <= week.endDate && (slate.end_date ?? slate.date) >= week.startDate));
}

async function scoreboard(season?: number, week?: number) {
  const params = new URLSearchParams({ limit: "100" });
  if (season !== undefined) params.set("dates", String(season));
  if (week !== undefined) { params.set("seasontype", "2"); params.set("week", String(week)); }
  const response = await fetch(`${ESPN_BASE_URL}/scoreboard?${params}`, { next: { revalidate: 300 }, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`NFL schedule unavailable (${response.status}).`);
  return response.json();
}

export async function fetchNflWeek(season: number, week: number) {
  if (!Number.isInteger(season) || season < 2000 || season > 2200 || !Number.isInteger(week) || week < 1 || week > 18) throw new Error("Select a valid NFL season and regular-season week.");
  return resolveNflWeekPayload(await scoreboard(season, week), season, week);
}

export async function fetchNflWeekSelection(season?: number, week?: number) {
  if (season !== undefined && (!Number.isInteger(season) || season < 2000 || season > 2200)) throw new Error("Invalid NFL season.");
  const payload = await scoreboard(season);
  const resolvedSeason = season ?? Number(payload.season?.year);
  if (Number(payload.season?.year) !== resolvedSeason) throw new Error("NFL season schedule is not available yet.");
  const weeks = nflRegularWeeks(payload).map(e => ({ value: Number(e.value), label: String(e.label) }));
  const selected = await fetchNflWeek(resolvedSeason, week ?? defaultNflWeek(payload));
  return { ...selected, weeks };
}
