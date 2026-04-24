import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

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
};

type ScoreboardV3Payload = {
  scoreboard?: { games?: ScoreboardV3Game[] };
  games?: ScoreboardV3Game[];
};

const MANUAL_TEAM_CODE_FALLBACKS: Record<string, string[]> = {
  "2026-04-24": ["LAL", "HOU", "BOS", "PHI", "SAS", "POR"],
};

function normalizeTeamConfigs(rawConfigs: TeamConfigInput[], allTeams: TeamRow[], suggestedOrderIds: number[]) {
  const rawMap = new Map<number, TeamConfigInput>();

  rawConfigs.forEach((config) => {
    rawMap.set(Number(config.team_id), {
      team_id: Number(config.team_id),
      draft_order: Number(config.draft_order),
      is_participating: Boolean(config.is_participating),
    });
  });

  const allTeamIds = allTeams.map((team) => team.id);
  const participating = allTeamIds.filter((teamId) => rawMap.get(teamId)?.is_participating ?? true);
  const notParticipating = allTeamIds.filter((teamId) => !(rawMap.get(teamId)?.is_participating ?? true));

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

async function fetchTeamsForDate(gameDateIso: string) {
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
      throw new Error(`NBA scoreboard request failed for ${formattedDate} with status ${response.status}`);
    }

    const payload = (await response.json()) as ScoreboardV3Payload;
    const games = getGamesFromPayload(payload);
    const teamCodes = new Set<string>();

    for (const game of games) {
      const homeCode = getTeamTricode(game.homeTeam);
      const awayCode = getTeamTricode(game.awayTeam);

      if (homeCode) teamCodes.add(homeCode);
      if (awayCode) teamCodes.add(awayCode);
    }

    return Array.from(teamCodes);
  } finally {
    clearTimeout(timeout);
  }
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

function getFallbackTeamCodesForRange(startDate: string, endDate: string) {
  const dates = buildDateRange(startDate, endDate);
  const teamSet = new Set<string>();

  dates.forEach((date) => {
    (MANUAL_TEAM_CODE_FALLBACKS[date] ?? []).forEach((code) => teamSet.add(code));
  });

  return Array.from(teamSet).sort();
}

export async function GET() {
  try {
    const { data: teams, error: teamsError } = await supabaseAdmin
      .from("teams")
      .select("id, name")
      .order("name", { ascending: true });

    if (teamsError) {
      return NextResponse.json({ error: `Failed to load teams: ${teamsError.message}` }, { status: 500 });
    }

    const safeTeams = (teams ?? []) as TeamRow[];
    const previousCompleted = await getMostRecentCompletedSlateSetup();

    const suggestedOrderIds = buildSuggestedOrderIds(previousCompleted.results, safeTeams);

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
    return NextResponse.json({ error: "Unexpected server error while loading slate setup." }, { status: 500 });
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
      return NextResponse.json({ error: "Start date and end date are required." }, { status: 400 });
    }

    const { data: teams, error: teamsError } = await supabaseAdmin
      .from("teams")
      .select("id, name")
      .order("name", { ascending: true });

    if (teamsError || !teams) {
      return NextResponse.json({ error: `Failed to load teams: ${teamsError?.message}` }, { status: 500 });
    }

    const safeTeams = teams as TeamRow[];
    const previousCompleted = await getMostRecentCompletedSlateSetup();
    const suggestedOrderIds = buildSuggestedOrderIds(previousCompleted.results, safeTeams);

    const normalizedTeamConfigs = normalizeTeamConfigs(
      teamConfigs.length > 0
        ? (teamConfigs as TeamConfigInput[]).map((config) => ({
            team_id: Number(config.team_id),
            draft_order: Number(config.draft_order),
            is_participating: Boolean(config.is_participating),
          }))
        : safeTeams.map((team) => ({
            team_id: team.id,
            draft_order: 0,
            is_participating: true,
          })),
      safeTeams,
      suggestedOrderIds
    );

    const dates = buildDateRange(startDate, endDate);
    const nbaTeamSet = new Set<string>();

    for (const date of dates) {
      try {
        const teamsForDate = await fetchTeamsForDate(date);
        teamsForDate.forEach((teamCode) => {
          const normalized = normalizeTeamCode(teamCode);
          if (normalized) nbaTeamSet.add(normalized);
        });
      } catch (error) {
        console.error(`Failed to load NBA teams for ${date}:`, error);
      }
    }

    const autoDetectedCodes = Array.from(nbaTeamSet).sort();
    const fallbackCodes = getFallbackTeamCodesForRange(startDate, endDate);
    const nbaTeamAbbreviations = autoDetectedCodes.length > 0 ? autoDetectedCodes : fallbackCodes;

    const { data: newSlate, error: insertSlateError } = await supabaseAdmin
      .from("slates")
      .insert({
        date: startDate,
        start_date: startDate,
        end_date: endDate,
        is_locked: false,
        nba_team_abbreviations: nbaTeamAbbreviations,
      })
      .select("id, date, start_date, end_date, is_locked, nba_team_abbreviations")
      .single();

    if (insertSlateError || !newSlate) {
      return NextResponse.json({ error: insertSlateError?.message || "Failed to create slate." }, { status: 500 });
    }

    const slateTeamRows = normalizedTeamConfigs.map((config) => ({
      slate_id: newSlate.id,
      team_id: config.team_id,
      draft_order: config.draft_order,
      is_participating: config.is_participating,
    }));

    const { error: insertSlateTeamsError } = await supabaseAdmin.from("slate_teams").insert(slateTeamRows);

    if (insertSlateTeamsError) {
      await supabaseAdmin.from("slates").delete().eq("id", newSlate.id);

      return NextResponse.json(
        { error: `Failed to create slate team order: ${insertSlateTeamsError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      slate: newSlate,
      slateTeams: slateTeamRows,
      autoDetectedNbaTeams: autoDetectedCodes,
      fallbackNbaTeams: fallbackCodes,
      nbaTeamAbbreviations,
      previousCompletedSlate: previousCompleted.slate,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Unexpected server error while creating slate." }, { status: 500 });
  }
}
