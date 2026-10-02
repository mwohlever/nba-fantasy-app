import { selectNcaaApRankingGroup } from "./ncaa";
import type { NcaaStandings, StandingsGroup, StandingsPoll, StandingsTeam } from "@/lib/live-scores/standings";
import { assertUniqueTeams, displayStat, fetchStandingsJson, normalizeStandingsTeam, object, objects, positiveInteger, seasonIdentity, string, validateTable, type Raw } from "./standingsShared";

export const NCAA_STANDINGS_URL = "https://site.api.espn.com/apis/v2/sports/football/college-football/standings?group=80&seasontype=2&sort=leaguewinpercent:desc,winpercent:desc";
export const NCAA_RANKINGS_URL = "https://site.api.espn.com/apis/site/v2/sports/football/college-football/rankings";

function conferenceGroup(raw: Raw, season: number): StandingsGroup {
  const table = object(raw.standings);
  const groups = objects(raw.children).map(child => conferenceGroup(child, season));
  const entries = objects(table.entries);
  if (entries.length) validateTable(table, season);
  const teams = entries.map(entry => {
    const team = normalizeStandingsTeam(entry);
    team.conferenceRecord = displayStat(entry.stats, "vsconf");
    return team;
  });
  if (teams.length) assertUniqueTeams(teams);
  return { id: String(raw.id ?? ""), name: string(raw.name) ?? "Conference", shortName: string(raw.shortName) ?? string(raw.name) ?? "Conference", teams, groups };
}
export function allConferenceTeams(groups: StandingsGroup[]): StandingsTeam[] {
  return groups.flatMap(group => [...group.teams, ...allConferenceTeams(group.groups)]);
}

function poll(raw: Raw | undefined, source: StandingsPoll["source"], season: number, conferences: StandingsGroup[]): StandingsPoll | null {
  if (!raw || positiveInteger(object(raw.season).year) !== season) return null;
  const expected = source === "ap" ? "ap" : source === "cfp" ? "cfp" : "tournament";
  if (raw.type !== expected || (source === "cfp-seeds" && (String(raw.id) !== "22" || raw.name !== "College Football Playoff Seedings"))) return null;
  const membership = new Map<string, string>();
  const records = new Map<string, string | null>();
  for (const group of conferences) for (const team of allConferenceTeams([group])) {
    membership.set(team.id, group.shortName); records.set(team.id, team.record);
  }
  const entries = objects(raw.ranks);
  if (!entries.length) return null;
  const teams = entries.map(entry => {
    const rawTeam = object(entry.team);
    const team = normalizeStandingsTeam({ team: rawTeam });
    const rank = positiveInteger(entry.current);
    if (!rank || rank > (source === "cfp-seeds" ? 12 : 25)) throw new Error("The provider returned an invalid poll rank.");
    team.rank = rank;
    team.record = records.get(team.id) ?? string(entry.recordSummary) ?? string(object(entry.record).summary);
    team.conference = membership.get(team.id) ?? string(object(rawTeam.groups).shortName);
    return team;
  });
  assertUniqueTeams(teams);
  if (source === "cfp-seeds" && (teams.length !== 12 || new Set(teams.map(team => team.rank)).size !== 12)) {
    throw new Error("The provider did not return a complete official CFP field.");
  }
  return { source, title: source === "ap" ? "AP Top 25" : source === "cfp" ? "CFP Rankings" : "Official CFP Field",
    publishedAt: string(raw.date), teams: teams.sort((a, b) => a.rank! - b.rank!) };
}

export function normalizeNcaaStandings(standingsPayload: unknown, rankingsPayload: unknown): NcaaStandings {
  const standings = object(standingsPayload), rankings = object(rankingsPayload);
  const fallbackYear = positiveInteger(object(rankings.latestSeason).year);
  const identity = standingsPayload ? seasonIdentity(standings) : fallbackYear ? { season: fallbackYear, seasonLabel: String(fallbackYear) } : null;
  if (!identity) throw new Error("Current NCAA standings and rankings are unavailable.");
  const season = identity.season;
  if (standingsPayload && String(standings.id) !== "80") throw new Error("The provider did not return FBS standings.");
  let conferences: StandingsGroup[] = [];
  try {
    conferences = objects(standings.children).map(raw => conferenceGroup(raw, identity.season));
    if (standingsPayload) assertUniqueTeams(allConferenceTeams(conferences));
  } catch { conferences = []; }
  const polls = objects(rankings.rankings).filter(raw => positiveInteger(object(raw.season).year) === identity.season);
  const apRaw = selectNcaaApRankingGroup(polls) as Raw | null;
  // Each section can fail independently; a malformed CFP field must not hide AP
  // rankings or otherwise valid conference standings.
  let malformedCfp = false;
  function safePoll(raw: Raw | undefined, source: StandingsPoll["source"]) {
    try { return poll(raw, source, season, conferences); }
    catch { if (source !== "ap") malformedCfp = true; return null; }
  }
  const ap = safePoll(apRaw ?? undefined, "ap");
  const cfpRankings = safePoll(polls.find(p => p.type === "cfp" && String(p.id) === "21"), "cfp");
  const field = safePoll(polls.find(p => p.type === "tournament" && String(p.id) === "22"), "cfp-seeds");
  return { sport: "ncaa", ...identity, conferences, ap,
    rankingsError: ap ? null : "Current AP Top 25 rankings are unavailable.",
    conferencesError: conferences.length ? null : "Current conference standings are unavailable.",
    cfp: { rankings: cfpRankings, field, message: malformedCfp ? "Some CFP data is temporarily unavailable. Please try refreshing." : cfpRankings || field ? "Official CFP rankings and seedings are separate from the AP poll."
      : "CFP rankings and the official playoff field have not been released for this season." } };
}

export async function fetchNcaaStandings(): Promise<NcaaStandings> {
  const [standingsResult, rankingsResult] = await Promise.allSettled([
    fetchStandingsJson(NCAA_STANDINGS_URL), fetchStandingsJson(NCAA_RANKINGS_URL),
  ]);
  const standings = standingsResult.status === "fulfilled" ? standingsResult.value : null;
  let rankings = rankingsResult.status === "fulfilled" ? rankingsResult.value : null;
  const season = standings ? seasonIdentity(standings).season : positiveInteger(object(object(rankings).latestSeason).year);
  let cfpError = false;
  // Final AP polls can omit CFP polls. Follow only advertised current-season
  // availability; never scan weeks or fetch last year's field as a fallback.
  if (season && rankings && positiveInteger(object(object(rankings).latestSeason).year) === season) {
    const root = object(rankings);
    const present = objects(root.rankings);
    const weeks = new Set(objects(root.availableRankings)
      .filter(item => ["21", "22"].includes(String(item.id)) && !present.some(p => String(p.id) === String(item.id) && positiveInteger(object(p.season).year) === season) && Number(item.seasonType) === 2)
      .map(item => positiveInteger(item.week)).filter((week): week is number => week !== null));
    const extra = await Promise.allSettled([...weeks].map(week => fetchStandingsJson(`${NCAA_RANKINGS_URL}?seasons=${season}&seasontypes=2&weeks=${week}`)));
    for (const result of extra) {
      if (result.status === "rejected") { cfpError = true; continue; }
      const currentPolls = objects(object(result.value).rankings).filter(p => ["21", "22"].includes(String(p.id)) && positiveInteger(object(p.season).year) === season);
      if (!currentPolls.length) cfpError = true;
      present.push(...currentPolls);
    }
    rankings = { ...root, rankings: present };
  }
  const result = normalizeNcaaStandings(standings, rankings);
  if (cfpError || rankingsResult.status === "rejected") result.cfp.message = "CFP data is temporarily unavailable. Please try refreshing.";
  return result;
}
