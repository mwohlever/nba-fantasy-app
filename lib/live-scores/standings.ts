/** Public provider data only. No fantasy team, roster, or ownership identity. */
export type StandingsTeam = {
  id: string;
  name: string;
  shortName: string;
  abbreviation: string | null;
  logo: string | null;
  record: string | null;
  wins: number | null;
  losses: number | null;
  ties: number | null;
  percentage: string | null;
  gamesBack: string | null;
  rank: number | null;
  conferenceRank: number | null;
  divisionRank: number | null;
  conference: string | null;
  conferenceRecord: string | null;
  clincher: { symbol: string; description: string } | null;
};

export type StandingsGroup = {
  id: string;
  name: string;
  shortName: string;
  teams: StandingsTeam[];
  groups: StandingsGroup[];
};

export type ProStandings = {
  sport: "nba" | "nfl";
  season: number;
  seasonLabel: string;
  hasResults: boolean;
  conferences: StandingsGroup[];
  playoffs: { available: boolean; message: string };
};

export type StandingsPoll = {
  source: "ap" | "cfp" | "cfp-seeds";
  title: string;
  publishedAt: string | null;
  teams: StandingsTeam[];
};

export type NcaaStandings = {
  sport: "ncaa";
  season: number;
  seasonLabel: string;
  conferences: StandingsGroup[];
  ap: StandingsPoll | null;
  cfp: { rankings: StandingsPoll | null; field: StandingsPoll | null; message: string };
  rankingsError: string | null;
  conferencesError: string | null;
};
