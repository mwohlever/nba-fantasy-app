import { possessionTeamId } from "@/lib/live-scores/possession";
import { normalizeBroadcast } from "@/lib/live-scores/metadata";
import { selectFootballOdds as selectNcaaOdds } from "@/lib/live-scores/odds";
import {
  normalizeNcaaEspnTeamDirectory,
  type NcaaEspnDirectoryTeam,
} from "@/lib/providers/ncaaTeams";
export { selectFootballOdds as selectNcaaOdds } from "@/lib/live-scores/odds";
export {
  normalizeNcaaEspnTeamDirectory,
  type NcaaEspnDirectoryTeam,
} from "@/lib/providers/ncaaTeams";
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
  possessionTeamId?: string | null;
  broadcast?: import("@/lib/live-scores/metadata").Broadcast | null;
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

/**
 * Broad FBS directory for server-side admin tooling. This preserves the same
 * ESPN IDs/name/abbreviation/logo semantics used by NCAA Pick'em scoreboards.
 */
export async function fetchNcaaEspnTeamDirectory(): Promise<NcaaEspnDirectoryTeam[]> {
  const params = new URLSearchParams({ groups: "80", limit: "500" });
  const response = await fetch(`${ESPN_CFB_BASE}/teams?${params.toString()}`, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`ESPN NCAA team directory failed: ${response.status}`);
  }

  return normalizeNcaaEspnTeamDirectory(await response.json());
}

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
  if (value === null || value === undefined || value === "") return null;
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


/**
 * Normalizes one ESPN college-football scoreboard event into the shared
 * score/Game Center shape. Canonical identities deliberately come from
 * `event.id` and `competitor.team.id`, never matchup text or competitor.id.
 */
export function normalizeNcaaEspnEvent(
  event: any,
  ranksByTeamId: Map<string, number> = new Map(),
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
    broadcast: normalizeBroadcast(competition),
    possessionTeamId: possessionTeamId(competition),

    odds:
      selectNcaaOdds(
        competition?.odds,
        { away: awayTeam.id, home: homeTeam.id },
      ),
  };
}

/**
 * Normalizes all valid events in an ESPN college-football scoreboard payload.
 * Callers may supply rankings when their scoreboard policy has a matching
 * week-specific ranking source; postseason consumers intentionally omit them.
 */
export function normalizeNcaaEspnScoreboardEvents(
  payload: any,
  ranksByTeamId: Map<string, number> = new Map(),
): NcaaEspnGame[] {
  const events =
    Array.isArray(payload?.events)
      ? payload.events
      : [];

  const games: NcaaEspnGame[] = [];

  for (const event of events) {
    const game = normalizeNcaaEspnEvent(event, ranksByTeamId);

    if (game) games.push(game);
  }

  return games.sort(
    (a, b) =>
      new Date(a.kickoffAt).getTime() -
      new Date(b.kickoffAt).getTime(),
  );
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

/**
 * Fetches the complete FBS postseason scoreboard for a season, including CFP
 * and other bowl games. ESPN's postseason feed does not provide a stable CFP-
 * only selector, so callers must bind authoritative `espnEventId` values
 * rather than infer CFP membership from event names.
 *
 * Rankings are intentionally omitted: unlike NCAA Pick'em's regular-season
 * week policy, this query has no matching AP-poll week to join.
 */
export async function fetchNcaaPostseasonEvents({
  season,
}: {
  season: number;
}): Promise<NcaaEspnGame[]> {
  const params =
    new URLSearchParams({
      dates: String(season),
      seasontype: "3",
      limit: "500",
      groups: "80",
    });

  const response = await fetch(
    `${ESPN_CFB_BASE}/scoreboard?${params.toString()}`,
    {
      cache: "no-store",
      headers: { Accept: "application/json" },
    },
  );

  if (!response.ok) {
    throw new Error(
      `ESPN NCAA postseason scoreboard failed: ${response.status}`,
    );
  }

  return normalizeNcaaEspnScoreboardEvents(await response.json());
}

/** Bracket competitions use their own ESPN sport feed; event binding still decides eligibility. */
export async function fetchBracketPostseasonEvents(input: {
  season: number;
  sportKey: string;
  formatKey: string;
}): Promise<NcaaEspnGame[]> {
  if (input.sportKey === "college_football" && input.formatKey === "cfp")
    return fetchNcaaPostseasonEvents({ season: input.season });
  const league = input.sportKey === "mens_college_basketball" && input.formatKey === "ncaa_mens"
    ? "mens-college-basketball"
    : input.sportKey === "womens_college_basketball" && input.formatKey === "ncaa_womens"
      ? "womens-college-basketball" : null;
  if (!league) throw new Error("Unsupported Bracket Challenge provider competition.");
  const params = new URLSearchParams({ dates: String(input.season), seasontype: "3", groups: "50", limit: "500" });
  const response = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/${league}/scoreboard?${params}`, {
    cache: "no-store", headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`ESPN basketball postseason scoreboard failed: ${response.status}`);
  return normalizeNcaaEspnScoreboardEvents(await response.json());
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
    normalizeNcaaEspnScoreboardEvents(
      payload,
      rankingResult.ranksByTeamId,
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
