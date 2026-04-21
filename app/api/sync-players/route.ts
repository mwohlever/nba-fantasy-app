import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type ExistingPlayer = {
  id: number;
  name: string;
  nba_player_id: number | null;
  nba_display_name: string | null;
  position_group: "G" | "F/C";
  is_active: boolean;
  team_abbreviation: string | null;
  roster_status: number | null;
  is_playing_today: boolean | null;
};

type NbaCommonAllPlayersResponse = {
  resultSets?: Array<{
    name?: string;
    headers?: string[];
    rowSet?: Array<Array<string | number | null>>;
  }>;
  resultSet?: {
    name?: string;
    headers?: string[];
    rowSet?: Array<Array<string | number | null>>;
  };
};

type NbaScoreboardGame = {
  gameId?: string;
  homeTeam?: {
    teamTricode?: string;
  };
  awayTeam?: {
    teamTricode?: string;
  };
};

type NbaScoreboardPayload = {
  scoreboard?: {
    games?: NbaScoreboardGame[];
  };
};

function normalizeName(name: string) {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function getCurrentSeasonString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  // NBA season rolls over around Oct
  if (month >= 10) {
    const nextShort = String((year + 1) % 100).padStart(2, "0");
    return `${year}-${nextShort}`;
  }

  const prevYear = year - 1;
  const currentShort = String(year % 100).padStart(2, "0");
  return `${prevYear}-${currentShort}`;
}

async function fetchTodayTeamTricodes() {
  try {
    const response = await fetch(
      "https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json",
      {
        method: "GET",
        cache: "no-store",
      }
    );

    if (!response.ok) {
      return new Set<string>();
    }

    const payload = (await response.json()) as NbaScoreboardPayload;
    const games = payload.scoreboard?.games ?? [];
    const teamCodes = new Set<string>();

    for (const game of games) {
      const home = game.homeTeam?.teamTricode?.trim();
      const away = game.awayTeam?.teamTricode?.trim();

      if (home) teamCodes.add(home);
      if (away) teamCodes.add(away);
    }

    return teamCodes;
  } catch (error) {
    console.error("Failed to load today's NBA scoreboard:", error);
    return new Set<string>();
  }
}

function getCommonAllPlayersRows(payload: NbaCommonAllPlayersResponse) {
  const resultSet =
    payload.resultSets?.find((set) => set.name === "CommonAllPlayers") ??
    payload.resultSets?.[0] ??
    payload.resultSet;

  const headers = resultSet?.headers ?? [];
  const rows = resultSet?.rowSet ?? [];

  return { headers, rows };
}

function rowToObject(
  headers: string[],
  row: Array<string | number | null>
): Record<string, string | number | null> {
  const result: Record<string, string | number | null> = {};

  headers.forEach((header, index) => {
    result[header] = row[index] ?? null;
  });

  return result;
}

export async function POST() {
  try {
    const season = getCurrentSeasonString();
    const todayTeamTricodes = await fetchTodayTeamTricodes();

    const playersUrl =
      `https://stats.nba.com/stats/commonallplayers` +
      `?IsOnlyCurrentSeason=1&LeagueID=00&Season=${encodeURIComponent(season)}`;

    const nbaResponse = await fetch(playersUrl, {
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
    });

    if (!nbaResponse.ok) {
      const text = await nbaResponse.text();
      return NextResponse.json(
        {
          error: `NBA commonallplayers request failed with status ${nbaResponse.status}.`,
          details: text,
        },
        { status: 502 }
      );
    }

    const nbaPayload =
      (await nbaResponse.json()) as NbaCommonAllPlayersResponse;

    const { headers, rows } = getCommonAllPlayersRows(nbaPayload);

    if (!headers.length || !rows.length) {
      return NextResponse.json(
        { error: "NBA player payload came back empty or unexpected." },
        { status: 502 }
      );
    }

    const { data: existingPlayers, error: existingPlayersError } =
      await supabaseAdmin
        .from("players")
        .select(
          "id, name, nba_player_id, nba_display_name, position_group, is_active, team_abbreviation, roster_status, is_playing_today"
        );

    if (existingPlayersError || !existingPlayers) {
      return NextResponse.json(
        { error: "Failed to load existing players from Supabase." },
        { status: 500 }
      );
    }

    const safeExistingPlayers = existingPlayers as ExistingPlayer[];

    const existingByNbaId = new Map<number, ExistingPlayer>();
    const existingByName = new Map<string, ExistingPlayer>();

    for (const player of safeExistingPlayers) {
      if (player.nba_player_id) {
        existingByNbaId.set(player.nba_player_id, player);
      }
      existingByName.set(normalizeName(player.name), player);
    }

    const updates: Array<{
      id: number;
      nba_player_id: number;
      nba_display_name: string;
      is_active: boolean;
      team_abbreviation: string | null;
      roster_status: number;
      is_playing_today: boolean;
    }> = [];

    const inserts: Array<{
      name: string;
      nba_player_id: number;
      nba_display_name: string;
      position_group: "G" | "F/C";
      is_active: boolean;
      team_abbreviation: string | null;
      roster_status: number;
      is_playing_today: boolean;
    }> = [];

    for (const row of rows) {
      const obj = rowToObject(headers, row);

      const nbaPlayerId = Number(obj.PERSON_ID);
      const displayName = String(obj.DISPLAY_FIRST_LAST ?? "").trim();
      const rosterStatus = Number(obj.ROSTERSTATUS ?? 0);
      const teamAbbreviationRaw = obj.TEAM_ABBREVIATION;
      const teamAbbreviation =
        typeof teamAbbreviationRaw === "string" && teamAbbreviationRaw.trim() !== ""
          ? teamAbbreviationRaw.trim()
          : null;

      if (!nbaPlayerId || !displayName) continue;

      const normalizedDisplayName = normalizeName(displayName);
      const isActive = rosterStatus === 1;
      const isPlayingToday =
        !!teamAbbreviation && todayTeamTricodes.has(teamAbbreviation);

      const existing =
        existingByNbaId.get(nbaPlayerId) ??
        existingByName.get(normalizedDisplayName);

      if (existing) {
        updates.push({
          id: existing.id,
          nba_player_id: nbaPlayerId,
          nba_display_name: displayName,
          is_active: isActive,
          team_abbreviation: teamAbbreviation,
          roster_status: rosterStatus,
          is_playing_today: isPlayingToday,
        });
      } else {
        inserts.push({
          name: displayName,
          nba_player_id: nbaPlayerId,
          nba_display_name: displayName,
          // Default for new players; you can edit later in-app or in DB
          position_group: "F/C",
          is_active: isActive,
          team_abbreviation: teamAbbreviation,
          roster_status: rosterStatus,
          is_playing_today: isPlayingToday,
        });
      }
    }

    let updatedCount = 0;
    let insertedCount = 0;

    for (const row of updates) {
      const { error } = await supabaseAdmin
        .from("players")
        .update({
          nba_player_id: row.nba_player_id,
          nba_display_name: row.nba_display_name,
          is_active: row.is_active,
          team_abbreviation: row.team_abbreviation,
          roster_status: row.roster_status,
          is_playing_today: row.is_playing_today,
        })
        .eq("id", row.id);

      if (!error) {
        updatedCount += 1;
      }
    }

    if (inserts.length > 0) {
      const { data: insertedRows, error: insertError } = await supabaseAdmin
        .from("players")
        .insert(inserts)
        .select("id");

      if (insertError) {
        return NextResponse.json(
          {
            error: `Failed to insert new players: ${insertError.message}`,
          },
          { status: 500 }
        );
      }

      insertedCount = insertedRows?.length ?? 0;
    }

    return NextResponse.json({
      success: true,
      season,
      updatedCount,
      insertedCount,
      totalRowsFromNba: rows.length,
      todayTeamsFound: todayTeamTricodes.size,
      message:
        "Player master sync completed. Existing custom position_group values were preserved.",
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Unexpected server error while syncing players." },
      { status: 500 }
    );
  }
}
