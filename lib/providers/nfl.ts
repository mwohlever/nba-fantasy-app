export const ESPN_BASE_URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";
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
    status?: { type?: EspnGameStatusType };
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
  name?: string;
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

/** The scoring worker needs a fail-closed acquisition path; legacy callers retain their fallback. */
export async function fetchNflScoringSchedule(startDateCode: string, endDateCode: string): Promise<EspnScoreboardEvent[]> {
  let response: Response;
  try {
    response = await fetch(`${ESPN_BASE_URL}/scoreboard?dates=${startDateCode}-${endDateCode}`, {
      cache: "no-store", signal: AbortSignal.timeout(12_000),
    });
  } catch { throw new Error("NFL scoreboard request failed"); }
  if (!response.ok) throw new Error(`NFL scoreboard HTTP ${response.status}`);
  let payload: unknown;
  try { payload = await response.json(); }
  catch { throw new Error("NFL scoreboard malformed JSON"); }
  if (!payload || typeof payload !== "object" || !Array.isArray((payload as { events?: unknown }).events))
    throw new Error("NFL scoreboard incomplete");
  const events = (payload as { events: EspnScoreboardEvent[] }).events;
  if (events.some(event => !event || !event.id || !Number.isFinite(Date.parse(event.date)) ||
      !Array.isArray(event.competitions?.[0]?.competitors) ||
      event.competitions![0].competitors!.length !== 2 ||
      event.competitions![0].competitors!.some(c => !c.team?.id || !c.team.abbreviation) ||
      !(event.competitions?.[0]?.status?.type ?? event.status?.type)))
    throw new Error("NFL scoreboard incomplete");
  return events;
}

export async function fetchNflScoringSummary(eventId: string): Promise<EspnGameSummary> {
  let response: Response;
  try {
    response = await fetch(`${ESPN_SUMMARY_URL}?event=${encodeURIComponent(eventId)}`, {
      cache: "no-store", signal: AbortSignal.timeout(12_000),
    });
  } catch { throw new Error("NFL game summary request failed"); }
  if (!response.ok) throw new Error(`NFL game summary HTTP ${response.status}`);
  let payload: unknown;
  try { payload = await response.json(); }
  catch { throw new Error("NFL game summary malformed JSON"); }
  if (!payload || typeof payload !== "object" || !Array.isArray((payload as EspnGameSummary).header?.competitions) ||
      !(payload as EspnGameSummary).header?.competitions?.[0]?.status?.type)
    throw new Error("NFL game summary incomplete");
  return payload as EspnGameSummary;
}

/** Bounded, payload-free diagnostics suitable for durable worker state. */
export function nflProviderFailureCode(error: unknown): string | null {
  const message = error instanceof Error ? error.message : "";
  const source = message.startsWith("NFL scoreboard ") ? "scoreboard" :
    message.startsWith("NFL game summary ") ? "summary" : null;
  if (!source) return null;
  const status = message.match(/ HTTP (\d{3})$/)?.[1];
  if (status) return `provider_request_failed:${source}:http_${status}`;
  if (message.endsWith("request failed")) return `provider_request_failed:${source}:network_or_timeout`;
  if (message.endsWith("malformed JSON")) return `provider_response_malformed:${source}:json`;
  if (message.endsWith("incomplete") || message.endsWith("boxscore incomplete"))
    return `provider_response_malformed:${source}:structure`;
  return null;
}
