import "server-only";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { fetchNcaaPickEmWeek } from "@/lib/providers/ncaa";
import { canRefreshNcaaOdds } from "./odds";
import type { NcaaWeek } from "./backgroundPolicy";

type GameRow = { id: number; espn_event_id: string; included: boolean; status: string; kickoff_at: string };

/** Provider mapping is shared with the UI. All mutations and grading are one fenced transaction. */
export async function refreshNcaaWeek(weekId: number, token: string) {
  const loaded = await supabaseAdmin.from("ncaa_pickem_weeks")
    .select("id,season,week_number,lock_at,status,league_id").eq("id", weekId).single();
  if (loaded.error || !loaded.data) throw new Error("NCAA Pick 'Em week not found.");
  const week = loaded.data as NcaaWeek;
  const stored = await supabaseAdmin.from("ncaa_pickem_games")
    .select("id,espn_event_id,included,status,kickoff_at").eq("week_id", weekId);
  if (stored.error) throw new Error(`NCAA games unavailable: ${stored.error.message}`);
  const existingGames = (stored.data ?? []) as GameRow[];
  const localGameByEspnId = new Map(existingGames.map(game => [String(game.espn_event_id), game]));
  const espnWeek = await fetchNcaaPickEmWeek({ season: week.season, week: week.week_number, signal: AbortSignal.timeout(15_000) });
  const now = new Date().toISOString();
  const gameUpdates = espnWeek.scheduleGames.flatMap(espnGame => {
    const localGame = localGameByEspnId.get(espnGame.espnEventId);
    if (!localGame) return [];
    return [{
      espn_event_id: espnGame.espnEventId,
      kickoff_at: espnGame.kickoffAt,
      away_team_id: espnGame.awayTeam.id,
      away_team_name: espnGame.awayTeam.displayName,
      away_team_abbreviation: espnGame.awayTeam.abbreviation,
      away_team_logo_url: espnGame.awayTeam.logo,
      away_rank: espnGame.awayTeam.rank,
      away_record: espnGame.awayTeam.record,
      away_score: espnGame.awayTeam.score,
      home_team_id: espnGame.homeTeam.id,
      home_team_name: espnGame.homeTeam.displayName,
      home_team_abbreviation: espnGame.homeTeam.abbreviation,
      home_team_logo_url: espnGame.homeTeam.logo,
      home_rank: espnGame.homeTeam.rank,
      home_record: espnGame.homeTeam.record,
      home_score: espnGame.homeTeam.score,
      status: espnGame.status,
      status_detail: espnGame.statusDetail,
      winner_team_id: espnGame.winnerTeamId,
      completed: espnGame.completed,
      ...(canRefreshNcaaOdds(week, espnGame, localGame) && espnGame.odds ? {
        spread_favorite_team_id: espnGame.odds.favoriteTeamId,
        spread: espnGame.odds.spread,
        over_under: espnGame.odds.overUnder,
        odds_provider: espnGame.odds.provider,
        odds_updated_at: now,
      } : {}),
    }];
  });

  // The RPC checks the live lease under row lock, preserves current inclusion/odds,
  // grades current picks for active Group teams and never reopens an existing final week.
  const applied = await supabaseAdmin.rpc("apply_ncaa_pickem_results", {
    p_week_id: weekId, p_lease_token: token, p_games: gameUpdates,
  });
  if (applied.error || !applied.data) throw new Error(`NCAA result application failed: ${applied.error?.message ?? "lease lost"}`);
  return {
    success: true, weekId, season: week.season, week: week.week_number,
    gamesFound: espnWeek.scheduleGames.length, localGames: existingGames.length,
    ...applied.data, checkedAt: now,
  };
}
