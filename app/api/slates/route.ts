import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function isoDateFromGameCode(gameCode: string | null | undefined) {
  const raw = String(gameCode ?? "").slice(0, 8);
  if (!/^\d{8}$/.test(raw)) return null;
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
}

async function autoAttachNbaGamesToSlate(slateId: number) {
  try {
    const response = await fetch(
      "https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json",
      { cache: "no-store" }
    );

    if (!response.ok) return;

    const payload = await response.json();
    const games = payload?.scoreboard?.games ?? [];

    const rows = games
      .filter((game: any) => game?.gameId)
      .map((game: any) => ({
        slate_id: slateId,
        game_date: isoDateFromGameCode(game.gameCode),
        game_id: String(game.gameId),
        game_code: game.gameCode ?? null,
        note: `${game.awayTeam?.teamTricode ?? ""} at ${game.homeTeam?.teamTricode ?? ""}`.trim(),
      }));

    if (rows.length === 0) return;

    await supabaseAdmin
      .from("slate_nba_games")
      .upsert(rows, { onConflict: "slate_id,game_id" });
  } catch (error) {
    console.error("Auto attach NBA games failed:", error);
  }
}


function normalizeNbaTeamCode(value: string | null | undefined) {
  const code = String(value ?? "").trim().toUpperCase();
  if (code === "NY") return "NYK";
  return code;
}



type TeamRow = { id: number; name: string };

type TeamSlateResultRow = {
  team_id: number;
  fantasy_points: number | null;
  finish_position: number | null;
};

type TeamConfigInput = {
  team_id: number;
  draft_order: number;
  is_participating: boolean;
};

type ScoreboardV3Team = {
  teamTricode?: string;
  tricode?: string;
  teamCode?: string;
};

type ScoreboardV3Game = {
  homeTeam?: ScoreboardV3Team;
  awayTeam?: ScoreboardV3Team;
  gameTimeUTC?: string;
};

type ScoreboardV3Payload = {
  scoreboard?: { games?: ScoreboardV3Game[] };
  games?: ScoreboardV3Game[];
};

type EspnCompetition = {
  date?: string;
  competitors?: Array<{
    team?: {
      abbreviation?: string;
    };
  }>;
};

type EspnEvent = {
  date?: string;
  competitions?: EspnCompetition[];
};

type EspnScoreboardPayload = {
  events?: EspnEvent[];
};

const MANUAL_TEAM_CODE_FALLBACKS: Record<string, string[]> = {
  "2026-04-24": ["LAL", "HOU", "BOS", "PHI", "SAS", "POR"],
};

function normalizeTeamConfigs(
  rawConfigs: TeamConfigInput[],
  allTeams: TeamRow[],
  suggestedOrderIds: number[]
) {
  const rawMap = new Map<number, TeamConfigInput>();

  rawConfigs.forEach((config) => {
    rawMap.set(Number(config.team_id), {
      team_id: Number(config.team_id),
      draft_order: Number(config.draft_order),
      is_participating: Boolean(config.is_participating),
    });
  });

  const allTeamIds = allTeams.map((team) => team.id);

  const participating = allTeamIds.filter(
    (teamId) => rawMap.get(teamId)?.is_participating ?? true
  );

  const notParticipating = allTeamIds.filter(
    (teamId) => !(rawMap.get(teamId)?.is_participating ?? true)
  );

  const suggestedRank = new Map<number, number>();
  suggestedOrderIds.forEach((teamId, index) => suggestedRank.set(teamId, index));

  const sortBySuggestedOrder = (a: number, b: number) => {
    const aRank = suggestedRank.get(a) ?? Number.MAX_SAFE_INTEGER;
    const bRank = suggestedRank.get(b) ?? Number.MAX_SAFE_INTEGER;

    if (aRank !== bRank) return aRank - bRank;

    const aName = allTeams.find((team) => team.id === a)?.name ?? "";
    const bName = allTeams.find((team) => team.id === b)?.name ?? "";
    return aName.localeCompare(bName);
  };

  participating.sort(sortBySuggestedOrder);
  notParticipating.sort(sortBySuggestedOrder);

  return [...participating, ...notParticipating].map((teamId, index) => ({
    team_id: teamId,
    draft_order: index + 1,
    is_participating: participating.includes(teamId),
  }));
}

function buildDateRange(startDate: string, endDate: string) {
  const result: string[] = [];
  const current = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);

  while (current <= end) {
    const year = current.getFullYear();
    const month = String(current.getMonth() + 1).padStart(2, "0");
    const day = String(current.getDate()).padStart(2, "0");
    result.push(`${year}-${month}-${day}`);
    current.setDate(current.getDate() + 1);
  }

  return result;
}

function formatForNbaStats(gameDateIso: string) {
  const [year, month, day] = gameDateIso.split("-");
  return `${month}/${day}/${year}`;
}

function formatForEspn(gameDateIso: string) {
  return gameDateIso.replaceAll("-", "");
}

function normalizeTeamCode(raw: string | null) {
  if (!raw) return null;

  const code = raw.trim().toUpperCase();
  if (!code) return null;

  const aliasMap: Record<string, string> = {
  PHO: "PHX",
  BRK: "BKN",
  UTH: "UTA",
  GS: "GSW",
  SA: "SAS",
  NO: "NOP",

  // 🔥 FIX: Knicks normalization
  NY: "NYK",
};

  return aliasMap[code] ?? code;
}

function getGamesFromPayload(payload: ScoreboardV3Payload) {
  return payload.scoreboard?.games ?? payload.games ?? [];
}

function getTeamTricode(team?: ScoreboardV3Team) {
  const raw = team?.teamTricode ?? team?.tricode ?? team?.teamCode ?? null;
  return normalizeTeamCode(typeof raw === "string" ? raw : null);
}

async function fetchScoreboardForDate(gameDateIso: string) {
  const formattedDate = formatForNbaStats(gameDateIso);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4500);

  try {
    const url = `https://stats.nba.com/stats/scoreboardv3?GameDate=${encodeURIComponent(
      formattedDate
    )}&LeagueID=00`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        Connection: "keep-alive",
        Origin: "https://www.nba.com",
        Referer: "https://www.nba.com/",
        "User-Agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      },
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(
        `NBA scoreboard request failed for ${formattedDate} with status ${response.status}`
      );
    }

    return (await response.json()) as ScoreboardV3Payload;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchEspnScoreboardForDate(gameDateIso: string) {
  const espnDate = formatForEspn(gameDateIso);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4500);

  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${espnDate}`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      },
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(
        `ESPN scoreboard request failed for ${espnDate} with status ${response.status}`
      );
    }

    return (await response.json()) as EspnScoreboardPayload;
  } finally {
    clearTimeout(timeout);
  }
}

async function getNbaTeamsAndFirstGameTimeForDate(date: string) {
  const teamSet = new Set<string>();
  let firstGameStartTime: string | null = null;
  let source: "nba-stats" | "espn" | "manual" | "empty" = "empty";

  try {
    const payload = await fetchScoreboardForDate(date);
    const games = getGamesFromPayload(payload);

    for (const game of games) {
      const homeCode = getTeamTricode(game.homeTeam);
      const awayCode = getTeamTricode(game.awayTeam);

      if (homeCode) teamSet.add(homeCode);
      if (awayCode) teamSet.add(awayCode);

      if (game.gameTimeUTC) {
        if (!firstGameStartTime || game.gameTimeUTC < firstGameStartTime) {
          firstGameStartTime = game.gameTimeUTC;
        }
      }
    }

    if (teamSet.size > 0) {
      source = "nba-stats";
      return { teamCodes: Array.from(teamSet), firstGameStartTime, source };
    }
  } catch (error) {
    console.error(`NBA Stats scoreboard failed for ${date}:`, error);
  }

  try {
    const payload = await fetchEspnScoreboardForDate(date);
    const events = payload.events ?? [];

    for (const event of events) {
      const competitions = event.competitions ?? [];

      for (const competition of competitions) {
        const competitors = competition.competitors ?? [];

        for (const competitor of competitors) {
          const code = normalizeTeamCode(competitor.team?.abbreviation ?? null);
          if (code) teamSet.add(code);
        }

        const gameDate = competition.date ?? event.date;
        if (gameDate) {
          if (!firstGameStartTime || gameDate < firstGameStartTime) {
            firstGameStartTime = gameDate;
          }
        }
      }
    }

    if (teamSet.size > 0) {
      source = "espn";
      return { teamCodes: Array.from(teamSet), firstGameStartTime, source };
    }
  } catch (error) {
    console.error(`ESPN scoreboard failed for ${date}:`, error);
  }

  const manualFallback = MANUAL_TEAM_CODE_FALLBACKS[date] ?? [];
  if (manualFallback.length > 0) {
    source = "manual";
    return {
      teamCodes: manualFallback,
      firstGameStartTime,
      source,
    };
  }

  return {
    teamCodes: [],
    firstGameStartTime,
    source,
  };
}

async function getMostRecentCompletedSlateSetup() {
  const { data: slates, error: slatesError } = await supabaseAdmin
    .from("slates")
    .select("id, start_date, end_date, date")
    .order("start_date", { ascending: false })
    .order("end_date", { ascending: false });

  if (slatesError) throw new Error(slatesError.message);

  for (const slate of slates ?? []) {
    const { data: results, error: resultsError } = await supabaseAdmin
      .from("team_slate_results")
      .select("team_id, fantasy_points, finish_position")
      .eq("slate_id", slate.id);

    if (resultsError) throw new Error(resultsError.message);

    const safeResults = (results ?? []) as TeamSlateResultRow[];
    const hasRealResults = safeResults.some(
      (row) =>
        row.finish_position !== null &&
        row.finish_position !== undefined &&
        (row.fantasy_points ?? 0) > 0
    );

    if (hasRealResults) {
      return { slate, results: safeResults };
    }
  }

  return { slate: null, results: [] as TeamSlateResultRow[] };
}

function buildSuggestedOrderIds(results: TeamSlateResultRow[], safeTeams: TeamRow[]) {
  const rankedTeams = [...results]
    .filter(
      (row) =>
        row.finish_position !== null &&
        row.finish_position !== undefined &&
        (row.fantasy_points ?? 0) > 0
    )
    .sort((a, b) => {
      const aFinish = a.finish_position ?? Number.MAX_SAFE_INTEGER;
      const bFinish = b.finish_position ?? Number.MAX_SAFE_INTEGER;

      if (aFinish !== bFinish) return aFinish - bFinish;

      return (b.fantasy_points ?? 0) - (a.fantasy_points ?? 0);
    });

  const inverseOrderIds = rankedTeams.map((row) => row.team_id).reverse();

  const teamsMissingFromSlate = safeTeams
    .filter((team) => !inverseOrderIds.includes(team.id))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((team) => team.id);

  return [...inverseOrderIds, ...teamsMissingFromSlate];
}

export async function GET() {
  try {
    const { data: teams, error: teamsError } = await supabaseAdmin
      .from("teams")
      .select("id, name")
      .order("name", { ascending: true });

    if (teamsError) {
      return NextResponse.json(
        { error: `Failed to load teams: ${teamsError.message}` },
        { status: 500 }
      );
    }

    const safeTeams = (teams ?? []) as TeamRow[];
    const previousCompleted = await getMostRecentCompletedSlateSetup();

    const suggestedOrderIds = buildSuggestedOrderIds(
      previousCompleted.results,
      safeTeams
    );

    const suggestedTeamConfigs = normalizeTeamConfigs(
      safeTeams.map((team) => ({
        team_id: team.id,
        draft_order: 0,
        is_participating: true,
      })),
      safeTeams,
      suggestedOrderIds
    );

    return NextResponse.json({
      success: true,
      teams: safeTeams,
      latestSlate: previousCompleted.slate,
      previousCompletedSlate: previousCompleted.slate,
      suggestedTeamConfigs,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Unexpected server error while loading slate setup." },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const startDate = body?.startDate;
    const endDate = body?.endDate;

    const teamConfigs = Array.isArray(body?.teamSelections)
      ? body.teamSelections
      : Array.isArray(body?.teamConfigs)
        ? body.teamConfigs
        : [];

    if (!startDate || !endDate) {
      return NextResponse.json(
        { error: "Start date and end date are required." },
        { status: 400 }
      );
    }

    const { data: teams, error: teamsError } = await supabaseAdmin
      .from("teams")
      .select("id, name")
      .order("name", { ascending: true });

    if (teamsError || !teams) {
      return NextResponse.json(
        { error: `Failed to load teams: ${teamsError?.message}` },
        { status: 500 }
      );
    }

    const safeTeams = teams as TeamRow[];
    const previousCompleted = await getMostRecentCompletedSlateSetup();
    const suggestedOrderIds = buildSuggestedOrderIds(
      previousCompleted.results,
      safeTeams
    );

    const normalizedTeamConfigs =
      teamConfigs.length > 0
        ? (teamConfigs as TeamConfigInput[])
            .map((config) => ({
              team_id: Number(config.team_id),
              draft_order: Number(config.draft_order),
              is_participating: Boolean(config.is_participating),
            }))
            .sort((a, b) => {
              if (a.is_participating !== b.is_participating) {
                return a.is_participating ? -1 : 1;
              }

              return a.draft_order - b.draft_order;
            })
            .map((config, index) => ({
              ...config,
              draft_order: index + 1,
            }))
        : normalizeTeamConfigs(
            safeTeams.map((team) => ({
              team_id: team.id,
              draft_order: 0,
              is_participating: true,
            })),
            safeTeams,
            suggestedOrderIds
          );

    const dates = buildDateRange(startDate, endDate);
    const nbaTeamSet = new Set<string>();
    let firstGameStartTime: string | null = null;
    const detectionSources: Array<{
      date: string;
      source: string;
      teamCodes: string[];
      firstGameStartTime: string | null;
    }> = [];

    for (const date of dates) {
      const detected = await getNbaTeamsAndFirstGameTimeForDate(date);

      detected.teamCodes.forEach((code) => nbaTeamSet.add(code));

      if (detected.firstGameStartTime) {
        if (
          !firstGameStartTime ||
          detected.firstGameStartTime < firstGameStartTime
        ) {
          firstGameStartTime = detected.firstGameStartTime;
        }
      }

      detectionSources.push({
        date,
        source: detected.source,
        teamCodes: detected.teamCodes,
        firstGameStartTime: detected.firstGameStartTime,
      });
    }

    const nbaTeamAbbreviations = Array.from(nbaTeamSet).sort();

    const { data: newSlate, error: insertSlateError } = await supabaseAdmin
      .from("slates")
      .insert({
        date: startDate,
        start_date: startDate,
        end_date: endDate,
        is_locked: false,
        nba_team_abbreviations: nbaTeamAbbreviations,
        first_game_start_time: firstGameStartTime,
      })
      .select(
        "id, date, start_date, end_date, is_locked, nba_team_abbreviations, first_game_start_time"
      )
      .single();

    if (insertSlateError || !newSlate) {
      return NextResponse.json(
        { error: insertSlateError?.message || "Failed to create slate." },
        { status: 500 }
      );
    }

    const slateTeamRows = normalizedTeamConfigs.map((config) => ({
      slate_id: newSlate.id,
      team_id: config.team_id,
      draft_order: config.draft_order,
      is_participating: config.is_participating,
    }));

    const { error: insertSlateTeamsError } = await supabaseAdmin
      .from("slate_teams")
      .insert(slateTeamRows);

    if (insertSlateTeamsError) {
      await supabaseAdmin.from("slates").delete().eq("id", newSlate.id);

      return NextResponse.json(
        {
          error: `Failed to create slate team order: ${insertSlateTeamsError.message}`,
        },
        { status: 500 }
      );
    }

    // Automatically pin NBA games for this slate so multi-day stat refreshes
    // rebuild from a stable full game list instead of relying on "today" scoreboards.
    try {
      const dateCodes = new Set(dates.map((date) => date.replaceAll("-", "")));
      const slateTeamCodes = new Set(nbaTeamAbbreviations);

      const scheduleResponse = await fetch(
        "https://cdn.nba.com/static/json/staticData/scheduleLeagueV2.json",
        {
          method: "GET",
          cache: "no-store",
          headers: {
            "User-Agent":
              "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            Accept: "application/json,text/plain,*/*",
            Referer: "https://www.nba.com/",
            Origin: "https://www.nba.com",
          },
        }
      );

      if (scheduleResponse.ok) {
        const schedulePayload = (await scheduleResponse.json()) as any;
        const gameDates = schedulePayload?.leagueSchedule?.gameDates ?? [];
        const scheduleGames = gameDates.flatMap((day: any) => day.games ?? []);

        const slateGameRows = scheduleGames
          .filter((game: any) => {
            const gameCode = String(game?.gameCode ?? "");
            const dateCode = gameCode.slice(0, 8);

            if (!dateCodes.has(dateCode)) return false;
            if (game?.gameStatusText === "UNNECESSARY") return false;

            const awayCode = normalizeTeamCode(game?.awayTeam?.teamTricode ?? null);
            const homeCode = normalizeTeamCode(game?.homeTeam?.teamTricode ?? null);

            return (
              (awayCode && slateTeamCodes.has(awayCode)) ||
              (homeCode && slateTeamCodes.has(homeCode))
            );
          })
          .map((game: any) => ({
            slate_id: newSlate.id,
            game_date: isoDateFromGameCode(game.gameCode),
            game_id: String(game.gameId),
            game_code: game.gameCode ?? null,
            note: `${game?.awayTeam?.teamTricode ?? "?"} at ${game?.homeTeam?.teamTricode ?? "?"}`,
          }))
          .filter((row: any) => row.game_id && row.game_code);

        const dedupedGames = Array.from(
          new Map(
            slateGameRows.map((row: any) => [
              `${row.slate_id}:${row.game_id}`,
              row,
            ])
          ).values()
        );

        if (dedupedGames.length > 0) {
          const { error: slateGamesError } = await supabaseAdmin
            .from("slate_nba_games")
            .upsert(dedupedGames, {
              onConflict: "slate_id,game_id",
            });

          if (slateGamesError) {
            console.error("Failed to auto-create slate_nba_games:", slateGamesError);
          } else {
            console.log(
              `✅ Auto-created ${dedupedGames.length} slate_nba_games rows for slate ${newSlate.id}`
            );
          }
        } else {
          console.warn(
            `No slate_nba_games rows found for slate ${newSlate.id}; refresh may need manual pinning.`
          );
        }
      } else {
        console.error(
          "Failed to load scheduleLeagueV2 while auto-pinning slate games:",
          scheduleResponse.status
        );
      }
    } catch (slateGamesInsertError) {
      console.error(
        "Unexpected error while auto-creating slate_nba_games:",
        slateGamesInsertError
      );
    }

    return NextResponse.json({
      success: true,
      slate: newSlate,
      slateTeams: slateTeamRows,
      nbaTeamAbbreviations,
      firstGameStartTime,
      detectionSources,
      previousCompletedSlate: previousCompleted.slate,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Unexpected server error while creating slate." },
      { status: 500 }
    );
  }
}