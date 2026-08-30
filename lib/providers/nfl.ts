const ESPN_BASE_URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";
const ESPN_SUMMARY_URL = "https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/summary";

export type EspnTeam = {
  id: string;
  abbreviation: string;
  displayName: string;
};

export async function fetchTeams(): Promise<EspnTeam[]> {
  const response = await fetch(`${ESPN_BASE_URL}/teams?limit=40`, {
    cache: "no-store",
  });

  if (!response.ok) return [];

  const payload = await response.json();
  const entries = payload.sports?.[0]?.leagues?.[0]?.teams ?? [];

  return entries.map((entry: any) => ({
    id: entry.team.id,
    abbreviation: entry.team.abbreviation,
    displayName: entry.team.displayName,
  }));
}

export type EspnRosterAthlete = {
  id: string;
  displayName: string;
  position?: { abbreviation?: string };
};

export async function fetchTeamRoster(teamId: string): Promise<EspnRosterAthlete[]> {
  const response = await fetch(`${ESPN_BASE_URL}/teams/${teamId}/roster`, {
    cache: "no-store",
  });

  if (!response.ok) return [];

  const payload = await response.json();
  const groups = payload.athletes ?? [];
  const offenseGroup = groups.find((group: any) => group.position === "offense");

  return offenseGroup?.items ?? [];
}

export async function fetchCurrentWeekTeamAbbreviations(): Promise<Set<string>> {
  const response = await fetch(`${ESPN_BASE_URL}/scoreboard`, {
    cache: "no-store",
  });

  if (!response.ok) return new Set();

  const payload = await response.json();
  const events = payload.events ?? [];
  const teams = new Set<string>();

  for (const event of events) {
    const competitors = event.competitions?.[0]?.competitors ?? [];
    for (const competitor of competitors) {
      const abbr = competitor.team?.abbreviation;
      if (abbr) teams.add(abbr);
    }
  }

  return teams;
}

export type EspnScoreboardEvent = {
  id: string;
  name: string;
  date: string;
  status?: {
    type?: EspnGameStatusType;
  };
  competitions?: Array<{
    competitors?: EspnCompetitor[];
  }>;
};

export async function fetchScoreboardForDate(dateCode: string): Promise<EspnScoreboardEvent[]> {
  const response = await fetch(`${ESPN_BASE_URL}/scoreboard?dates=${dateCode}`, {
    cache: "no-store",
  });

  if (!response.ok) return [];

  const payload = await response.json();
  return payload.events ?? [];
}

export type EspnAthleteStat = {
  athlete: {
    id: string;
    displayName: string;
  };
  stats: string[];
};

export type EspnStatGroup = {
  name: string;
  labels: string[];
  athletes: EspnAthleteStat[];
};

export type EspnTeamBoxscore = {
  team: {
    id: string;
    displayName: string;
    abbreviation?: string;
  };
  statistics: EspnStatGroup[];
};

export type EspnGameStatusType = {
  state?: string;
  completed?: boolean;
  description?: string;
};

export type EspnCompetitor = {
  team?: {
    id?: string;
    abbreviation?: string;
  };
  score?: string;
  homeAway?: string;
};

export type EspnTeamStatistic = {
  name?: string;
  label?: string;
  displayValue?: string;
};

export type EspnSummaryTeam = {
  team?: {
    id?: string;
    abbreviation?: string;
  };
  statistics?: EspnTeamStatistic[];
};

export type EspnScoringPlay = {
  type?: {
    id?: string;
    text?: string;
    abbreviation?: string;
  };
  team?: {
    id?: string;
    abbreviation?: string;
  };
};

export type EspnGameSummary = {
  header?: {
    competitions?: Array<{
      status?: { type?: EspnGameStatusType };
      competitors?: EspnCompetitor[];
    }>;
  };
  boxscore?: {
    players?: EspnTeamBoxscore[];
    teams?: EspnSummaryTeam[];
  };
  scoringPlays?: EspnScoringPlay[];
};

export async function fetchGameSummary(eventId: string): Promise<EspnGameSummary | null> {
  const response = await fetch(`${ESPN_SUMMARY_URL}?event=${eventId}`, {
    cache: "no-store",
  });

  if (!response.ok) return null;

  return (await response.json()) as EspnGameSummary;
}

export async function fetchScoreboardForRange(
  startDateCode: string,
  endDateCode: string
): Promise<EspnScoreboardEvent[]> {
  const response = await fetch(
    `${ESPN_BASE_URL}/scoreboard?dates=${startDateCode}-${endDateCode}`,
    { cache: "no-store" }
  );

  if (!response.ok) return [];

  const payload = await response.json();
  return payload.events ?? [];
}
