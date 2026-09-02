import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import {
  getNbaSkinsAccess,
  loadNbaSkinsGroupTeams,
  type NbaSkinsAccess,
} from "@/lib/nbaSkins/access";
import { authorizeNbaSkinsSeasonResource } from "@/lib/security/resourceAuthorization";
import { validateNbaSkinsDraftOrder } from "@/lib/nbaSkins/policy";
import { getNbaSkinsTotalPicks } from "@/lib/nbaSkins/policy";
import { resolveNbaSkinsRules } from "@/lib/rules/leagueRules";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

type SeasonStatus = "open" | "locked" | "final";
type SeasonRow = {
  id: number; season: number; status: SeasonStatus; draft_locked_at: string | null;
  finalized_at: string | null; created_at: string;
  participant_count: number; nba_teams_per_participant: number;
};
type DraftOrderRow = { season_id: number; team_id: number; draft_position: number };

function seasonLabel(season: number) {
  return `${season}-${String(season + 1).slice(-2)}`;
}

async function requireActiveSkinsAdmin() {
  const user = await getCurrentUser();
  if (!user) {
    return { response: NextResponse.json({ error: "Login required." }, { status: 401 }) };
  }
  const access = await getNbaSkinsAccess(user);
  if (!access) {
    return { response: NextResponse.json({ error: "NBA Skins is not enabled for the active Group." }, { status: 404 }) };
  }
  if (!access.context.canAdministerGroup) {
    return { response: NextResponse.json({ error: "Group admin access required." }, { status: 403 }) };
  }
  return { user, access };
}

async function loadAdminData(access: NbaSkinsAccess) {
  const { data: seasonsRaw, error: seasonsError } = await supabaseAdmin
    .from("nba_skins_seasons")
    .select("id, season, status, draft_locked_at, finalized_at, created_at, participant_count, nba_teams_per_participant")
    .eq("league_id", access.league.id)
    .order("season", { ascending: false });
  if (seasonsError) throw new Error(seasonsError.message);
  const seasons = (seasonsRaw ?? []) as SeasonRow[];
  const seasonIds = seasons.map((season) => season.id);
  const [orderResult, picksResult] = seasonIds.length
    ? await Promise.all([
        supabaseAdmin.from("nba_skins_draft_order")
          .select("season_id, team_id, draft_position")
          .in("season_id", seasonIds).order("draft_position", { ascending: true }),
        supabaseAdmin.from("nba_skins_picks").select("season_id, id").in("season_id", seasonIds),
      ])
    : [{ data: [], error: null }, { data: [], error: null }];
  if (orderResult.error) throw new Error(orderResult.error.message);
  if (picksResult.error) throw new Error(picksResult.error.message);

  const draftOrder = (orderResult.data ?? []) as DraftOrderRow[];
  const teamNameById = new Map(access.teams.map((team) => [team.teamId, team.teamName]));
  const rules = resolveNbaSkinsRules(access.league.settings);
  return {
    teams: access.participants.map((team) => ({ id: team.teamId, name: team.teamName })),
    rules: {
      ...rules,
      totalPicks: getNbaSkinsTotalPicks(rules),
    },
    seasons: seasons.map((season) => ({
      ...season,
      label: seasonLabel(season.season),
      draftOrder: draftOrder.filter((row) => Number(row.season_id) === Number(season.id))
        .sort((a, b) => a.draft_position - b.draft_position)
        .map((row) => ({
          teamId: Number(row.team_id),
          teamName: teamNameById.get(Number(row.team_id)) ?? "Unknown",
          draftPosition: Number(row.draft_position),
        })),
      pickCount: (picksResult.data ?? []).filter((pick) => Number(pick.season_id) === Number(season.id)).length,
      participantCount: Number(season.participant_count),
      nbaTeamsPerParticipant: Number(season.nba_teams_per_participant),
      totalPicks: Number(season.participant_count) * Number(season.nba_teams_per_participant),
      canDelete: season.season >= 2026 && season.status !== "final",
    })),
  };
}

export async function GET() {
  const auth = await requireActiveSkinsAdmin();
  if ("response" in auth) return auth.response;
  try {
    return NextResponse.json({ success: true, ...(await loadAdminData(auth.access)) });
  } catch (error) {
    console.error("NBA Skins admin load error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load NBA Skins admin." },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireActiveSkinsAdmin();
  if ("response" in auth) return auth.response;
  try {
    const body = await request.json();
    const season = Number(body?.season);
    const participantTeamIds = Array.isArray(body?.participantTeamIds)
      ? body.participantTeamIds.map((teamId: unknown) => Number(teamId))
      : [];
    if (!Number.isInteger(season) || season < 2022 || season > 2100) {
      return NextResponse.json({ error: "Enter a valid NBA season starting year." }, { status: 400 });
    }
    const { data: existing, error: existingError } = await supabaseAdmin
      .from("nba_skins_seasons").select("id")
      .eq("league_id", auth.access.league.id).eq("season", season).maybeSingle();
    if (existingError) throw new Error(existingError.message);
    if (existing) {
      return NextResponse.json({ error: `${seasonLabel(season)} already exists.` }, { status: 409 });
    }
    const rules = resolveNbaSkinsRules(auth.access.league.settings);
    if (!validateNbaSkinsDraftOrder(
      participantTeamIds,
      auth.access.participants.map((team) => team.teamId),
      rules.participantCount,
    )) {
      return NextResponse.json(
        { error: `Select exactly ${rules.participantCount} distinct active Group participants.` },
        { status: 400 },
      );
    }
    const { count: draftableTeamCount, error: draftableTeamsError } = await supabaseAdmin
      .from("nba_skins_nba_teams")
      .select("abbreviation", { count: "exact", head: true })
      .eq("is_active", true);
    if (draftableTeamsError) throw new Error(draftableTeamsError.message);
    const totalPicks = getNbaSkinsTotalPicks(rules);
    if (totalPicks > (draftableTeamCount ?? 0)) {
      return NextResponse.json(
        { error: `Configured draft requires ${totalPicks} picks but only ${draftableTeamCount ?? 0} NBA teams are active.` },
        { status: 400 },
      );
    }
    const now = new Date().toISOString();
    const { data: createdSeason, error: createError } = await supabaseAdmin
      .from("nba_skins_seasons")
      .insert({
        league_id: auth.access.league.id,
        season,
        status: "open",
        draft_locked_at: null,
        finalized_at: null,
        participant_count: rules.participantCount,
        nba_teams_per_participant: rules.nbaTeamsPerParticipant,
        updated_at: now,
      })
      .select("id, season, status, league_id, participant_count, nba_teams_per_participant").single();
    if (createError) throw new Error(createError.message);
    const { error: orderError } = await supabaseAdmin.from("nba_skins_draft_order").insert(
      participantTeamIds.map((teamId: number, index: number) => ({
        season_id: createdSeason.id,
        team_id: teamId,
        draft_position: index + 1,
      })),
    );
    if (orderError) {
      const { error: cleanupError } = await supabaseAdmin
        .from("nba_skins_seasons").delete().eq("id", createdSeason.id);
      if (cleanupError) {
        console.error("Failed to clean up NBA Skins season after participant insert failure:", cleanupError);
      }
      throw new Error(`Failed to save NBA Skins participants: ${orderError.message}`);
    }
    return NextResponse.json({
      success: true,
      message: `${seasonLabel(season)} NBA Skins season created.`,
      season: createdSeason,
    });
  } catch (error) {
    console.error("NBA Skins season create error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create NBA Skins season." },
      { status: 500 },
    );
  }
}

async function authorizeSeason(request: NextRequest, seasonId: number) {
  const authorization = await authorizeNbaSkinsSeasonResource(request, seasonId, {
    requireCommissioner: true,
  });
  if (!authorization.ok) return authorization;
  if (authorization.target.sportKey !== "nba_skins") {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Resource not found." }, { status: 404 }),
    };
  }
  return authorization;
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const seasonId = Number(body?.seasonId);
    const action = String(body?.action ?? "");
    if (!Number.isInteger(seasonId)) {
      return NextResponse.json({ error: "Invalid season." }, { status: 400 });
    }
    const authorization = await authorizeSeason(request, seasonId);
    if (!authorization.ok) return authorization.response;
    const { data: season, error: seasonError } = await supabaseAdmin
      .from("nba_skins_seasons").select("id, season, status, participant_count, nba_teams_per_participant")
      .eq("id", seasonId).maybeSingle();
    if (seasonError || !season) {
      return NextResponse.json({ error: "NBA Skins season not found." }, { status: 404 });
    }

    if (action === "save-order") {
      if (Number(season.season) < 2026) {
        return NextResponse.json({ error: "Historical draft order before 2026 is not editable." }, { status: 409 });
      }
      if (season.status !== "open") {
        return NextResponse.json({ error: "Only an open season's draft order can be changed." }, { status: 409 });
      }
      const order = (Array.isArray(body?.order) ? body.order : []) as Array<{ teamId: number }>;
      const participantCount = Number(season.participant_count);
      const groupTeams = await loadNbaSkinsGroupTeams(authorization.target.groupId);
      const validTeamIds = new Set(groupTeams.filter((team) => team.isActiveParticipant).map((team) => team.teamId));
      const teamIds = order.map((entry) => Number(entry?.teamId));
      if (!validateNbaSkinsDraftOrder(teamIds, [...validTeamIds], participantCount)) {
        return NextResponse.json(
          { error: `Draft order must contain ${participantCount} active Group teams exactly once.` },
          { status: 400 },
        );
      }
      const { data: existingOrder, error: existingOrderError } = await supabaseAdmin
        .from("nba_skins_draft_order").select("team_id").eq("season_id", seasonId);
      if (existingOrderError) throw new Error(existingOrderError.message);
      const existingTeamIds = new Set((existingOrder ?? []).map((row) => Number(row.team_id)));
      if (
        existingTeamIds.size !== participantCount ||
        teamIds.some((teamId) => !existingTeamIds.has(teamId))
      ) {
        return NextResponse.json(
          { error: "Season participants are frozen when the season is created. Reorder the selected participants only." },
          { status: 409 },
        );
      }
      const { error: deleteOrderError } = await supabaseAdmin
        .from("nba_skins_draft_order").delete().eq("season_id", seasonId);
      if (deleteOrderError) throw new Error(`Failed to clear draft order: ${deleteOrderError.message}`);
      const { error: insertOrderError } = await supabaseAdmin.from("nba_skins_draft_order").insert(
        teamIds.map((teamId, index) => ({ season_id: seasonId, team_id: teamId, draft_position: index + 1 })),
      );
      if (insertOrderError) throw new Error(`Failed to save draft order: ${insertOrderError.message}`);
      return NextResponse.json({ success: true, message: `${seasonLabel(Number(season.season))} draft order saved.` });
    }

    if (action === "set-status") {
      const status = String(body?.status ?? "") as SeasonStatus;
      if (!["open", "locked"].includes(status)) {
        return NextResponse.json({ error: "Admin draft status can only be Open or Locked here." }, { status: 400 });
      }
      if (Number(season.season) < 2026) {
        return NextResponse.json({ error: "Historical draft order before 2026 is not editable." }, { status: 409 });
      }
      if (season.status === "final") {
        return NextResponse.json({ error: "A finalized NBA Skins season cannot be reopened from Draft Admin." }, { status: 409 });
      }
      if (status === "locked") {
        const [orderResult, picksResult] = await Promise.all([
          supabaseAdmin.from("nba_skins_draft_order").select("id", { count: "exact", head: true }).eq("season_id", seasonId),
          supabaseAdmin.from("nba_skins_picks").select("id", { count: "exact", head: true }).eq("season_id", seasonId),
        ]);
        if (orderResult.error || picksResult.error) {
          throw new Error(orderResult.error?.message ?? picksResult.error?.message ?? "Failed to validate draft.");
        }
        const totalPicks = Number(season.participant_count) * Number(season.nba_teams_per_participant);
        if (orderResult.count !== Number(season.participant_count) || picksResult.count !== totalPicks) {
          return NextResponse.json(
            { error: `Complete the ${season.participant_count}-participant draft order and all ${totalPicks} picks before locking.` },
            { status: 409 },
          );
        }
      }
      const now = new Date().toISOString();
      const { error: updateError } = await supabaseAdmin.from("nba_skins_seasons").update({
        status,
        draft_locked_at: status === "locked" ? now : null,
        updated_at: now,
      }).eq("id", seasonId);
      if (updateError) throw new Error(updateError.message);
      return NextResponse.json({
        success: true,
        message: status === "locked"
          ? `${seasonLabel(Number(season.season))} draft locked.`
          : `${seasonLabel(Number(season.season))} draft reopened.`,
      });
    }

    return NextResponse.json({ error: "Unknown NBA Skins admin action." }, { status: 400 });
  } catch (error) {
    console.error("NBA Skins admin update error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update NBA Skins." },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const seasonId = Number(body?.seasonId);
    if (!Number.isInteger(seasonId)) {
      return NextResponse.json({ error: "Invalid season." }, { status: 400 });
    }
    const authorization = await authorizeSeason(request, seasonId);
    if (!authorization.ok) return authorization.response;
    const { data: season, error: seasonError } = await supabaseAdmin
      .from("nba_skins_seasons").select("id, season, status").eq("id", seasonId).maybeSingle();
    if (seasonError || !season) {
      return NextResponse.json({ error: "NBA Skins season not found." }, { status: 404 });
    }
    if (Number(season.season) < 2026) {
      return NextResponse.json({ error: "Historical NBA Skins seasons cannot be deleted from this page." }, { status: 409 });
    }
    if (season.status === "final") {
      return NextResponse.json({ error: "Final NBA Skins seasons cannot be deleted." }, { status: 409 });
    }
    const { error: deleteError } = await supabaseAdmin.from("nba_skins_seasons").delete().eq("id", seasonId);
    if (deleteError) throw new Error(deleteError.message);
    return NextResponse.json({ success: true, message: `${seasonLabel(Number(season.season))} deleted.` });
  } catch (error) {
    console.error("NBA Skins delete season error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete NBA Skins season." },
      { status: 500 },
    );
  }
}
