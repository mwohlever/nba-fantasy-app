import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdminApi } from "@/lib/requireAdminApi";
import {
  fetchTeams,
  fetchTeamRoster,
  fetchCurrentWeekTeamAbbreviations,
  type EspnTeam,
  type EspnRosterAthlete,
} from "@/lib/providers/nfl";

const FANTASY_POSITIONS = new Set([
  "QB",
  "RB",
  "WR",
  "TE",
  "K",
  "D/ST",
]);

/*
 * ESPN's normal team-roster endpoint does not currently include
 * specialists, so kickers are supplemented from the season-specific
 * Core athlete collection.
 *
 * Team defenses are represented as synthetic players so the existing
 * lineup/draft machinery can treat D/ST like any other exclusive
 * roster position.
 *
 * Keep synthetic ids well outside ESPN's current athlete-id range.
 */
const DST_PLAYER_ID_BASE = 100_000_000;

type EspnCoreAthleteCollection = {
  items?: Array<{
    $ref?: string;
  }>;
};

type EspnCoreAthlete = {
  id?: string;
  displayName?: string;
  fullName?: string;
  active?: boolean;
  position?: {
    abbreviation?: string;
    name?: string;
  };
};

type ExistingPlayerNfl = {
  id: number;
  name: string;
  nfl_player_id: number | null;
  position: string;
  team_abbreviation: string | null;
  is_active: boolean;
  is_playing_this_week: boolean | null;
};

function normalizeName(name: string) {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchAllRostersConcurrently(
  teams: EspnTeam[]
): Promise<Array<{ team: EspnTeam; roster: EspnRosterAthlete[] }>> {
  return Promise.all(
    teams.map(async (team) => ({
      team,
      roster: await fetchTeamRoster(team.id),
    }))
  );
}

function getCurrentNflSeasonYear() {
  const now = new Date();
  const month = now.getUTCMonth() + 1;

  /*
   * NFL seasons beginning Jan-Feb still belong to the season
   * that started in the previous calendar year.
   */
  return month <= 2
    ? now.getUTCFullYear() - 1
    : now.getUTCFullYear();
}

async function fetchCoreTeamKickers(
  team: EspnTeam,
  season: number,
): Promise<EspnCoreAthlete[]> {
  const collectionUrl =
    `https://sports.core.api.espn.com/v2/sports/football/` +
    `leagues/nfl/seasons/${season}/teams/${team.id}/athletes?limit=100`;

  const collectionResponse = await fetch(collectionUrl, {
    cache: "no-store",
  });

  if (!collectionResponse.ok) {
    throw new Error(
      `ESPN Core athletes request failed for ${team.abbreviation}: ` +
        `${collectionResponse.status}`,
    );
  }

  const collection =
    (await collectionResponse.json()) as EspnCoreAthleteCollection;

  const athleteRefs =
    collection.items
      ?.map((item) => item.$ref)
      .filter((ref): ref is string => Boolean(ref)) ??
    [];

  const athletes = await Promise.all(
    athleteRefs.map(async (rawRef) => {
      const ref = rawRef.replace(/^http:/, "https:");

      const response = await fetch(ref, {
        cache: "no-store",
      });

      if (!response.ok) {
        return null;
      }

      return (await response.json()) as EspnCoreAthlete;
    }),
  );

  return athletes.filter(
    (athlete): athlete is EspnCoreAthlete =>
      Boolean(
        athlete &&
          athlete.position?.abbreviation === "PK" &&
          athlete.active !== false,
      ),
  );
}

async function fetchAllKickersConcurrently(
  teams: EspnTeam[],
  season: number,
) {
  return Promise.all(
    teams.map(async (team) => ({
      team,
      kickers: await fetchCoreTeamKickers(
        team,
        season,
      ),
    })),
  );
}

export async function GET() {
  return POST();
}

export async function POST() {
  const authError = await requireAdminApi();
  if (authError) return authError;

  const timings: Record<string, number> = {};
  const overallStart = Date.now();

  try {
    let stepStart = Date.now();
    const teams = await fetchTeams();
    timings.fetchTeamsMs = Date.now() - stepStart;

    if (teams.length === 0) {
      return NextResponse.json(
        { error: "ESPN teams request returned no teams." },
        { status: 502 }
      );
    }

    stepStart = Date.now();
    const playingThisWeek = await fetchCurrentWeekTeamAbbreviations();
    timings.fetchScoreboardMs = Date.now() - stepStart;

    stepStart = Date.now();
    const teamRosters = await fetchAllRostersConcurrently(teams);
    timings.fetchRostersMs = Date.now() - stepStart;

    stepStart = Date.now();
    const nflSeason = getCurrentNflSeasonYear();
    const teamKickers = await fetchAllKickersConcurrently(
      teams,
      nflSeason,
    );
    timings.fetchKickersMs = Date.now() - stepStart;

    stepStart = Date.now();
    const { data: existingPlayers, error: existingPlayersError } =
      await supabaseAdmin
        .from("players_nfl")
        .select(
          "id, name, nfl_player_id, position, team_abbreviation, is_active, is_playing_this_week"
        );
    timings.loadExistingPlayersMs = Date.now() - stepStart;

    if (existingPlayersError || !existingPlayers) {
      return NextResponse.json(
        { error: "Failed to load existing players_nfl from Supabase." },
        { status: 500 }
      );
    }

    const safeExistingPlayers = existingPlayers as ExistingPlayerNfl[];

    const existingByEspnId = new Map<number, ExistingPlayerNfl>();
    const existingByName = new Map<string, ExistingPlayerNfl>();

    for (const player of safeExistingPlayers) {
      if (player.nfl_player_id) {
        existingByEspnId.set(player.nfl_player_id, player);
      }
      existingByName.set(normalizeName(player.name), player);
    }

    const espnPositionCounts: Record<string, number> = {};

    const updates: Array<{
      id: number;
      nfl_player_id: number;
      name: string;
      position: string;
      team_abbreviation: string;
      is_active: boolean;
      is_playing_this_week: boolean;
    }> = [];

    const inserts: Array<{
      name: string;
      nfl_player_id: number;
      position: string;
      team_abbreviation: string;
      is_active: boolean;
      is_playing_this_week: boolean;
    }> = [];

    for (const { team, roster } of teamRosters) {
      for (const athlete of roster) {
        const rawPositionAbbr =
          athlete.position?.abbreviation;

        const diagnosticPosition =
          rawPositionAbbr || "(missing)";

        espnPositionCounts[diagnosticPosition] =
          (espnPositionCounts[diagnosticPosition] ?? 0) + 1;

        const positionAbbr =
          rawPositionAbbr === "PK"
            ? "K"
            : rawPositionAbbr;

        if (
          !positionAbbr ||
          !FANTASY_POSITIONS.has(
            positionAbbr,
          )
        ) {
          continue;
        }

        const espnId = Number(athlete.id);
        const displayName = athlete.displayName;
        if (!espnId || !displayName) continue;

        const normalizedDisplayName = normalizeName(displayName);
        const isPlayingThisWeek = playingThisWeek.has(team.abbreviation);

        const existing =
          existingByEspnId.get(espnId) ??
          existingByName.get(normalizedDisplayName);

        if (existing) {
          updates.push({
            id: existing.id,
            nfl_player_id: espnId,
            name: displayName,
            position: positionAbbr,
            team_abbreviation: team.abbreviation,
            is_active: true,
            is_playing_this_week: isPlayingThisWeek,
          });
        } else {
          inserts.push({
            name: displayName,
            nfl_player_id: espnId,
            position: positionAbbr,
            team_abbreviation: team.abbreviation,
            is_active: true,
            is_playing_this_week: isPlayingThisWeek,
          });
        }
      }
    }

    /*
     * Supplement the normal ESPN roster data with kickers.
     * Core reports place kickers as PK; 111 Sports stores K.
     */
    for (const { team, kickers } of teamKickers) {
      for (const athlete of kickers) {
        const espnId = Number(athlete.id);
        const displayName =
          athlete.displayName ??
          athlete.fullName;

        if (
          !espnId ||
          !displayName
        ) {
          continue;
        }

        const normalizedDisplayName =
          normalizeName(displayName);

        const isPlayingThisWeek =
          playingThisWeek.has(
            team.abbreviation,
          );

        const existing =
          existingByEspnId.get(espnId) ??
          existingByName.get(
            normalizedDisplayName,
          );

        if (existing) {
          updates.push({
            id: existing.id,
            nfl_player_id: espnId,
            name: displayName,
            position: "K",
            team_abbreviation:
              team.abbreviation,
            is_active: true,
            is_playing_this_week:
              isPlayingThisWeek,
          });
        } else {
          inserts.push({
            name: displayName,
            nfl_player_id: espnId,
            position: "K",
            team_abbreviation:
              team.abbreviation,
            is_active: true,
            is_playing_this_week:
              isPlayingThisWeek,
          });
        }
      }
    }

    /*
     * Add one synthetic fantasy player per NFL team for D/ST.
     *
     * The synthetic id is deterministic, so every refresh updates
     * the same row rather than creating duplicate defenses.
     */
    for (const team of teams) {
      const numericTeamId =
        Number(team.id);

      if (!Number.isFinite(numericTeamId)) {
        continue;
      }

      const syntheticEspnId =
        DST_PLAYER_ID_BASE +
        numericTeamId;

      const displayName =
        `${team.abbreviation} D/ST`;

      const normalizedDisplayName =
        normalizeName(displayName);

      const isPlayingThisWeek =
        playingThisWeek.has(
          team.abbreviation,
        );

      const existing =
        existingByEspnId.get(
          syntheticEspnId,
        ) ??
        existingByName.get(
          normalizedDisplayName,
        );

      if (existing) {
        updates.push({
          id: existing.id,
          nfl_player_id:
            syntheticEspnId,
          name: displayName,
          position: "D/ST",
          team_abbreviation:
            team.abbreviation,
          is_active: true,
          is_playing_this_week:
            isPlayingThisWeek,
        });
      } else {
        inserts.push({
          name: displayName,
          nfl_player_id:
            syntheticEspnId,
          position: "D/ST",
          team_abbreviation:
            team.abbreviation,
          is_active: true,
          is_playing_this_week:
            isPlayingThisWeek,
        });
      }
    }

    stepStart = Date.now();
    let updatedCount = 0;

    if (updates.length > 0) {
      const { data: updatedRows, error: updateError } = await supabaseAdmin
        .from("players_nfl")
        .upsert(updates, { onConflict: "id" })
        .select("id");

      if (updateError) {
        return NextResponse.json(
          { error: `Failed to bulk-update NFL players: ${updateError.message}` },
          { status: 500 }
        );
      }

      updatedCount = updatedRows?.length ?? 0;
    }
    timings.updateLoopMs = Date.now() - stepStart;

    stepStart = Date.now();
    let insertedCount = 0;

    if (inserts.length > 0) {
      const { data: insertedRows, error: insertError } = await supabaseAdmin
        .from("players_nfl")
        .upsert(inserts, { onConflict: "nfl_player_id" })
        .select("id");

      if (insertError) {
        return NextResponse.json(
          { error: `Failed to insert new NFL players: ${insertError.message}` },
          { status: 500 }
        );
      }

      insertedCount = insertedRows?.length ?? 0;
    }
    timings.insertMs = Date.now() - stepStart;

    timings.totalMs = Date.now() - overallStart;

    return NextResponse.json({
      success: true,
      teamsProcessed: teamRosters.length,
      updatedCount,
      insertedCount,
      kickerCount: teamKickers.reduce(
        (total, item) =>
          total + item.kickers.length,
        0,
      ),
      defenseCount: teams.length,
      playingThisWeekTeams: playingThisWeek.size,
      timings,
      espnPositionCounts,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Unexpected server error while syncing NFL players." },
      { status: 500 }
    );
  }
}
