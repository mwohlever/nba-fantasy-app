import type { AppUser } from "@/lib/auth";
import {
  getActiveLeagueForSport,
  type GroupContext,
  type GroupLeague,
} from "@/lib/groups/context";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  selectNcaaPickEmParticipants,
  type NcaaPickEmParticipant,
} from "@/lib/ncaaPickEm/participants";

export type { NcaaPickEmParticipant } from "@/lib/ncaaPickEm/participants";

export type NcaaPickEmAccess = {
  context: GroupContext;
  league: GroupLeague;
  participants: NcaaPickEmParticipant[];
  viewerTeam: NcaaPickEmParticipant | null;
};

export async function loadNcaaPickEmParticipants(
  groupId: string,
): Promise<NcaaPickEmParticipant[]> {
  const [membershipsResult, teamsResult] = await Promise.all([
    supabaseAdmin
      .from("group_memberships")
      .select("user_id")
      .eq("group_id", groupId)
      .eq("is_active", true),
    supabaseAdmin
      .from("teams")
      .select("id, name, user_id, group_id, display_order")
      .eq("group_id", groupId)
      .not("user_id", "is", null)
      .order("display_order", { ascending: true })
      .order("id", { ascending: true }),
  ]);

  if (membershipsResult.error) {
    throw new Error(
      `Failed to load active NCAA Pick 'Em memberships: ${membershipsResult.error.message}`,
    );
  }

  if (teamsResult.error) {
    throw new Error(
      `Failed to load NCAA Pick 'Em Group teams: ${teamsResult.error.message}`,
    );
  }

  const activeUserIds = new Set((membershipsResult.data ?? []).map((row) => String(row.user_id)));
  const participantTeams = (teamsResult.data ?? []).filter((team) => team.user_id && activeUserIds.has(String(team.user_id)));
  const userIds = participantTeams.map((team) => String(team.user_id));

  const usersResult = userIds.length
    ? await supabaseAdmin
        .from("app_users")
        .select("id, avatar_url, is_active")
        .in("id", userIds)
        .eq("is_active", true)
    : { data: [], error: null };

  if (usersResult.error) {
    throw new Error(
      `Failed to load NCAA Pick 'Em participant accounts: ${usersResult.error.message}`,
    );
  }

  return selectNcaaPickEmParticipants({
    groupId,
    memberships: (membershipsResult.data ?? []).map((row) => ({ user_id: String(row.user_id) })),
    teams: participantTeams.map((team) => ({ id: Number(team.id), name: String(team.name), user_id: team.user_id ? String(team.user_id) : null, group_id: String(team.group_id) })),
    users: (usersResult.data ?? []).map((user) => ({ id: String(user.id), avatar_url: user.avatar_url ?? null, is_active: user.is_active === true })),
  });
}

export async function getNcaaPickEmAccess(
  user: AppUser,
): Promise<NcaaPickEmAccess | null> {
  const activeLeague = await getActiveLeagueForSport(
    user,
    "ncaa_pickem",
  );

  if (!activeLeague) return null;

  const participants = await loadNcaaPickEmParticipants(
    activeLeague.context.group.id,
  );
  const viewerTeamId = activeLeague.context.team?.id ?? null;
  const viewerTeam = viewerTeamId
    ? participants.find((participant) => participant.teamId === viewerTeamId) ??
      null
    : null;

  return {
    ...activeLeague,
    participants,
    viewerTeam,
  };
}
