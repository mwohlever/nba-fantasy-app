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

const FANTASY_POSITIONS = new Set(["QB", "RB", "WR", "TE"]);

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
        const positionAbbr = athlete.position?.abbreviation;
        if (!positionAbbr || !FANTASY_POSITIONS.has(positionAbbr)) continue;

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
      playingThisWeekTeams: playingThisWeek.size,
      timings,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Unexpected server error while syncing NFL players." },
      { status: 500 }
    );
  }
}
