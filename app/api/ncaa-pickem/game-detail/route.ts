import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { getNcaaPickEmAccess } from "@/lib/ncaaPickEm/access";

const ESPN_CFB_BASE =
  "https://site.api.espn.com/apis/site/v2/sports/football/college-football";

const ESPN_CFB_CORE_BASE =
  "https://sports.core.api.espn.com/v2/sports/football/leagues/college-football";

type PreviewStat = {
  value: string;
  rank?: number;
  rankDisplayValue?: string;
};

type PreviewTeam = {
  teamId: string;
  offense: {
    scoring?: PreviewStat;
    total?: PreviewStat;
    passing?: PreviewStat;
    rushing?: PreviewStat;
  };
  defense: {
    scoring?: PreviewStat;
    total?: PreviewStat;
    passing?: PreviewStat;
    rushing?: PreviewStat;
  };
};

function statFromFlatStats(
  stats: unknown,
  name: string,
): PreviewStat | undefined {
  if (!Array.isArray(stats)) return undefined;

  const stat = stats.find(
    (candidate) =>
      candidate &&
      typeof candidate === "object" &&
      (candidate as { name?: string }).name === name,
  ) as
    | {
        displayValue?: string;
        value?: number;
      }
    | undefined;

  if (!stat) return undefined;

  const value =
    stat.displayValue ??
    (typeof stat.value === "number" ? String(stat.value) : undefined);

  return value == null ? undefined : { value };
}

function statFromCategories(
  categories: unknown,
  name: string,
  includeRank = false,
): PreviewStat | undefined {
  if (!Array.isArray(categories)) return undefined;

  for (const category of categories) {
    if (!category || typeof category !== "object") continue;

    const stats = (category as { stats?: unknown }).stats;
    if (!Array.isArray(stats)) continue;

    for (const stat of stats) {
      if (!stat || typeof stat !== "object") continue;

      const candidate = stat as {
        name?: string;
        displayValue?: string;
        value?: number;
        rank?: number;
        rankDisplayValue?: string;
      };

      if (candidate.name !== name) continue;

      const value =
        candidate.displayValue ??
        (typeof candidate.value === "number"
          ? String(candidate.value)
          : undefined);

      if (value == null) return undefined;

      return {
        value,
        ...(includeRank && typeof candidate.rank === "number"
          ? { rank: candidate.rank }
          : {}),
        ...(includeRank && candidate.rankDisplayValue
          ? { rankDisplayValue: candidate.rankDisplayValue }
          : {}),
      };
    }
  }

  return undefined;
}

async function loadPreviewTeam(
  teamId: string,
  seasonYear: number,
  seasonType: number,
): Promise<PreviewTeam | null> {
  const coreUrl =
    `${ESPN_CFB_CORE_BASE}/seasons/${seasonYear}/types/${seasonType}` +
    `/teams/${teamId}/statistics`;

  const siteUrl =
    `${ESPN_CFB_BASE}/teams/${teamId}/statistics?season=${seasonYear}`;

  try {
    const [coreResponse, siteResponse] = await Promise.all([
      fetch(coreUrl, {
        cache: "no-store",
        headers: { Accept: "application/json" },
      }),
      fetch(siteUrl, {
        cache: "no-store",
        headers: { Accept: "application/json" },
      }),
    ]);

    const core = coreResponse.ok ? await coreResponse.json() : null;
    const site = siteResponse.ok ? await siteResponse.json() : null;

    const coreCategories = core?.splits?.categories;

    const hasSeasonResults = Boolean(
      site?.results?.stats &&
        Object.keys(site.results.stats).length > 0,
    );

    const opponentStats = site?.results?.opponent?.["0"]?.stats;

    return {
      teamId,
      offense: hasSeasonResults
        ? {
            scoring: statFromCategories(
              coreCategories,
              "totalPointsPerGame",
              true,
            ),
            total: statFromCategories(coreCategories, "yardsPerGame", true),
            passing: statFromCategories(
              coreCategories,
              "passingYardsPerGame",
              true,
            ),
            rushing: statFromCategories(
              coreCategories,
              "rushingYardsPerGame",
              true,
            ),
          }
        : {},
      defense: {
        scoring: statFromFlatStats(
          opponentStats,
          "totalPointsPerGame",
        ),
      },
    };
  } catch (error) {
    console.warn(`Failed to load NCAA preview stats for team ${teamId}`, error);
    return null;
  }
}

type SeasonPlayerStat = {
  athlete: {
    id: string;
    displayName: string;
    shortName?: string;
    position?: string;
  };
  categories: Array<{
    name: string;
    displayName: string;
    labels: string[];
    stats: string[];
  }>;
};

type SeasonPlayerTeam = {
  teamId: string;
  players: SeasonPlayerStat[];
};

const PLAYER_STATS_BASE =
  "https://site.web.api.espn.com/apis/common/v3/sports/football/college-football/athletes";

const PLAYER_CATEGORY_ORDER = [
  "passing",
  "rushing",
  "receiving",
  "defensive",
  "kicking",
  "punting",
  "returning",
];

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await mapper(items[index]);
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(limit, items.length) },
      () => worker(),
    ),
  );

  return results;
}

async function loadSeasonPlayerStats(
  teamId: string,
  seasonYear: number,
): Promise<SeasonPlayerTeam | null> {
  try {
    const rosterResponse = await fetch(
      `${ESPN_CFB_BASE}/teams/${teamId}/roster?season=${seasonYear}`,
      {
        cache: "no-store",
        headers: { Accept: "application/json" },
      },
    );

    if (!rosterResponse.ok) return null;

    const roster = await rosterResponse.json();

    type RosterPlayer = {
      id: string;
      displayName: string;
      shortName?: string;
      position?: string;
    };

    const rosterPlayers: RosterPlayer[] = (
      Array.isArray(roster?.athletes) ? roster.athletes : []
    ).flatMap(
      (group: {
        items?: Array<{
          id?: string;
          displayName?: string;
          shortName?: string;
          position?: { abbreviation?: string };
        }>;
      }): RosterPlayer[] =>
        Array.isArray(group?.items)
          ? group.items
              .filter(
                (
                  player,
                ): player is {
                  id: string;
                  displayName: string;
                  shortName?: string;
                  position?: { abbreviation?: string };
                } =>
                  typeof player?.id === "string" &&
                  typeof player?.displayName === "string",
              )
              .map((player) => ({
                id: player.id,
                displayName: player.displayName,
                shortName: player.shortName,
                position: player.position?.abbreviation,
              }))
          : [],
    );

    const uniquePlayers = Array.from(
      new Map(rosterPlayers.map((player) => [player.id, player])).values(),
    );

    const playerStats = await mapWithConcurrency(
      uniquePlayers,
      8,
      async (player): Promise<SeasonPlayerStat | null> => {
        try {
          const response = await fetch(
            `${PLAYER_STATS_BASE}/${player.id}/stats?season=${seasonYear}`,
            {
              cache: "no-store",
              headers: { Accept: "application/json" },
            },
          );

          if (!response.ok) return null;

          const payload = await response.json();

          const categories = (
            Array.isArray(payload?.categories) ? payload.categories : []
          )
            .map(
              (category: {
                name?: string;
                displayName?: string;
                labels?: string[];
                statistics?: Array<{
                  teamId?: string;
                  season?: {
                    year?: number;
                    displayName?: string;
                  };
                  stats?: Array<string | number>;
                }>;
              }) => {
                const name = String(category?.name || "");
                if (!PLAYER_CATEGORY_ORDER.includes(name)) return null;

                const currentTeamStat = (
                  Array.isArray(category?.statistics)
                    ? category.statistics
                    : []
                ).find(
                  (stat) =>
                    String(stat?.teamId || "") === teamId &&
                    Number(stat?.season?.year) === seasonYear,
                );

                if (!currentTeamStat || !Array.isArray(currentTeamStat.stats)) {
                  return null;
                }

                return {
                  name,
                  displayName: String(category?.displayName || name),
                  labels: Array.isArray(category?.labels)
                    ? category.labels.map(String)
                    : [],
                  stats: currentTeamStat.stats.map(String),
                };
              },
            )
            .filter(Boolean) as Array<{
              name: string;
              displayName: string;
              labels: string[];
              stats: string[];
            }>;

          if (!categories.length) return null;

          return {
            athlete: player,
            categories,
          };
        } catch {
          return null;
        }
      },
    );

    const players = playerStats.filter(
      (player): player is SeasonPlayerStat => Boolean(player),
    );

    return {
      teamId,
      players,
    };
  } catch (error) {
    console.warn(
      `Failed to load NCAA season player stats for team ${teamId}`,
      error,
    );
    return null;
  }
}

function eventId(value: string | null) {
  return value && /^\d+$/.test(value) ? value : null;
}

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        { error: "Login required." },
        { status: 401 },
      );
    }

    const access = await getNcaaPickEmAccess(user);

    if (!access) {
      return NextResponse.json(
        { error: "NCAA Pick 'Em is not enabled for this Group." },
        { status: 404 },
      );
    }

    const params = new URL(request.url).searchParams;
    const id = eventId(params.get("eventId"));

    if (!id) {
      return NextResponse.json(
        { error: "A valid ESPN event ID is required." },
        { status: 400 },
      );
    }

    const response = await fetch(
      `${ESPN_CFB_BASE}/summary?event=${id}`,
      {
        cache: "no-store",
        headers: {
          Accept: "application/json",
        },
      },
    );

    if (!response.ok) {
      throw new Error(
        `ESPN NCAA game summary failed: ${response.status}`,
      );
    }

    const summary = await response.json();

    const competition = summary?.header?.competitions?.[0];
    const competitors = Array.isArray(competition?.competitors)
      ? competition.competitors
      : [];

    const awayTeamId = competitors.find(
      (team: { homeAway?: string }) => team.homeAway === "away",
    )?.id;

    const homeTeamId = competitors.find(
      (team: { homeAway?: string }) => team.homeAway === "home",
    )?.id;

    const seasonYear =
      Number(summary?.header?.season?.year) ||
      Number(competition?.season?.year) ||
      new Date().getFullYear();

    const seasonType =
      Number(summary?.header?.season?.type) ||
      Number(competition?.season?.type) ||
      2;

    const isPregame = competition?.status?.type?.state === "pre";

    let matchupPreview:
      | {
          seasonYear: number;
          away: PreviewTeam | null;
          home: PreviewTeam | null;
        }
      | null = null;

    let seasonPlayerStats:
      | {
          away: SeasonPlayerTeam | null;
          home: SeasonPlayerTeam | null;
        }
      | null = null;

    if (isPregame && awayTeamId && homeTeamId) {
      const [
        awayPreview,
        homePreview,
        awayPlayerStats,
        homePlayerStats,
      ] = await Promise.all([
        loadPreviewTeam(String(awayTeamId), seasonYear, seasonType),
        loadPreviewTeam(String(homeTeamId), seasonYear, seasonType),
        loadSeasonPlayerStats(String(awayTeamId), seasonYear),
        loadSeasonPlayerStats(String(homeTeamId), seasonYear),
      ]);

      matchupPreview = {
        seasonYear,
        away: awayPreview,
        home: homePreview,
      };

      seasonPlayerStats = {
        away: awayPlayerStats,
        home: homePlayerStats,
      };
    }

    return NextResponse.json({
      success: true,
      eventId: id,
      header: summary?.header ?? null,
      matchupPreview,
      seasonPlayerStats,
      drives: summary?.drives ?? null,
      scoringPlays: Array.isArray(summary?.scoringPlays)
        ? summary.scoringPlays
        : [],
      boxscore: summary?.boxscore ?? null,
      leaders: Array.isArray(summary?.leaders)
        ? summary.leaders
        : [],
      gameInfo: summary?.gameInfo ?? null,
      predictor: summary?.predictor ?? null,
      lastFiveGames: Array.isArray(summary?.lastFiveGames)
        ? summary.lastFiveGames
        : [],
    });
  } catch (error) {
    console.error("Failed to load NCAA game detail", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to load NCAA game detail.",
      },
      { status: 500 },
    );
  }
}
