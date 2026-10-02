import type { ProStandings, StandingsGroup, StandingsTeam } from "@/lib/live-scores/standings";
import { normalizeTeamCode } from "./nbaSkinsRecords.mjs";
import { assertUniqueTeams, fetchStandingsJson, normalizeStandingsTeam, object, objects, seasonIdentity, string, validateTable, type Raw } from "./standingsShared";

export const NBA_STANDINGS_URL = "https://site.api.espn.com/apis/v2/sports/basketball/nba/standings?seasontype=2&sort=winpercent:desc";
export const NFL_STANDINGS_URL = "https://site.api.espn.com/apis/v2/sports/football/nfl/standings?seasontype=2&type=1&level=3";

function group(raw: Raw, teams: StandingsTeam[], groups: StandingsGroup[] = []): StandingsGroup {
  return { id: String(raw.id ?? ""), name: string(raw.name) ?? "Standings", shortName: string(raw.shortName) ?? string(raw.abbreviation) ?? string(raw.name) ?? "Standings", teams, groups };
}

export function normalizeNbaStandings(payload: unknown): ProStandings {
  const identity = seasonIdentity(payload);
  const conferences = objects(object(payload).children).map(raw => {
    const table = object(raw.standings); validateTable(table, identity.season);
    const teams = objects(table.entries).map(entry => {
      const team = normalizeStandingsTeam(entry);
      team.abbreviation = normalizeTeamCode(team.abbreviation);
      return team;
    });
    assertUniqueTeams(teams, 15);
    return group(raw, teams);
  });
  if (conferences.length !== 2 || !conferences.some(c => c.id === "5") || !conferences.some(c => c.id === "6")) throw new Error("NBA conferences are unavailable.");
  const teams = conferences.flatMap(c => c.teams); assertUniqueTeams(teams, 30);
  return { sport: "nba", ...identity, conferences, hasResults: teams.some(t => (t.wins ?? 0) + (t.losses ?? 0) > 0),
    playoffs: { available: false, message: "Verified NBA playoff positioning is not available from our standings provider yet." } };
}

function completeRanks(teams: StandingsTeam[], field: "divisionRank" | "conferenceRank") {
  return teams.every(t => t[field] !== null && t[field]! <= teams.length) && new Set(teams.map(t => t[field])).size === teams.length;
}

export function normalizeNflStandings(payload: unknown): ProStandings {
  const identity = seasonIdentity(payload);
  const conferences = objects(object(payload).children).map(raw => {
    const divisions = objects(raw.children).map(division => {
      const table = object(division.standings); validateTable(table, identity.season);
      const teams = objects(table.entries).map(normalizeStandingsTeam); assertUniqueTeams(teams, 4);
      // Numeric sorting uses ESPN's resolved rank, including its tiebreaks.
      if (completeRanks(teams, "divisionRank")) teams.sort((a, b) => a.divisionRank! - b.divisionRank!);
      return group(division, teams);
    });
    if (divisions.length !== 4) throw new Error("NFL divisions are unavailable.");
    const teams = divisions.flatMap(d => d.teams); assertUniqueTeams(teams, 16);
    if (completeRanks(teams, "conferenceRank")) teams.sort((a, b) => a.conferenceRank! - b.conferenceRank!);
    return group(raw, teams, divisions);
  });
  if (conferences.length !== 2 || !conferences.some(c => c.id === "8") || !conferences.some(c => c.id === "7")) throw new Error("NFL conferences are unavailable.");
  const teams = conferences.flatMap(c => c.teams); assertUniqueTeams(teams, 32);
  const hasResults = teams.some(t => (t.wins ?? 0) + (t.losses ?? 0) + (t.ties ?? 0) > 0);
  const available = hasResults && conferences.every(c => completeRanks(c.teams, "conferenceRank")
    && c.groups.every(d => completeRanks(d.teams, "divisionRank"))
    && c.teams.every(t => t.conferenceRank! <= 4 ? t.divisionRank === 1 : t.divisionRank !== 1));
  return { sport: "nfl", ...identity, conferences, hasResults, playoffs: { available,
    message: available ? "Current playoff picture supplied by ESPN. Positions can change until the field is finalized."
      : "Verified NFL playoff ordering is not available yet." } };
}

export async function fetchProStandings(sport: "nba" | "nfl") {
  const payload = await fetchStandingsJson(sport === "nba" ? NBA_STANDINGS_URL : NFL_STANDINGS_URL);
  return sport === "nba" ? normalizeNbaStandings(payload) : normalizeNflStandings(payload);
}
