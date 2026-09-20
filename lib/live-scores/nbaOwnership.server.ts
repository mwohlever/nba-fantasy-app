import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { getActiveLeagueForSport } from "@/lib/groups/context";
import { buildNbaOwnership, matchingNbaSlate, type NbaOwnership } from "./nbaOwnership";

type Access = NonNullable<Awaited<ReturnType<typeof getActiveLeagueForSport>>>;

function athletesFromBoxscore(boxscore: any) {
  const byId = new Map<string, { id: unknown; displayName?: unknown }>();
  for (const team of Array.isArray(boxscore?.players) ? boxscore.players : []) {
    for (const category of Array.isArray(team?.statistics) ? team.statistics : []) {
      for (const row of Array.isArray(category?.athletes) ? category.athletes : []) {
        const athlete = row?.athlete;
        if (athlete?.id != null && !byId.has(String(athlete.id))) byId.set(String(athlete.id), athlete);
      }
    }
  }
  return [...byId.values()];
}

export async function loadNbaOwnership(access: Access, tipoff: string, boxscore: any): Promise<NbaOwnership> {
  const result: NbaOwnership = { groupId: access.context.group.id, leagueId: access.league.id, slateId: null, players: {} };
  const slates = await supabaseAdmin.from("slates").select("id,date,start_date,end_date")
    .eq("league_id", access.league.id).eq("sport", "nba");
  if (slates.error) throw new Error(slates.error.message);
  const slate = matchingNbaSlate(slates.data ?? [], tipoff);
  if (!slate) return result;
  result.slateId = Number(slate.id);

  const [lineups, teams, memberships] = await Promise.all([
    supabaseAdmin.from("lineups").select("id,team_id,lineup_players(player_id)").eq("slate_id", slate.id),
    supabaseAdmin.from("teams").select("id,name,user_id").eq("group_id", access.context.group.id),
    supabaseAdmin.from("group_memberships").select("user_id").eq("group_id", access.context.group.id).eq("is_active", true),
  ]);
  if (lineups.error || teams.error || memberships.error) throw new Error("NBA ownership unavailable");
  const activeUsers = new Set((memberships.data ?? []).map((row) => String(row.user_id)));
  const groupTeams = new Map((teams.data ?? []).filter((team) => activeUsers.has(String(team.user_id)))
    .map((team) => [Number(team.id), team]));
  const scoped = (lineups.data ?? []).filter((lineup) => groupTeams.has(Number(lineup.team_id)));
  const localIds = [...new Set(scoped.flatMap((lineup) => lineup.lineup_players.map((row: any) => Number(row.player_id))))];
  if (!localIds.length) return result;
  const localPlayers = await supabaseAdmin.from("players").select("id,name").in("id", localIds);
  if (localPlayers.error) throw new Error(localPlayers.error.message);
  const localById = new Map((localPlayers.data ?? []).map((player) => [Number(player.id), player]));
  result.players = buildNbaOwnership(athletesFromBoxscore(boxscore), scoped.flatMap((lineup) =>
    lineup.lineup_players.flatMap((row: any) => {
      const player = localById.get(Number(row.player_id));
      const team = groupTeams.get(Number(lineup.team_id));
      return player && team ? [{ localPlayerId: Number(player.id), playerName: player.name, teamId: Number(team.id), teamName: team.name }] : [];
    })), access.context.team?.id);
  return result;
}
