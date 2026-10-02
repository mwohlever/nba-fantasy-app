import type { StandingsTeam } from "@/lib/live-scores/standings";

export type Raw = Record<string, unknown>;
export const object = (value: unknown): Raw => value && typeof value === "object" && !Array.isArray(value) ? value as Raw : {};
export const objects = (value: unknown): Raw[] => Array.isArray(value) ? value.map(object) : [];
export const string = (value: unknown): string | null => typeof value === "string" && value.trim() ? value.trim() : null;
export function number(value: unknown): number | null {
  if (value === null || value === undefined || value === "" || (typeof value !== "number" && typeof value !== "string")) return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}
export function positiveInteger(value: unknown) {
  const result = number(value);
  return result !== null && Number.isInteger(result) && result > 0 ? result : null;
}
export function stat(stats: unknown, type: string) {
  return objects(stats).find(entry => entry.type === `total_${type}`)
    ?? objects(stats).find(entry => entry.type === type);
}
export function numericStat(stats: unknown, type: string) { return number(stat(stats, type)?.value); }
export function displayStat(stats: unknown, type: string) {
  const entry = stat(stats, type);
  return string(entry?.summary) ?? string(entry?.displayValue);
}
export function seasonIdentity(payload: unknown) {
  const season = object(object(payload).season);
  const year = positiveInteger(season.year);
  if (!year || year < 2000 || year > 2100) throw new Error("The provider did not identify a valid standings season.");
  return { season: year, seasonLabel: string(season.displayName) ?? String(year) };
}
export function validateTable(table: Raw, season: number) {
  if (number(table.season) !== season || number(table.seasonType) !== 2) throw new Error("Standings do not match the requested regular season.");
}
export function normalizeStandingsTeam(entry: Raw): StandingsTeam {
  const team = object(entry.team);
  const id = String(team.id ?? "");
  const name = string(team.displayName) ?? string(team.location) ?? string(team.name);
  if (!/^\d+$/.test(id) || !name) throw new Error("Standings contain an invalid provider team.");
  const symbol = displayStat(entry.stats, "clincher");
  const description = string(stat(entry.stats, "clincher")?.description);
  return {
    id, name, shortName: string(team.shortDisplayName) ?? string(team.location) ?? name,
    abbreviation: string(team.abbreviation), logo: string(team.logo) ?? string(objects(team.logos)[0]?.href),
    record: displayStat(entry.stats, "total"), wins: numericStat(entry.stats, "wins"), losses: numericStat(entry.stats, "losses"),
    ties: numericStat(entry.stats, "ties"), percentage: displayStat(entry.stats, "winpercent"), gamesBack: displayStat(entry.stats, "gamesbehind"),
    rank: null, conferenceRank: positiveInteger(stat(entry.stats, "conferencerank")?.value),
    divisionRank: positiveInteger(stat(entry.stats, "divisionrank")?.value), conference: null,
    conferenceRecord: displayStat(entry.stats, "vsconf") ?? displayStat(entry.stats, "conferencerecord"),
    clincher: symbol && description ? { symbol, description } : null,
  };
}
export function assertUniqueTeams(teams: StandingsTeam[], count?: number) {
  if (!teams.length || new Set(teams.map(team => team.id)).size !== teams.length || (count !== undefined && teams.length !== count)) {
    throw new Error("The provider returned incomplete or duplicate standings teams.");
  }
}
/** Cache only public ESPN responses, never authorization or Group data. */
export async function fetchStandingsJson(url: string): Promise<unknown> {
  const response = await fetch(url, { next: { revalidate: 300 }, signal: AbortSignal.timeout(20000), headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Standings provider unavailable (${response.status}).`);
  return response.json();
}
