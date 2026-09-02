import type { AppUser } from "@/lib/auth";
import {
  getActiveLeagueForSport,
  type GroupContext,
  type GroupLeague,
} from "@/lib/groups/context";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export type NbaSkinsTeam = {
  teamId: number;
  teamName: string;
  userId: string | null;
  avatarUrl: string | null;
  isActiveParticipant: boolean;
};

export type NbaSkinsAccess = {
  context: GroupContext;
  league: GroupLeague;
  teams: NbaSkinsTeam[];
  participants: NbaSkinsTeam[];
  viewerTeam: NbaSkinsTeam | null;
};

export async function loadNbaSkinsGroupTeams(
  groupId: string,
): Promise<NbaSkinsTeam[]> {
  const [membershipsResult, teamsResult] = await Promise.all([
    supabaseAdmin
      .from("group_memberships")
      .select("user_id")
      .eq("group_id", groupId)
      .eq("is_active", true),
    supabaseAdmin
      .from("teams")
      .select("id, name, user_id, display_order")
      .eq("group_id", groupId)
      .order("display_order", { ascending: true })
      .order("id", { ascending: true }),
  ]);

  if (membershipsResult.error) {
    throw new Error(
      `Failed to load NBA Skins Group memberships: ${membershipsResult.error.message}`,
    );
  }

  if (teamsResult.error) {
    throw new Error(
      `Failed to load NBA Skins Group teams: ${teamsResult.error.message}`,
    );
  }

  const userIds = (teamsResult.data ?? [])
    .map((team) => team.user_id ? String(team.user_id) : null)
    .filter((userId): userId is string => Boolean(userId));
  const usersResult = userIds.length
    ? await supabaseAdmin
        .from("app_users")
        .select("id, avatar_url, is_active")
        .in("id", userIds)
    : { data: [], error: null };

  if (usersResult.error) {
    throw new Error(
      `Failed to load NBA Skins participant accounts: ${usersResult.error.message}`,
    );
  }

  const activeMemberIds = new Set(
    (membershipsResult.data ?? []).map((row) => String(row.user_id)),
  );
  const usersById = new Map(
    (usersResult.data ?? []).map((row) => [String(row.id), row]),
  );

  return (teamsResult.data ?? []).map((team) => {
    const userId = team.user_id ? String(team.user_id) : null;
    const account = userId ? usersById.get(userId) : null;

    return {
      teamId: Number(team.id),
      teamName: String(team.name),
      userId,
      avatarUrl: account?.avatar_url ?? null,
      isActiveParticipant: Boolean(
        userId && activeMemberIds.has(userId) && account?.is_active === true,
      ),
    };
  });
}

export async function getNbaSkinsAccess(
  user: AppUser,
): Promise<NbaSkinsAccess | null> {
  const activeLeague = await getActiveLeagueForSport(
    user,
    "nba_skins",
  );

  if (!activeLeague) return null;

  const teams = await loadNbaSkinsGroupTeams(
    activeLeague.context.group.id,
  );
  const participants = teams.filter((team) => team.isActiveParticipant);
  const viewerTeamId = activeLeague.context.team?.id ?? null;

  return {
    ...activeLeague,
    teams,
    participants,
    viewerTeam: viewerTeamId
      ? teams.find((team) => team.teamId === viewerTeamId) ?? null
      : null,
  };
}
