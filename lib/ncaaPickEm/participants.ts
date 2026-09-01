export type NcaaPickEmParticipant = {
  teamId: number;
  userId: string;
  name: string;
  avatarUrl: string | null;
};

export function selectNcaaPickEmParticipants({
  groupId,
  memberships,
  teams,
  users,
}: {
  groupId: string;
  memberships: Array<{ user_id: string }>;
  teams: Array<{ id: number; name: string; user_id: string | null; group_id: string }>;
  users: Array<{ id: string; avatar_url: string | null; is_active: boolean }>;
}): NcaaPickEmParticipant[] {
  const memberUserIds = new Set(
    memberships.map((membership) => String(membership.user_id)),
  );
  const activeUsers = new Map(
    users
      .filter((user) => user.is_active)
      .map((user) => [String(user.id), user]),
  );

  return teams
    .filter(
      (team) =>
        team.group_id === groupId &&
        team.user_id !== null &&
        memberUserIds.has(String(team.user_id)) &&
        activeUsers.has(String(team.user_id)),
    )
    .map((team) => ({
      teamId: Number(team.id),
      userId: String(team.user_id),
      name: String(team.name),
      avatarUrl: activeUsers.get(String(team.user_id))?.avatar_url ?? null,
    }));
}
