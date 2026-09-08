export type SavedSetupWeek = { season: number; week_number: number };
type CalendarEntry = { value?: string; endDate?: string };
export type SetupScoreboard = {
  season?: { year?: number; type?: number };
  week?: { number?: number };
  leagues?: { calendar?: { value?: string; entries?: CalendarEntry[] }[] }[];
};

export function ncaaWeekSetup(current: SetupScoreboard, selected: SetupScoreboard, saved: SavedSetupWeek[], requestedSeason?: number, now = Date.now()) {
  const seasons = [...new Set([current.season?.year, requestedSeason, ...saved.map(w => Number(w.season))]
    .filter((n): n is number => Number.isInteger(n) && Number(n) > 0))].sort((a, b) => b - a);
  const season = requestedSeason ?? current.season?.year ?? seasons[0];
  // Pick'em currently imports seasontype=2 only. Postseason week 1 is a different identity.
  const entries = selected.season?.year === season
    ? selected.leagues?.[0]?.calendar?.find(c => String(c.value) === "2")?.entries ?? [] : [];
  const weeks = [...new Set([...entries.map(e => Number(e.value)), ...saved.filter(w => Number(w.season) === season).map(w => Number(w.week_number))])]
    .filter(n => Number.isInteger(n) && n > 0).sort((a, b) => a - b);
  const providerWeek = current.season?.year === season && current.season?.type === 2 ? current.week?.number : undefined;
  const upcoming = entries.find(e => Date.parse(e.endDate ?? "") >= now);
  const savedWeek = saved.filter(w => Number(w.season) === season).sort((a, b) => b.week_number - a.week_number)[0]?.week_number;
  const week = providerWeek && weeks.includes(providerWeek) ? providerWeek : upcoming ? Number(upcoming.value) : savedWeek ?? weeks[0];
  return { seasons, season, weeks, week };
}

export async function fetchNcaaSetupScoreboard(season?: number): Promise<SetupScoreboard> {
  const params = new URLSearchParams({ limit: "1" });
  if (season) params.set("dates", String(season));
  const response = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?${params}`, { cache: "no-store", signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error("Unable to load ESPN week options.");
  return response.json();
}
