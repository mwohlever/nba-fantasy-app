const ESPN_CFB_BASE =
  "https://site.api.espn.com/apis/site/v2/sports/football/college-football";

export type NcaaEspnTeam = {
  id: string;
  displayName: string;
  abbreviation: string | null;
  logo: string | null;
  rank: number | null;
  record: string | null;
  conferenceId: string | null;
  score: number | null;
  winner: boolean;
};

export type NcaaEspnOdds = {
  favoriteTeamId: string | null;
  spread: number | null;
  overUnder: number | null;
  provider: string | null;
};

export type NcaaEspnGame = {
  espnEventId: string;
  name: string;
  shortName: string | null;
  kickoffAt: string;

  awayTeam: NcaaEspnTeam;
  homeTeam: NcaaEspnTeam;

  status: string;
  statusDetail: string | null;
  completed: boolean;

  winnerTeamId: string | null;
  odds: NcaaEspnOdds | null;
};

export type NcaaEspnWeek = {
  season: number;
  week: number;
  label: string;

  scheduleGames: NcaaEspnGame[];
  eligibleGames: NcaaEspnGame[];

  diagnostics: {
    totalEvents: number;
    mappedEvents: number;
    rankedVsRankedEvents: number;
    rankedTeamGames: number;
    rankingPoll: string | null;
    rankingPollType: string | null;
    rankedTeams: number;
  };
};

type RankingResult = {
  ranksByTeamId: Map<string, number>;
  pollName: string | null;
  pollType: string | null;
};

type RankingGroup = {
  type?: unknown;
  name?: unknown;
  shortName?: unknown;
  ranks?: unknown;
};

export function selectNcaaApRankingGroup(
  rankingGroups: unknown,
): RankingGroup | null {
  if (!Array.isArray(rankingGroups)) return null;

  return (
    rankingGroups.find(
      (group: RankingGroup) => String(group?.type ?? "").toLowerCase() === "ap",
    ) ?? null
  );
}

function finiteInteger(
  value: unknown,
): number | null {
  const number = Number(value);

  return Number.isInteger(number)
    ? number
    : null;
}

function positiveRank(
  value: unknown,
): number | null {
  const rank = finiteInteger(value);

  return rank !== null &&
    rank >= 1 &&
    rank <= 25
    ? rank
    : null;
}

function scoreValue(
  value: unknown,
): number | null {
  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : null;
}

function competitorRecord(
  competitor: any,
): string | null {
  const records =
    Array.isArray(competitor?.records)
      ? competitor.records
      : [];

  const preferred =
    records.find(
      (record: any) =>
        record?.type === "total",
    ) ??
    records[0];

  return typeof preferred?.summary === "string"
    ? preferred.summary
    : null;
}

function competitorLogo(
  competitor: any,
): string | null {
  const logos =
    Array.isArray(competitor?.team?.logos)
      ? competitor.team.logos
      : [];

  return typeof logos[0]?.href === "string"
    ? logos[0].href
    : null;
}

function mapTeam(
  competitor: any,
  ranksByTeamId: Map<string, number>,
): NcaaEspnTeam | null {
  const id =
    competitor?.team?.id != null
      ? String(competitor.team.id)
      : null;

  const displayName =
    typeof competitor?.team?.displayName ===
    "string"
      ? competitor.team.displayName
      : null;

  if (!id || !displayName) {
    return null;
  }

  return {
    id,
    displayName,

    abbreviation:
      typeof competitor?.team?.abbreviation ===
      "string"
        ? competitor.team.abbreviation
        : null,

    logo:
      competitorLogo(competitor),

    /*
     * Do not trust scoreboard curatedRank during the
     * 2026 preseason. ESPN currently returns 99 there.
     *
     * Rankings are joined from ESPN's rankings feed by
     * ESPN team ID instead.
     */
    rank:
      ranksByTeamId.get(id) ??
      null,

    record:
      competitorRecord(competitor),

    conferenceId:
      competitor?.team?.conferenceId != null
        ? String(competitor.team.conferenceId)
        : null,

    score:
      scoreValue(competitor?.score),

    winner:
      competitor?.winner === true,
  };
}

function finiteOddsNumber(
  value: unknown,
): number | null {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed)
    ? parsed
    : null;
}

export function selectNcaaOdds(
  oddsInput: unknown,
): NcaaEspnOdds | null {
  if (!Array.isArray(oddsInput)) {
    return null;
  }

  const odds = oddsInput.find(
    (entry: any) =>
      entry &&
      (
        finiteOddsNumber(entry.spread) !== null ||
        finiteOddsNumber(entry.overUnder) !== null
      ),
  ) as any;

  if (!odds) {
    return null;
  }

  const favoriteTeamId =
    odds?.awayTeamOdds?.favorite === true &&
    odds?.awayTeamOdds?.team?.id != null
      ? String(odds.awayTeamOdds.team.id)
      : odds?.homeTeamOdds?.favorite === true &&
          odds?.homeTeamOdds?.team?.id != null
        ? String(odds.homeTeamOdds.team.id)
        : null;

  const rawSpread =
    finiteOddsNumber(odds.spread);

  const spread =
    rawSpread !== null && favoriteTeamId
      ? -Math.abs(rawSpread)
      : rawSpread;

  const overUnder =
    finiteOddsNumber(odds.overUnder);

  const provider =
    typeof odds?.provider?.name === "string"
      ? odds.provider.name
      : null;

  return {
    favoriteTeamId,
    spread,
    overUnder,
    provider,
  };
}

function mapEvent(
  event: any,
  ranksByTeamId: Map<string, number>,
): NcaaEspnGame | null {
  const competition =
    event?.competitions?.[0];

  if (!competition) {
    return null;
  }

  const competitors =
    Array.isArray(competition.competitors)
      ? competition.competitors
      : [];

  const awayRaw =
    competitors.find(
      (competitor: any) =>
        competitor?.homeAway === "away",
    );

  const homeRaw =
    competitors.find(
      (competitor: any) =>
        competitor?.homeAway === "home",
    );

  const awayTeam =
    mapTeam(
      awayRaw,
      ranksByTeamId,
    );

  const homeTeam =
    mapTeam(
      homeRaw,
      ranksByTeamId,
    );

  if (!awayTeam || !homeTeam) {
    return null;
  }

  const espnEventId =
    event?.id != null
      ? String(event.id)
      : null;

  const kickoffAt =
    typeof event?.date === "string"
      ? event.date
      : typeof competition?.date === "string"
        ? competition.date
        : null;

  if (!espnEventId || !kickoffAt) {
    return null;
  }

  const statusType =
    competition?.status?.type ??
    event?.status?.type ??
    {};

  const status =
    typeof statusType?.state === "string"
      ? statusType.state
      : statusType?.completed === true
        ? "post"
        : "pre";

  const statusDetail =
    typeof competition?.status?.type?.detail ===
    "string"
      ? competition.status.type.detail
      : typeof competition?.status?.type?.shortDetail ===
          "string"
        ? competition.status.type.shortDetail
        : typeof event?.status?.type?.detail ===
            "string"
          ? event.status.type.detail
          : null;

  const winnerTeamId =
    awayTeam.winner
      ? awayTeam.id
      : homeTeam.winner
        ? homeTeam.id
        : null;

  return {
    espnEventId,

    name:
      typeof event?.name === "string"
        ? event.name
        : `${awayTeam.displayName} at ${homeTeam.displayName}`,

    shortName:
      typeof event?.shortName === "string"
        ? event.shortName
        : null,

    kickoffAt,

    awayTeam,
    homeTeam,

    status,
    statusDetail,

    completed:
      statusType?.completed === true,

    winnerTeamId,

    odds:
      selectNcaaOdds(
        competition?.odds,
      ),
  };
}

function isRankedVsRanked(
  game: NcaaEspnGame,
) {
  return (
    game.awayTeam.rank !== null &&
    game.homeTeam.rank !== null
  );
}

function hasRankedTeam(
  game: NcaaEspnGame,
) {
  return (
    game.awayTeam.rank !== null ||
    game.homeTeam.rank !== null
  );
}

async function fetchRankings(
  season: number,
  week: number,
): Promise<RankingResult> {
  const params =
    new URLSearchParams({
      season: String(season),
      week: String(week),
    });

  const response =
    await fetch(
      `${ESPN_CFB_BASE}/rankings?${params.toString()}`,
      {
        cache: "no-store",

        headers: {
          Accept: "application/json",
        },
      },
    );

  if (!response.ok) {
    throw new Error(
      `ESPN NCAA rankings failed: ${response.status}`,
    );
  }

  const payload =
    await response.json();

  const rankingGroups =
    Array.isArray(payload?.rankings)
      ? payload.rankings
      : [];

  const poll = selectNcaaApRankingGroup(rankingGroups);

  if (!poll) {
    throw new Error(
      "ESPN NCAA rankings did not include the AP Top 25 poll.",
    );
  }

  const ranks =
    Array.isArray(poll?.ranks)
      ? poll.ranks
      : [];

  const ranksByTeamId =
    new Map<string, number>();

  for (const entry of ranks) {
    const teamId =
      entry?.team?.id != null
        ? String(entry.team.id)
        : null;

    const rank =
      positiveRank(
        entry?.current,
      );

    if (
      teamId &&
      rank !== null
    ) {
      ranksByTeamId.set(
        teamId,
        rank,
      );
    }
  }

  return {
    ranksByTeamId,

    pollName:
      typeof poll?.name === "string"
        ? poll.name
        : typeof poll?.shortName === "string"
          ? poll.shortName
          : null,

    pollType:
      typeof poll?.type === "string"
        ? poll.type
        : null,
  };
}

export async function fetchNcaaPickEmWeek({
  season,
  week,
}: {
  season: number;
  week: number;
}): Promise<NcaaEspnWeek> {
  const params =
    new URLSearchParams({
      dates: String(season),
      seasontype: "2",
      week: String(week),
      limit: "200",
      groups: "80",
    });

  const [
    scoreboardResponse,
    rankingResult,
  ] =
    await Promise.all([
      fetch(
        `${ESPN_CFB_BASE}/scoreboard?${params.toString()}`,
        {
          cache: "no-store",

          headers: {
            Accept: "application/json",
          },
        },
      ),

      fetchRankings(
        season,
        week,
      ),
    ]);

  if (!scoreboardResponse.ok) {
    throw new Error(
      `ESPN NCAA scoreboard failed: ${scoreboardResponse.status}`,
    );
  }

  const payload =
    await scoreboardResponse.json();

  const events =
    Array.isArray(payload?.events)
      ? payload.events
      : [];

  const scheduleGames =
    (
      events.map(
        (event: any) =>
          mapEvent(
            event,
            rankingResult.ranksByTeamId,
          ),
      ) as Array<
        NcaaEspnGame | null
      >
    )
      .filter(
        (
          game: NcaaEspnGame | null,
        ): game is NcaaEspnGame =>
          Boolean(game),
      )
      .sort(
        (a, b) =>
          new Date(
            a.kickoffAt,
          ).getTime() -
          new Date(
            b.kickoffAt,
          ).getTime(),
      );

  const eligibleGames =
    scheduleGames.filter(
      isRankedVsRanked,
    );

  const rankedTeamGames =
    scheduleGames.filter(
      hasRankedTeam,
    );

  return {
    season,
    week,
    label: `Week ${week}`,

    scheduleGames,
    eligibleGames,

    diagnostics: {
      totalEvents:
        events.length,

      mappedEvents:
        scheduleGames.length,

      rankedVsRankedEvents:
        eligibleGames.length,

      rankedTeamGames:
        rankedTeamGames.length,

      rankingPoll:
        rankingResult.pollName,

      rankingPollType:
        rankingResult.pollType,

      rankedTeams:
        rankingResult
          .ranksByTeamId.size,
    },
  };
}
