import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { getNbaSkinsAccess } from "@/lib/nbaSkins/access";
import { selectNbaSkinsSeasonTeamIds } from "@/lib/nbaSkins/policy";
import { resolveNbaSkinsRules } from "@/lib/rules/leagueRules";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

type SeasonRow = {
  id: number; season: number; status: "open" | "locked" | "final";
  participant_count: number; nba_teams_per_participant: number;
};
type PickRow = {
  id: number; season_id: number; team_id: number; nba_team_abbreviation: string;
  pick_type: "wins" | "losses"; draft_round: number | null; final_points: number | null;
};
type TeamRecordRow = {
  nba_team_abbreviation: string; wins: number; losses: number; games_played: number;
  projected_wins: number | null; projected_losses: number | null; projection_source: string | null;
};

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Login required." }, { status: 401 });

    const access = await getNbaSkinsAccess(user);
    if (!access) {
      return NextResponse.json(
        { error: "NBA Skins is not enabled for the active Group." },
        { status: 404 },
      );
    }

    const { data: seasonRowsRaw, error: seasonsError } = await supabaseAdmin
      .from("nba_skins_seasons")
      .select("id, season, status, participant_count, nba_teams_per_participant")
      .eq("league_id", access.league.id)
      .order("season", { ascending: false });
    if (seasonsError) throw new Error(seasonsError.message);
    const seasonRows = (seasonRowsRaw ?? []) as SeasonRow[];
    const leagueRules = resolveNbaSkinsRules(access.league.settings);
    const rules = {
      ...leagueRules,
      totalPicks:
        leagueRules.participantCount * leagueRules.nbaTeamsPerParticipant,
    };
    if (seasonRows.length === 0) {
      return NextResponse.json({
        availableSeasons: [],
        selectedSeason: null,
        standings: [],
        rules,
      });
    }

    const rawRequestedSeason = request.nextUrl.searchParams.get("season");
    const requestedSeason = rawRequestedSeason === null ? null : Number(rawRequestedSeason);
    const homeMode = request.nextUrl.searchParams.get("home") === "1";
    let selectedSeason =
      (requestedSeason !== null && Number.isFinite(requestedSeason)
        ? seasonRows.find((row) => row.season === requestedSeason)
        : null) ?? seasonRows[0];

    if (homeMode && rawRequestedSeason === null) {
      const { data, error } = await supabaseAdmin
        .from("nba_skins_picks")
        .select("season_id")
        .in("season_id", seasonRows.map((row) => row.id));
      if (error) throw new Error(error.message);
      const pickCounts = new Map<number, number>();
      for (const row of data ?? []) {
        const seasonId = Number(row.season_id);
        pickCounts.set(seasonId, (pickCounts.get(seasonId) ?? 0) + 1);
      }
      selectedSeason = seasonRows.find((row) =>
        pickCounts.get(row.id) === Number(row.participant_count) * Number(row.nba_teams_per_participant)
      ) ?? seasonRows[0];
    }

    const [picksResult, nbaTeamsResult, recordsResult, orderResult] = await Promise.all([
      supabaseAdmin.from("nba_skins_picks")
        .select("id, season_id, team_id, nba_team_abbreviation, pick_type, draft_round, final_points")
        .eq("season_id", selectedSeason.id),
      supabaseAdmin.from("nba_skins_nba_teams").select("abbreviation, display_name"),
      supabaseAdmin.from("nba_skins_team_records")
        .select("nba_team_abbreviation, wins, losses, games_played, projected_wins, projected_losses, projection_source")
        .eq("season_id", selectedSeason.id),
      supabaseAdmin.from("nba_skins_draft_order").select("team_id, draft_position")
        .eq("season_id", selectedSeason.id).order("draft_position", { ascending: true }),
    ]);
    for (const result of [picksResult, nbaTeamsResult, recordsResult, orderResult]) {
      if (result.error) throw new Error(result.error.message);
    }

    const picks = (picksResult.data ?? []) as PickRow[];
    const teamIdsForSeason = selectNbaSkinsSeasonTeamIds({
      groupTeamIds: access.teams.map((team) => team.teamId),
      activeTeamIds: access.participants.map((team) => team.teamId),
      referencedTeamIds: [
      ...picks.map((pick) => Number(pick.team_id)),
      ...(orderResult.data ?? []).map((row) => Number(row.team_id)),
      ],
    });
    const seasonTeamIdSet = new Set(teamIdsForSeason);
    const seasonTeams = access.teams.filter((team) => seasonTeamIdSet.has(team.teamId));
    const nbaTeamNames = new Map(
      (nbaTeamsResult.data ?? []).map((row) => [String(row.abbreviation), String(row.display_name)]),
    );
    const records = new Map(
      ((recordsResult.data ?? []) as TeamRecordRow[]).map((row) => [row.nba_team_abbreviation, row]),
    );

    const standings = seasonTeams.map((team) => {
      const ownerPicks = picks.filter((pick) => Number(pick.team_id) === team.teamId)
        .sort((a, b) => (a.draft_round ?? 999) - (b.draft_round ?? 999));
      const hasCompleteFinalPoints = ownerPicks.length === Number(selectedSeason.nba_teams_per_participant) &&
        ownerPicks.every((pick) => pick.final_points !== null);
      return {
        ownerName: team.teamName,
        leagueTeamId: team.teamId,
        avatarUrl: team.avatarUrl,
        pickCount: ownerPicks.length,
        finalTotal: hasCompleteFinalPoints
          ? ownerPicks.reduce((sum, pick) => sum + Number(pick.final_points), 0)
          : null,
        hasCompleteFinalPoints,
        picks: ownerPicks.map((pick) => {
          const record = records.get(pick.nba_team_abbreviation);
          return {
            id: pick.id,
            nbaTeamAbbreviation: pick.nba_team_abbreviation,
            nbaTeamName: nbaTeamNames.get(pick.nba_team_abbreviation) ?? pick.nba_team_abbreviation,
            pickType: pick.pick_type,
            draftRound: selectedSeason.season >= 2026 ? pick.draft_round : null,
            finalPoints: pick.final_points,
            record: record ? {
              wins: record.wins, losses: record.losses, gamesPlayed: record.games_played,
              projectedWins: record.projected_wins, projectedLosses: record.projected_losses,
              projectionSource: record.projection_source,
            } : null,
          };
        }),
      };
    });

    const ranked = standings.filter((entry) => entry.finalTotal !== null)
      .sort((a, b) => Number(b.finalTotal) - Number(a.finalTotal));
    const rankByTeamId = new Map<number, number>();
    let previousTotal: number | null = null;
    let previousRank = 0;
    ranked.forEach((entry, index) => {
      const total = Number(entry.finalTotal);
      const rank = previousTotal !== null && total === previousTotal ? previousRank : index + 1;
      rankByTeamId.set(entry.leagueTeamId, rank);
      previousTotal = total;
      previousRank = rank;
    });

    return NextResponse.json({
      availableSeasons: seasonRows.map((row) => ({ season: row.season, status: row.status })),
      selectedSeason: {
        id: selectedSeason.id,
        season: selectedSeason.season,
        status: selectedSeason.status,
        participantCount: Number(selectedSeason.participant_count),
        nbaTeamsPerParticipant: Number(selectedSeason.nba_teams_per_participant),
        totalPicks: Number(selectedSeason.participant_count) * Number(selectedSeason.nba_teams_per_participant),
      },
      rules,
      standings: standings.map((entry) => ({
        ...entry,
        rank: rankByTeamId.get(entry.leagueTeamId) ?? null,
      })).sort((a, b) => {
        if (a.rank !== null && b.rank !== null) return a.rank - b.rank;
        if (a.rank !== null) return -1;
        if (b.rank !== null) return 1;
        return seasonTeams.findIndex((team) => team.teamId === a.leagueTeamId) -
          seasonTeams.findIndex((team) => team.teamId === b.leagueTeamId);
      }),
    });
  } catch (error) {
    console.error("NBA Skins standings error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load NBA Skins standings." },
      { status: 500 },
    );
  }
}
