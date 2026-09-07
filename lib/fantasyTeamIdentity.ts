type TeamOwner = { id: number; user_id: string | null };
type Account = { id: string; avatar_url: string | null };

// Historical avatars do not require a currently active account or membership.
export async function loadFantasyTeamAvatars(db: any, teams: TeamOwner[]) {
  const userIds = [...new Set(teams.flatMap((team) => team.user_id ? [team.user_id] : []))];
  const { data, error } = userIds.length
    ? await db.from("app_users").select("id, avatar_url").in("id", userIds)
    : { data: [], error: null };
  if (error) throw new Error(`Failed to load team avatars: ${error.message}`);
  const accounts = new Map<string, Account>((data ?? []).map((user: Account) => [user.id, user]));
  return new Map<number, string | null>(teams.map((team) => [
    Number(team.id), team.user_id ? accounts.get(team.user_id)?.avatar_url ?? null : null,
  ]));
}

export type FantasyRecipient = { id: string; display_name: string; team_id: number };

// Current recipients require the actual slate, its Group-owned team, and an
// active Group membership. Never infer ownership from an account's legacy team.
export async function loadFantasyNotificationRecipients(
  db: any,
  slateId: number,
  sport: "nba" | "nfl",
  teamIds: number[],
): Promise<FantasyRecipient[]> {
  const { data: slate, error: slateError } = await db.from("slates")
    .select("league_id, sport").eq("id", slateId).maybeSingle();
  if (slateError) throw new Error(slateError.message);
  if (!slate?.league_id || slate.sport !== sport) return [];
  const { data: league, error: leagueError } = await db.from("leagues")
    .select("group_id, sport_key, game_mode").eq("id", slate.league_id).maybeSingle();
  if (leagueError) throw new Error(leagueError.message);
  if (!league?.group_id || league.sport_key !== sport || league.game_mode !== "standard") return [];
  if (!teamIds.length) return [];

  const [participation, membership] = await Promise.all([
    db.from("slate_teams").select("team_id").eq("slate_id", slateId)
      .eq("is_participating", true).in("team_id", teamIds),
    db.from("group_memberships").select("user_id").eq("group_id", league.group_id)
      .eq("is_active", true),
  ]);
  if (participation.error || membership.error) {
    throw new Error((participation.error ?? membership.error).message);
  }
  const participantIds = (participation.data ?? []).map((row: any) => Number(row.team_id));
  const memberIds = (membership.data ?? []).map((row: any) => String(row.user_id));
  if (!participantIds.length || !memberIds.length) return [];
  const { data: teams, error: teamsError } = await db.from("teams")
    .select("id, user_id").eq("group_id", league.group_id)
    .in("id", participantIds).in("user_id", memberIds);
  if (teamsError) throw new Error(teamsError.message);
  const owners = (teams ?? []) as TeamOwner[];
  const userIds = [...new Set(owners.flatMap((team) => team.user_id ? [team.user_id] : []))];
  if (!userIds.length) return [];
  const { data: users, error: usersError } = await db.from("app_users")
    .select("id, display_name").in("id", userIds).eq("is_active", true);
  if (usersError) throw new Error(usersError.message);
  const accounts = new Map<string, { id: string; display_name: string }>(
    (users ?? []).map((user: any) => [String(user.id), user]),
  );
  return owners.flatMap((team) => {
    const account = team.user_id ? accounts.get(team.user_id) : null;
    return account ? [{ ...account, team_id: Number(team.id) }] : [];
  });
}
