import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type SlateTeamUpdate = {
  team_id: number;
  draft_order: number;
  is_participating: boolean;
};

type UpdateSlateBody = {
  is_locked?: boolean;
  teams?: SlateTeamUpdate[];
  nba_team_abbreviations?: string[];
};

type RouteContext = {
  params: Promise<{
    slateId: string;
  }>;
};

export async function GET(_: NextRequest, context: RouteContext) {
  const { slateId } = await context.params;

  const { data: slate } = await supabaseAdmin
    .from("slates")
    .select("*")
    .eq("id", Number(slateId))
    .single();

  const { data: teams } = await supabaseAdmin
    .from("teams")
    .select("id, name");

  const { data: slateTeams } = await supabaseAdmin
    .from("slate_teams")
    .select("*")
    .eq("slate_id", Number(slateId));

  const configMap = new Map(
    (slateTeams ?? []).map((row) => [row.team_id, row])
  );

  const mergedTeams =
    teams?.map((team, index) => {
      const config = configMap.get(team.id);
      return {
        team_id: team.id,
        team_name: team.name,
        draft_order: config?.draft_order ?? index + 1,
        is_participating: config?.is_participating ?? true,
      };
    }) ?? [];

  return NextResponse.json({
    success: true,
    slate,
    teams: mergedTeams,
  });
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { slateId } = await context.params;
  const body = await request.json();

  const { is_locked, teams, nba_team_abbreviations } = body;

  // 🔥 UPDATE SLATE (including NBA teams)
  await supabaseAdmin
    .from("slates")
    .update({
      is_locked,
      nba_team_abbreviations: nba_team_abbreviations ?? [],
    })
    .eq("id", Number(slateId));

  const payload = teams.map((team: SlateTeamUpdate) => ({
    slate_id: Number(slateId),
    team_id: team.team_id,
    draft_order: team.draft_order,
    is_participating: team.is_participating,
  }));

  await supabaseAdmin
    .from("slate_teams")
    .upsert(payload, { onConflict: "slate_id,team_id" });

  return NextResponse.json({ success: true });
}
