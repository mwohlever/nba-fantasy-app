import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { getNbaSkinsAccess, type NbaSkinsAccess } from "@/lib/nbaSkins/access";
import { authorizeNbaSkinsSeasonResource } from "@/lib/security/resourceAuthorization";
import {
  buildNbaSkinsSnakeSlots,
  getNbaSkinsTotalPicks,
} from "@/lib/nbaSkins/policy";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

type SeasonRow = {
  id: number; season: number; status: "open" | "locked" | "final";
  participant_count: number; nba_teams_per_participant: number;
};
type TeamRow = { id: number; name: string };
type DraftOrderRow = Record<string, unknown> & { season_id?: number; team_id?: number };
type PickRow = {
  id: number; season_id: number; team_id: number; nba_team_abbreviation: string;
  pick_type: "wins" | "losses"; draft_round: number | null; final_points: number | null;
};
type SavePickInput = {
  pickNumber: number; round: number; teamId: number;
  nbaTeamAbbreviation: string; pickType: "wins" | "losses";
};

function seasonLabel(season: number) {
  return `${season}-${String(season + 1).slice(-2)}`;
}

function getDraftPosition(row: DraftOrderRow) {
  for (const candidate of [row.draft_order, row.draft_position, row.position]) {
    const value = Number(candidate);
    if (Number.isInteger(value) && value >= 1) return value;
  }
  return null;
}

function buildSnakeOwners(orderedTeams: TeamRow[], rounds: number) {
  const teamById = new Map(orderedTeams.map((team) => [team.id, team]));
  return buildNbaSkinsSnakeSlots(
    orderedTeams.map((team) => team.id),
    rounds,
  ).map((slot) => ({
    ...slot,
    teamName: teamById.get(slot.teamId)?.name ?? "Unknown",
  }));
}

async function loadDraft(access: NbaSkinsAccess, requestedSeason?: number) {
  const { data: seasonsRaw, error: seasonsError } = await supabaseAdmin
    .from("nba_skins_seasons")
    .select("id, season, status, participant_count, nba_teams_per_participant")
    .eq("league_id", access.league.id)
    .order("season", { ascending: false });
  if (seasonsError) throw new Error(seasonsError.message);
  const seasons = (seasonsRaw ?? []) as SeasonRow[];
  if (seasons.length === 0) throw new Error("No NBA Skins seasons exist for the active Group.");

  const selectedSeason = seasons.find((row) => row.season === requestedSeason) ?? seasons[0];
  const [nbaTeamsResult, draftOrderResult, picksResult] = await Promise.all([
    supabaseAdmin.from("nba_skins_nba_teams").select("*").order("display_name", { ascending: true }),
    supabaseAdmin.from("nba_skins_draft_order").select("*").eq("season_id", selectedSeason.id),
    supabaseAdmin.from("nba_skins_picks")
      .select("id, season_id, team_id, nba_team_abbreviation, pick_type, draft_round, final_points")
      .eq("season_id", selectedSeason.id),
  ]);
  for (const result of [nbaTeamsResult, draftOrderResult, picksResult]) {
    if (result.error) throw new Error(result.error.message);
  }

  const teams = access.teams.map((team) => ({ id: team.teamId, name: team.teamName }));
  const teamById = new Map(teams.map((team) => [team.id, team]));
  const orderedTeams = ((draftOrderResult.data ?? []) as DraftOrderRow[])
    .map((row) => {
      const team = teamById.get(Number(row.team_id));
      const draftPosition = getDraftPosition(row);
      return team && draftPosition !== null ? { ...team, draftPosition } : null;
    })
    .filter((team): team is TeamRow & { draftPosition: number } => team !== null)
    .sort((a, b) => a.draftPosition - b.draftPosition);
  const hasValidDraftOrder = orderedTeams.length === Number(selectedSeason.participant_count) &&
    new Set(orderedTeams.map((team) => team.id)).size === Number(selectedSeason.participant_count);
  const picks = (picksResult.data ?? []) as PickRow[];
  const pickByTeamRound = new Map<string, PickRow>();
  for (const pick of picks) {
    if (pick.draft_round !== null) pickByTeamRound.set(`${pick.team_id}:${pick.draft_round}`, pick);
  }

  return {
    seasons,
    selectedSeason,
    orderedTeams,
    hasValidDraftOrder,
    nbaTeams: (nbaTeamsResult.data ?? []).filter((team) => team.is_active !== false).map((team) => ({
      abbreviation: String(team.abbreviation), displayName: String(team.display_name),
    })),
    slots: (hasValidDraftOrder
      ? buildSnakeOwners(orderedTeams, Number(selectedSeason.nba_teams_per_participant))
      : []).map((slot) => {
      const savedPick = pickByTeamRound.get(`${slot.teamId}:${slot.round}`);
      return {
        ...slot,
        nbaTeamAbbreviation: savedPick?.nba_team_abbreviation ?? "",
        pickType: savedPick?.pick_type ?? "wins",
      };
    }),
  };
}

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Login required." }, { status: 401 });
    const access = await getNbaSkinsAccess(user);
    if (!access) {
      return NextResponse.json({ error: "NBA Skins is not enabled for the active Group." }, { status: 404 });
    }
    const rawSeason = request.nextUrl.searchParams.get("season");
    const requestedSeason = rawSeason ? Number(rawSeason) : undefined;
    const draft = await loadDraft(access, Number.isInteger(requestedSeason) ? requestedSeason : undefined);

    return NextResponse.json({
      success: true,
      currentUser: {
        teamId: access.viewerTeam?.teamId ?? null,
        displayName: user.displayName,
        role: access.context.canAdministerGroup ? "admin" : "player",
      },
      availableSeasons: draft.seasons.map((season) => ({
        season: season.season, label: seasonLabel(season.season), status: season.status,
      })),
      season: {
        id: draft.selectedSeason.id,
        season: draft.selectedSeason.season,
        label: seasonLabel(draft.selectedSeason.season),
        status: draft.selectedSeason.status,
        editable: draft.selectedSeason.season >= 2026 &&
          draft.selectedSeason.status === "open" && access.context.canAdministerGroup,
        participantCount: Number(draft.selectedSeason.participant_count),
        nbaTeamsPerParticipant: Number(draft.selectedSeason.nba_teams_per_participant),
        totalPicks: getNbaSkinsTotalPicks({
          participantCount: Number(draft.selectedSeason.participant_count),
          nbaTeamsPerParticipant: Number(draft.selectedSeason.nba_teams_per_participant),
        }),
      },
      draftOrder: draft.orderedTeams.map((team) => ({
        teamId: team.id, teamName: team.name, draftPosition: team.draftPosition,
      })),
      hasValidDraftOrder: draft.hasValidDraftOrder,
      nbaTeams: draft.nbaTeams,
      picks: draft.slots,
    });
  } catch (error) {
    console.error("NBA Skins draft load error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load NBA Skins draft." },
      { status: 500 },
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Login required." }, { status: 401 });
    const access = await getNbaSkinsAccess(user);
    if (!access) {
      return NextResponse.json({ error: "NBA Skins is not enabled for the active Group." }, { status: 404 });
    }
    const body = await request.json();
    const season = Number(body?.season);
    const submittedPicks = Array.isArray(body?.picks) ? body.picks : [];
    if (!Number.isInteger(season)) return NextResponse.json({ error: "Invalid season." }, { status: 400 });

    const draft = await loadDraft(access, season);
    if (draft.selectedSeason.season !== season) {
      return NextResponse.json({ error: `NBA Skins season ${season} was not found.` }, { status: 404 });
    }
    const authorization = await authorizeNbaSkinsSeasonResource(request, draft.selectedSeason.id, {
      requireCommissioner: true,
    });
    if (!authorization.ok) return authorization.response;
    if (authorization.target.sportKey !== "nba_skins") {
      return NextResponse.json({ error: "Resource not found." }, { status: 404 });
    }
    if (season < 2026) {
      return NextResponse.json({ error: "Historical draft order before 2026 is not editable." }, { status: 409 });
    }
    if (draft.selectedSeason.status !== "open") {
      return NextResponse.json(
        { error: `The ${seasonLabel(season)} NBA Skins draft is ${draft.selectedSeason.status} and cannot be edited.` },
        { status: 409 },
      );
    }
    if (!draft.hasValidDraftOrder) {
      return NextResponse.json({ error: `A valid ${draft.selectedSeason.participant_count}-participant draft order must be configured before saving.` }, { status: 409 });
    }
    const activeParticipantIds = new Set(access.participants.map((team) => team.teamId));
    if (draft.orderedTeams.some((team) => !activeParticipantIds.has(team.id))) {
      return NextResponse.json(
        { error: `The draft order must contain ${draft.selectedSeason.participant_count} active Group participants.` },
        { status: 409 },
      );
    }
    const totalPicks = getNbaSkinsTotalPicks({
      participantCount: Number(draft.selectedSeason.participant_count),
      nbaTeamsPerParticipant: Number(draft.selectedSeason.nba_teams_per_participant),
    });
    if (submittedPicks.length !== totalPicks) {
      return NextResponse.json({ error: `All ${totalPicks} draft picks must be completed before saving.` }, { status: 400 });
    }

    const normalizedPicks: SavePickInput[] = [];
    for (let index = 0; index < draft.slots.length; index += 1) {
      const expected = draft.slots[index];
      const raw = submittedPicks[index] ?? {};
      const pickNumber = Number(raw.pickNumber);
      const round = Number(raw.round);
      const teamId = Number(raw.teamId);
      const nbaTeamAbbreviation = String(raw.nbaTeamAbbreviation ?? "").trim().toUpperCase();
      const pickType = raw.pickType === "losses" ? "losses" : raw.pickType === "wins" ? "wins" : null;
      if (pickNumber !== expected.pickNumber || round !== expected.round || teamId !== expected.teamId) {
        return NextResponse.json({ error: `Pick ${expected.pickNumber} does not match the configured draft order.` }, { status: 400 });
      }
      if (!nbaTeamAbbreviation) {
        return NextResponse.json({ error: `Pick ${expected.pickNumber} is missing an NBA team.` }, { status: 400 });
      }
      if (!pickType) {
        return NextResponse.json({ error: `Pick ${expected.pickNumber} must be Wins or Losses.` }, { status: 400 });
      }
      normalizedPicks.push({ pickNumber, round, teamId, nbaTeamAbbreviation, pickType });
    }

    const nbaTeamSet = new Set(draft.nbaTeams.map((team) => team.abbreviation));
    const invalidTeam = normalizedPicks.find((pick) => !nbaTeamSet.has(pick.nbaTeamAbbreviation));
    if (invalidTeam) {
      return NextResponse.json({ error: `${invalidTeam.nbaTeamAbbreviation} is not an active NBA Skins team.` }, { status: 400 });
    }
    if (new Set(normalizedPicks.map((pick) => pick.nbaTeamAbbreviation)).size !== totalPicks) {
      return NextResponse.json({ error: "Each NBA team can only be drafted once." }, { status: 400 });
    }
    const picksPerOwner = new Map<number, number>();
    normalizedPicks.forEach((pick) => picksPerOwner.set(pick.teamId, (picksPerOwner.get(pick.teamId) ?? 0) + 1));
    if (draft.orderedTeams.some((team) =>
      picksPerOwner.get(team.id) !== Number(draft.selectedSeason.nba_teams_per_participant)
    )) {
      return NextResponse.json(
        { error: `Each participant must have exactly ${draft.selectedSeason.nba_teams_per_participant} picks.` },
        { status: 400 },
      );
    }

    const { error: deleteError } = await supabaseAdmin.from("nba_skins_picks")
      .delete().eq("season_id", draft.selectedSeason.id);
    if (deleteError) throw new Error(`Failed to clear existing draft picks: ${deleteError.message}`);
    const now = new Date().toISOString();
    const rows = normalizedPicks.map((pick) => ({
      season_id: draft.selectedSeason.id,
      team_id: pick.teamId,
      nba_team_abbreviation: pick.nbaTeamAbbreviation,
      pick_type: pick.pickType,
      draft_round: pick.round,
      overall_pick: pick.pickNumber,
      final_points: null,
      created_at: now,
      updated_at: now,
    }));
    const { error: insertError } = await supabaseAdmin.from("nba_skins_picks").insert(rows);
    if (insertError) throw new Error(`Failed to save NBA Skins draft: ${insertError.message}`);
    return NextResponse.json({
      success: true,
      message: `${seasonLabel(season)} NBA Skins draft saved successfully.`,
      picksSaved: rows.length,
    });
  } catch (error) {
    console.error("NBA Skins draft save error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save NBA Skins draft." },
      { status: 500 },
    );
  }
}
