import { createFootballGameDetailHandler } from "@/lib/live-scores/game-detail";
import { getNflLiveAccess } from "@/lib/live-scores/access";
import { loadNflOwnership } from "@/lib/live-scores/nflOwnership.server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { normalizeNflGame } from "@/lib/providers/nflLiveScores";
import { parseNflCalendar } from "@/lib/live-scores/urlState";

function athleteIdsFromSummary(summary: any) {
  const ids = new Set<string>();
  const players = Array.isArray(summary?.boxscore?.players)
    ? summary.boxscore.players
    : [];
  players.forEach((team: any) => {
    (team?.statistics ?? []).forEach((category: any) => {
      (category?.athletes ?? []).forEach((row: any) => {
        const id = String(row?.athlete?.id ?? "");
        if (/^\d+$/.test(id)) ids.add(id);
      });
    });
  });
  return [...ids];
}

async function loadOptimizedHeadshots(summary: any) {
  const athleteIds = athleteIdsFromSummary(summary);
  if (!athleteIds.length) return {};
  const { data, error } = await supabaseAdmin
    .from("players_nfl")
    .select("nfl_player_id, headshot_url")
    .in("nfl_player_id", athleteIds)
    .not("headshot_url", "is", null);
  if (error) throw error;
  return Object.fromEntries(
    (data ?? [])
      .filter((player) => player.headshot_url)
      .map((player) => [String(player.nfl_player_id), player.headshot_url]),
  );
}

export const GET = createFootballGameDetailHandler("nfl", getNflLiveAccess, async (summary, access, request) => {
  // The cookie authorizes scope; the explicit client scope prevents switch races.
  const competition = summary?.header?.competitions?.[0];
  const game = normalizeNflGame({ ...summary.header, date: competition?.date,
    competitions: competition ? [{ ...competition, odds: competition.odds ?? summary.pickcenter }] : [] });
  const liveContext = parseNflCalendar(new URLSearchParams({ season: String(summary.header?.season?.year),
    seasonType: String(summary.header?.season?.type), week: String(summary.header?.week) }));
  const params = request.nextUrl.searchParams;
  if (params.get("groupId") !== access.context.group.id) return { game, liveContext };
  const [ownership, optimizedHeadshotsByAthleteId] = await Promise.all([
    loadNflOwnership(access, summary.header?.competitions?.[0]?.date ?? "")
      .catch(() => null),
    loadOptimizedHeadshots(summary).catch(() => ({})),
  ]);
  return { game, liveContext, ownership, optimizedHeadshotsByAthleteId };
}, (user, access, request) => {
  const params = request.nextUrl.searchParams;
  // Legacy modal calls supply only Group. Inline calls validate the full identity
  // before fetching provider data or loading any fantasy annotations.
  if ((params.has("viewerId") && params.get("viewerId") !== user.id) ||
      (params.has("leagueId") && params.get("leagueId") !== access.league.id) ||
      ((params.has("viewerId") || params.has("leagueId")) && params.get("groupId") !== access.context.group.id)) {
    return "The NFL Live viewing context changed. Return to games and try again.";
  }
  return null;
});
