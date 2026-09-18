import { createFootballGameDetailHandler } from "@/lib/live-scores/game-detail";
import { getNflLiveAccess } from "@/lib/live-scores/access";
import { loadNflOwnership } from "@/lib/live-scores/nflOwnership.server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

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
  if (request.nextUrl.searchParams.get("groupId") !== access.context.group.id) return {};
  const [ownership, optimizedHeadshotsByAthleteId] = await Promise.all([
    loadNflOwnership(access, summary.header?.competitions?.[0]?.date ?? "")
      .catch(() => null),
    loadOptimizedHeadshots(summary).catch(() => ({})),
  ]);
  return { ownership, optimizedHeadshotsByAthleteId };
});
