const ESPN_GOLF_SCOREBOARD_URL =
  "https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard";

export type GolfTournamentStatus =
  | "scheduled"
  | "in_progress"
  | "final"
  | "unknown";

export type GolfCompetitorStatus =
  | "scheduled"
  | "active"
  | "finished"
  | "cut"
  | "withdrawn"
  | "disqualified"
  | "did_not_start";

type UnknownRecord = Record<string, unknown>;

type EspnStatusType = {
  name?: string;
  state?: string;
  completed?: boolean;
  description?: string;
  detail?: string;
  shortDetail?: string;
};

type EspnHole = {
  value?: number;
  displayValue?: string;
  period?: number;
  scoreType?: {
    displayValue?: string;
  };
};

type EspnStatistic = {
  value?: number;
  displayValue?: string;
  name?: string;
  label?: string;
  abbreviation?: string;
};

type EspnStatistics = {
  categories?: Array<{
    name?: string;
    displayName?: string;
    stats?: EspnStatistic[];
  }>;
};

type EspnRound = {
  value?: number;
  displayValue?: string;
  period?: number;
  linescores?: EspnHole[];
  statistics?: EspnStatistics;
};

type EspnCompetitor = {
  id?: string;
  uid?: string;
  order?: number;
  score?: string;
  athlete?: {
    fullName?: string;
    displayName?: string;
    shortName?: string;
    links?: Array<{
      href?: string;
      rel?: string[];
    }>;
    flag?: {
      href?: string;
      alt?: string;
    };
  };
  linescores?: EspnRound[];
  statistics?: unknown[];
};

type EspnCompetition = {
  status?: {
    period?: number;
    type?: EspnStatusType;
  };
  competitors?: EspnCompetitor[];
  broadcasts?: Array<{
    market?: string;
    names?: string[];
  }>;
};

type EspnEvent = {
  id?: string;
  name?: string;
  shortName?: string;
  date?: string;
  endDate?: string;
  status?: {
    type?: EspnStatusType;
  };
  competitions?: EspnCompetition[];
  links?: Array<{
    href?: string;
    rel?: string[];
  }>;
};

type EspnCalendarEntry = {
  id?: string;
  label?: string;
  startDate?: string;
  endDate?: string;
  event?: {
    $ref?: string;
  };
};

type EspnGolfScoreboardPayload = {
  season?: {
    year?: number;
    type?: number;
  };
  leagues?: Array<{
    calendar?: EspnCalendarEntry[];
  }>;
  events?: EspnEvent[];
};

export type GolfScheduleEvent = {
  espnEventId: string;
  name: string;
  startDate: string | null;
  endDate: string | null;
};

export type GolfHole = {
  holeNumber: number;
  strokes: number | null;
  relativeToPar: number | null;
  scoreDisplay: string | null;
};

export type GolfRound = {
  roundNumber: number;
  scoreToPar: number | null;
  scoreDisplay: string | null;
  strokes: number | null;
  holesCompleted: number;
  teeTime: string | null;
  teeTimeRaw: string | null;
  holes: GolfHole[];
};

export type GolfCompetitor = {
  espnPlayerId: string;
  displayName: string;
  shortName: string | null;
  country: string | null;
  countryFlagUrl: string | null;
  playerUrl: string | null;

  leaderboardOrder: number | null;
  officialScoreToPar: number | null;
  officialScoreDisplay: string | null;

  roundsCompleted: number;
  holesCompleted: number;
  currentRound: number | null;
  lastHole: number | null;

  status: GolfCompetitorStatus;
  teeTime: string | null;
  teeTimeRaw: string | null;

  rounds: GolfRound[];
};

export type GolfTournament = {
  espnEventId: string;
  name: string;
  startDate: string | null;
  endDate: string | null;
  status: GolfTournamentStatus;
  statusDescription: string | null;
  currentRound: number | null;
  completed: boolean;
  competitors: GolfCompetitor[];
};

function safeArray<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function parseRelativeToPar(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toUpperCase();

  if (!normalized) return null;
  if (normalized === "E") return 0;

  const parsed = Number(normalized.replace("+", ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseEspnDate(value: string | null | undefined): string | null {
  if (!value) return null;

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;

  return parsed.toISOString();
}

function findPlayerUrl(competitor: EspnCompetitor): string | null {
  const links = safeArray(competitor.athlete?.links);

  const preferred =
    links.find((link) => link.rel?.includes("playercard")) ??
    links.find((link) => link.rel?.includes("overview")) ??
    links[0];

  return preferred?.href ?? null;
}

function findRoundTeeTimeRaw(round: EspnRound): string | null {
  const categories = safeArray(round.statistics?.categories);

  for (const category of categories) {
    for (const stat of safeArray(category.stats)) {
      const name = [
        stat.name,
        stat.label,
        stat.abbreviation,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      if (
        name.includes("tee") &&
        typeof stat.displayValue === "string" &&
        stat.displayValue.trim()
      ) {
        return stat.displayValue.trim();
      }
    }
  }

  // The current ESPN golf payload includes an unnamed tee-time value as the
  // final round statistic. Preserve the raw value, but keep this fallback
  // isolated here so the rest of the app never depends on the array position.
  for (const category of categories) {
    const stats = safeArray(category.stats);
    const finalStat = stats.at(-1);

    if (
      finalStat &&
      finalStat.value === undefined &&
      typeof finalStat.displayValue === "string" &&
      finalStat.displayValue.trim()
    ) {
      return finalStat.displayValue.trim();
    }
  }

  return null;
}

function parseTeeTime(raw: string | null): string | null {
  if (!raw) return null;

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;

  return parsed.toISOString();
}

function normalizeTournamentStatus(
  status: EspnStatusType | undefined
): GolfTournamentStatus {
  const state = status?.state?.toLowerCase();
  const name = status?.name?.toUpperCase();

  if (status?.completed || state === "post" || name === "STATUS_FINAL") {
    return "final";
  }

  if (state === "in" || name === "STATUS_IN_PROGRESS") {
    return "in_progress";
  }

  if (state === "pre" || name === "STATUS_SCHEDULED") {
    return "scheduled";
  }

  return "unknown";
}

function inferCompetitorStatus(input: {
  tournamentStatus: GolfTournamentStatus;
  rounds: GolfRound[];
}): GolfCompetitorStatus {
  const completedRounds = input.rounds.filter(
    (round) => round.holesCompleted === 18
  ).length;

  const hasStarted = input.rounds.some(
    (round) => round.holesCompleted > 0 || round.strokes !== null
  );

  if (input.tournamentStatus === "scheduled") {
    return "scheduled";
  }

  if (input.tournamentStatus === "final" && completedRounds >= 4) {
    return "finished";
  }

  if (hasStarted) {
    return "active";
  }

  return "scheduled";
}

function parseRound(round: EspnRound): GolfRound | null {
  const roundNumber = Number(round.period);

  if (!Number.isInteger(roundNumber) || roundNumber < 1) {
    return null;
  }

  const holes = safeArray(round.linescores)
    .map((hole): GolfHole | null => {
      const holeNumber = Number(hole.period);

      if (
        !Number.isInteger(holeNumber) ||
        holeNumber < 1 ||
        holeNumber > 18
      ) {
        return null;
      }

      return {
        holeNumber,
        strokes:
          typeof hole.value === "number" && Number.isFinite(hole.value)
            ? hole.value
            : null,
        relativeToPar: parseRelativeToPar(
          hole.scoreType?.displayValue
        ),
        scoreDisplay: hole.displayValue ?? null,
      };
    })
    .filter((hole): hole is GolfHole => hole !== null)
    .sort((a, b) => a.holeNumber - b.holeNumber);

  const teeTimeRaw = findRoundTeeTimeRaw(round);

  return {
    roundNumber,
    scoreToPar: parseRelativeToPar(round.displayValue),
    scoreDisplay: round.displayValue ?? null,
    strokes:
      typeof round.value === "number" && Number.isFinite(round.value)
        ? round.value
        : null,
    holesCompleted: holes.length,
    teeTime: parseTeeTime(teeTimeRaw),
    teeTimeRaw,
    holes,
  };
}

function parseCompetitor(
  competitor: EspnCompetitor,
  tournamentStatus: GolfTournamentStatus
): GolfCompetitor | null {
  const espnPlayerId = String(competitor.id ?? "").trim();
  const displayName = String(
    competitor.athlete?.displayName ??
      competitor.athlete?.fullName ??
      ""
  ).trim();

  if (!espnPlayerId || !displayName) {
    return null;
  }

  const rounds = safeArray(competitor.linescores)
    .map(parseRound)
    .filter((round): round is GolfRound => round !== null)
    .sort((a, b) => a.roundNumber - b.roundNumber);

  const roundsWithActivity = rounds.filter(
    (round) => round.holesCompleted > 0 || round.strokes !== null
  );

  const currentRound =
    roundsWithActivity.length > 0
      ? Math.max(...roundsWithActivity.map((round) => round.roundNumber))
      : null;

  const currentRoundRecord =
    currentRound === null
      ? null
      : rounds.find((round) => round.roundNumber === currentRound) ?? null;

  const lastHole =
    currentRoundRecord && currentRoundRecord.holes.length > 0
      ? currentRoundRecord.holes.at(-1)?.holeNumber ?? null
      : null;

  const teeTimeRaw =
    currentRoundRecord?.teeTimeRaw ??
    rounds.find((round) => round.teeTimeRaw)?.teeTimeRaw ??
    null;

  const teeTime =
    currentRoundRecord?.teeTime ??
    rounds.find((round) => round.teeTime)?.teeTime ??
    null;

  return {
    espnPlayerId,
    displayName,
    shortName: competitor.athlete?.shortName ?? null,
    country: competitor.athlete?.flag?.alt ?? null,
    countryFlagUrl: competitor.athlete?.flag?.href ?? null,
    playerUrl: findPlayerUrl(competitor),

    leaderboardOrder:
      typeof competitor.order === "number"
        ? competitor.order
        : null,
    officialScoreToPar: parseRelativeToPar(competitor.score),
    officialScoreDisplay: competitor.score ?? null,

    roundsCompleted: rounds.filter(
      (round) => round.holesCompleted === 18
    ).length,
    holesCompleted: rounds.reduce(
      (total, round) => total + round.holesCompleted,
      0
    ),
    currentRound,
    lastHole,

    status: inferCompetitorStatus({
      tournamentStatus,
      rounds,
    }),
    teeTime,
    teeTimeRaw,

    rounds,
  };
}

function parseTournament(event: EspnEvent): GolfTournament | null {
  const espnEventId = String(event.id ?? "").trim();
  const name = String(event.name ?? event.shortName ?? "").trim();

  if (!espnEventId || !name) {
    return null;
  }

  const competition = event.competitions?.[0];
  const eventStatus = event.status?.type;
  const competitionStatus = competition?.status?.type;
  const statusSource = competitionStatus ?? eventStatus;

  const status = normalizeTournamentStatus(statusSource);

  const competitors = safeArray(competition?.competitors)
    .map((competitor) => parseCompetitor(competitor, status))
    .filter(
      (competitor): competitor is GolfCompetitor =>
        competitor !== null
    )
    .sort((a, b) => {
      const aOrder = a.leaderboardOrder ?? Number.MAX_SAFE_INTEGER;
      const bOrder = b.leaderboardOrder ?? Number.MAX_SAFE_INTEGER;

      if (aOrder !== bOrder) return aOrder - bOrder;
      return a.displayName.localeCompare(b.displayName);
    });

  return {
    espnEventId,
    name,
    startDate: parseEspnDate(event.date),
    endDate: parseEspnDate(event.endDate),
    status,
    statusDescription:
      competitionStatus?.detail ??
      competitionStatus?.shortDetail ??
      competitionStatus?.description ??
      eventStatus?.description ??
      null,
    currentRound:
      typeof competition?.status?.period === "number"
        ? competition.status.period
        : null,
    completed: Boolean(statusSource?.completed),
    competitors,
  };
}

async function fetchGolfPayload(
  dates?: string
): Promise<EspnGolfScoreboardPayload> {
  const url = dates
    ? `${ESPN_GOLF_SCOREBOARD_URL}?dates=${encodeURIComponent(dates)}`
    : ESPN_GOLF_SCOREBOARD_URL;

  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "User-Agent": "111-sports-golf-provider/1.0",
    },
  });

  if (!response.ok) {
    throw new Error(
      `ESPN golf request failed with ${response.status} ${response.statusText}`
    );
  }

  const payload: unknown = await response.json();

  if (!isRecord(payload)) {
    throw new Error("ESPN golf returned an invalid payload.");
  }

  return payload as EspnGolfScoreboardPayload;
}

export async function fetchGolfTournaments(
  dates?: string
): Promise<GolfTournament[]> {
  const payload = await fetchGolfPayload(dates);

  return safeArray(payload.events)
    .map(parseTournament)
    .filter(
      (tournament): tournament is GolfTournament =>
        tournament !== null
    );
}

export async function fetchGolfTournamentByEventId(
  espnEventId: string,
  dates?: string
): Promise<GolfTournament | null> {
  const normalizedEventId = espnEventId.trim();

  if (!normalizedEventId) {
    return null;
  }

  const tournaments = await fetchGolfTournaments(dates);

  return (
    tournaments.find(
      (tournament) =>
        tournament.espnEventId === normalizedEventId
    ) ?? null
  );
}

export async function fetchGolfSchedule(
  dates?: string
): Promise<GolfScheduleEvent[]> {
  const payload = await fetchGolfPayload(dates);
  const calendar = safeArray(payload.leagues?.[0]?.calendar);

  const schedule = calendar
    .map((entry): GolfScheduleEvent | null => {
      const espnEventId = String(entry.id ?? "").trim();
      const name = String(entry.label ?? "").trim();

      if (!espnEventId || !name) {
        return null;
      }

      return {
        espnEventId,
        name,
        startDate: parseEspnDate(entry.startDate),
        endDate: parseEspnDate(entry.endDate),
      };
    })
    .filter(
      (event): event is GolfScheduleEvent =>
        event !== null
    );

  return Array.from(
    new Map(
      schedule.map((event) => [event.espnEventId, event])
    ).values()
  ).sort((a, b) => {
    const aDate = a.startDate ?? "";
    const bDate = b.startDate ?? "";

    return aDate.localeCompare(bDate);
  });
}
