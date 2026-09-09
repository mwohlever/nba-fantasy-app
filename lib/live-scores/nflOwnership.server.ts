import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { getNflLiveAccess } from "./access";
import { buildNflOwnership, matchingNflSlate, type NflOwnership } from "./nflOwnership";

export async function loadNflOwnership(access: NonNullable<Awaited<ReturnType<typeof getNflLiveAccess>>>, kickoff: string): Promise<NflOwnership> {
  const { context, league } = access;
  const result: NflOwnership = { groupId: context.group.id, leagueId: league.id, slateId: null, players: {} };
  const slates = await supabaseAdmin.from("slates").select("id, date, start_date, end_date")
    .eq("league_id", league.id).eq("sport", "nfl");
  if (slates.error) throw new Error(slates.error.message);
  const slate = matchingNflSlate(slates.data ?? [], kickoff);
  if (!slate) return result;
  result.slateId = slate.id;
  const [lineups, teams] = await Promise.all([
    supabaseAdmin.from("lineups").select("id, team_id, lineup_players(player_id)").eq("slate_id", slate.id),
    supabaseAdmin.from("teams").select("id, name").eq("group_id", context.group.id),
  ]);
  if (lineups.error || teams.error) throw new Error("NFL ownership unavailable");
  const groupTeams = new Map((teams.data ?? []).map(team => [Number(team.id), team]));
  const scoped = (lineups.data ?? []).filter(lineup => groupTeams.has(Number(lineup.team_id)));
  const ids = [...new Set(scoped.flatMap(lineup => lineup.lineup_players.map(row => Number(row.player_id))))];
  if (!ids.length) return result;
  const players = await supabaseAdmin.from("players_nfl").select("id, nfl_player_id, position").in("id", ids);
  if (players.error) throw new Error(players.error.message);
  const providerIds = new Map((players.data ?? []).filter(player => player.position !== "D/ST").map(player => [Number(player.id), player.nfl_player_id]));
  result.players = buildNflOwnership(scoped.flatMap(lineup => lineup.lineup_players.map(row => ({
    providerId: providerIds.get(Number(row.player_id)), teamId: Number(lineup.team_id),
    name: groupTeams.get(Number(lineup.team_id))!.name,
  }))), context.team?.id);
  return result;
}
